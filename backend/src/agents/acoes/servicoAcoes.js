// Ciclo de vida das ações propostas (Etapa 1; execução atômica na Etapa 6):
//
//   PENDENTE ──aprovar──▶ APROVADA ══ executar (UMA transação MySQL) ══▶ EXECUTADA
//      │                     ▲   │                                        
//      │                     │   └── recusa do domínio (400/404/409/422) ──▶ FALHA
//      │                     └────── falha inesperada / queda: ROLLBACK, continua APROVADA
//      └──rejeitar──▶ REJEITADA (nunca executa)
//
// Execução (Etapa 6): claim (APROVADA → EXECUTANDO), efeito de domínio (o
// service recebe o cliente da transação) e EXECUTADA confirmam JUNTOS ou são
// desfeitos juntos. EXECUTANDO só existe dentro da transação aberta: nunca é
// visto confirmado. Se o processo cai no meio, o MySQL desfaz tudo ao perder a
// conexão: a ação continua APROVADA e o domínio intacto, e o gestor pode
// reexecutar sabendo que nada foi aplicado. Não há retentativa automática.
// Concorrência: o claim é um UPDATE condicional que trava a linha; execuções
// simultâneas esperam e, depois do commit da primeira, não encontram mais
// APROVADA (409). Exatamente um efeito.
import { createHash } from "node:crypto";
import { ErroDominio, erro } from "../../lib/erros.js";
import { prisma } from "../../lib/prisma.js";
import { sinalizarSeHabilitado } from "../rotinas/index.js";
import { mensagemSegura, paraRegistro } from "../runtime/util.js";
import { CONTRATOS, TIPOS_ACAO } from "./contratos.js";

const validarPayload = (tipo, payload) => {
  const r = CONTRATOS[tipo].payload.safeParse(payload ?? {});
  if (!r.success) {
    throw new ErroDominio(400, {
      error: `Payload inválido para ${tipo}`,
      tipo: "INVALIDO",
      detalhes: r.error.issues.map((i) => ({ campo: i.path.join(".") || "(raiz)", mensagem: i.message })),
    });
  }
  return r.data;
};

/**
 * Cria a proposta (status PENDENTE). Não executa nada.
 *
 * Idempotência (Etapa 4; unicidade no banco na Etapa 6): a PENDENTE guarda
 * `chaveAtiva` = sha256(tipo + payload validado em JSON canônico), com índice
 * único. Reenviar a mesma proposta enquanto ela está PENDENTE devolve a
 * existente (`reaproveitada: true`); propostas simultâneas idênticas colidem no
 * índice e também recebem a mesma. A chave sai ao deixar PENDENTE (aprovada,
 * rejeitada...): a mesma intenção depois disso é uma ação nova legítima.
 * Payloads diferentes em qualquer campo (quantidade, valor, data...) são ações
 * distintas.
 */
export async function proporAcao({ tipo, payload, descricao, criadaPorAgente, execucaoId = null }) {
  if (!TIPOS_ACAO.includes(tipo)) {
    throw new ErroDominio(400, { error: `Tipo de ação não permitido: "${tipo}"`, tipo: "INVALIDO", permitidos: TIPOS_ACAO });
  }
  if (typeof descricao !== "string" || descricao.trim().length < 5) throw erro(400, "Descreva a ação (mínimo de 5 caracteres)");
  if (!criadaPorAgente) throw erro(400, "Ação sem agente de origem");
  const dados = validarPayload(tipo, payload);
  await CONTRATOS[tipo].verificar(dados);

  const chaveAtiva = chaveDaAcao(tipo, dados);
  const existente = await prisma.acaoProposta.findUnique({ where: { chaveAtiva } });
  if (existente) return { ...existente, reaproveitada: true };
  try {
    const criada = await prisma.acaoProposta.create({
      data: { tipo, payload: dados, descricao: descricao.trim().slice(0, 2000), status: "PENDENTE", criadaPorAgente, execucaoId, chaveAtiva },
    });
    return { ...criada, reaproveitada: false };
  } catch (e) {
    if (e?.code !== "P2002") throw e; // outra proposta idêntica entrou primeiro
    const vencedora = await prisma.acaoProposta.findUnique({ where: { chaveAtiva } });
    if (!vencedora) throw e; // saiu de PENDENTE nesse intervalo: o gestor reenvia
    return { ...vencedora, reaproveitada: true };
  }
}

/** JSON com chaves ordenadas: a mesma ação lógica dá sempre o mesmo texto. */
const canonico = (v) => (Array.isArray(v) ? `[${v.map(canonico).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}` : JSON.stringify(v));
export const chaveDaAcao = (tipo, payload) => createHash("sha256").update(`${tipo}|${canonico(payload)}`).digest("hex");

/** Id de ação válido (inteiro positivo) ou 404. */
function idAcao(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erro(404, "Ação não encontrada");
  return n;
}

async function transicionar(id, de, para, dados = {}) {
  // Etapa 6: ao sair de PENDENTE a chave de deduplicação é liberada
  const { count } = await prisma.acaoProposta.updateMany({ where: { id, status: de }, data: { status: para, ...dados, ...(de === "PENDENTE" && { chaveAtiva: null }) } });
  if (count === 1) return;
  const acao = await prisma.acaoProposta.findUnique({ where: { id } });
  if (!acao) throw erro(404, "Ação não encontrada");
  throw erro(409, `Ação ${id} está ${acao.status}; esperado ${de}`);
}

export async function aprovarAcao(id) {
  await transicionar(idAcao(id), "PENDENTE", "APROVADA", { aprovadaEm: new Date() });
  return buscarAcao(id);
}

export async function rejeitarAcao(id, motivo) {
  await transicionar(idAcao(id), "PENDENTE", "REJEITADA", {
    rejeitadaEm: new Date(),
    motivoRejeicao: motivo ? String(motivo).slice(0, 500) : null,
  });
  return buscarAcao(id);
}

class AcaoNaoAprovada extends Error {}
const OPCOES_TRANSACAO = { maxWait: 5000, timeout: 15000 };

/**
 * Executa uma ação APROVADA numa única transação (ver cabeçalho). Devolve a
 * ação: EXECUTADA; FALHA (o domínio recusou e nada foi aplicado); ou ainda
 * APROVADA com `erro` preenchido (falha inesperada, nada aplicado, pode ser
 * reexecutada). `contratos` só é trocado em testes.
 */
export async function executarAcaoAprovada(id, { contratos = CONTRATOS } = {}) {
  const acaoId = idAcao(id);
  try {
    const executada = await prisma.$transaction(async (tx) => {
      const { count } = await tx.acaoProposta.updateMany({ where: { id: acaoId, status: "APROVADA" }, data: { status: "EXECUTANDO" } });
      if (count !== 1) throw new AcaoNaoAprovada();
      const acao = await tx.acaoProposta.findUnique({ where: { id: acaoId } });
      const dados = validarPayload(acao.tipo, acao.payload); // o contrato vale também na execução
      const resultado = await contratos[acao.tipo].executar(dados, tx);
      return tx.acaoProposta.update({
        where: { id: acaoId },
        data: { status: "EXECUTADA", executadaEm: new Date(), resultado: paraRegistro(resultado), erro: null },
      });
    }, OPCOES_TRANSACAO);
    // depois do commit: o evento de domínio só marca que uma análise é necessária (Etapa 6)
    const evento = { REGISTRAR_VENDA: "VENDA_REGISTRADA", REGISTRAR_PRODUCAO: "PRODUCAO_REGISTRADA" }[executada.tipo];
    if (evento) await sinalizarSeHabilitado(evento);
    return executada;
  } catch (e) {
    if (e instanceof AcaoNaoAprovada) {
      const acao = await prisma.acaoProposta.findUnique({ where: { id: acaoId } });
      if (!acao) throw erro(404, "Ação não encontrada");
      throw erro(409, `Ação ${acaoId} está ${acao.status}; esperado APROVADA`);
    }
    // Transação desfeita: nenhum efeito de domínio foi aplicado.
    if (e instanceof ErroDominio) {
      // Recusa determinística do domínio (payload, 404, já paga, insumo...): repetir não muda nada.
      await prisma.acaoProposta.updateMany({
        where: { id: acaoId, status: "APROVADA" },
        data: { status: "FALHA", erro: mensagemSegura(e), resultado: paraRegistro(e.corpo) },
      });
    } else {
      // Falha inesperada (conexão, timeout, bug): continua APROVADA e recuperável, sem retentativa automática.
      await prisma.acaoProposta.updateMany({
        where: { id: acaoId, status: "APROVADA" },
        data: { erro: `Execução não concluída; nenhuma alteração foi aplicada: ${mensagemSegura(e)}` },
      });
    }
    return prisma.acaoProposta.findUnique({ where: { id: acaoId } });
  }
}

/**
 * Fluxo do gestor: aprovar e executar em seguida. Uma ação APROVADA cuja
 * execução não concluiu (nada aplicado) pode ser executada de novo por aqui.
 */
export async function aprovarEExecutar(id) {
  const acao = await buscarAcao(id);
  if (acao.status === "PENDENTE") await aprovarAcao(id);
  else if (acao.status !== "APROVADA") throw erro(409, `Ação ${acao.id} está ${acao.status}; esperado PENDENTE ou APROVADA`);
  return executarAcaoAprovada(id);
}

/** Etapa 6: ações em EXECUTANDO confirmado não deveriam existir (só legado anterior à execução atômica). */
export const contarAcoesEmExecucao = () => prisma.acaoProposta.count({ where: { status: "EXECUTANDO" } });

export async function buscarAcao(id) {
  const acao = await prisma.acaoProposta.findUnique({ where: { id: idAcao(id) } });
  if (!acao) throw erro(404, "Ação não encontrada");
  return acao;
}

export async function listarAcoes({ status, limite = 50 } = {}) {
  return prisma.acaoProposta.findMany({
    where: status ? { status: String(status) } : {},
    orderBy: { id: "desc" },
    take: Math.min(Math.max(parseInt(limite) || 50, 1), 200),
  });
}
