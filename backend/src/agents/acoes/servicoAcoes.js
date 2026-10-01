// Ciclo de vida das ações propostas (Etapa 1):
//
//   PENDENTE ──aprovar──▶ APROVADA ──executar──▶ EXECUTANDO ──▶ EXECUTADA
//      │                                              └────────▶ FALHA
//      └──rejeitar──▶ REJEITADA (nunca executa)
//
// Cada transição é um UPDATE condicional ao status atual (updateMany ... where
// status = X): duas requisições simultâneas nunca aprovam ou executam a mesma
// ação duas vezes. EXECUTADA, REJEITADA e FALHA são finais.
import { ErroDominio, erro } from "../../lib/erros.js";
import { prisma } from "../../lib/prisma.js";
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

/** Cria a proposta (status PENDENTE). Não executa nada. */
export async function proporAcao({ tipo, payload, descricao, criadaPorAgente, execucaoId = null }) {
  if (!TIPOS_ACAO.includes(tipo)) {
    throw new ErroDominio(400, { error: `Tipo de ação não permitido: "${tipo}"`, tipo: "INVALIDO", permitidos: TIPOS_ACAO });
  }
  if (typeof descricao !== "string" || descricao.trim().length < 5) throw erro(400, "Descreva a ação (mínimo de 5 caracteres)");
  if (!criadaPorAgente) throw erro(400, "Ação sem agente de origem");
  const dados = validarPayload(tipo, payload);
  await CONTRATOS[tipo].verificar(dados);

  return prisma.acaoProposta.create({
    data: { tipo, payload: dados, descricao: descricao.trim().slice(0, 2000), status: "PENDENTE", criadaPorAgente, execucaoId },
  });
}

/** Id de ação válido (inteiro positivo) ou 404. */
function idAcao(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erro(404, "Ação não encontrada");
  return n;
}

async function transicionar(id, de, para, dados = {}) {
  const { count } = await prisma.acaoProposta.updateMany({ where: { id, status: de }, data: { status: para, ...dados } });
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

/**
 * Executa uma ação APROVADA pelo executor determinístico do tipo. A ação é
 * "reservada" (APROVADA → EXECUTANDO) antes de chamar o service, então uma
 * segunda chamada recebe 409 em vez de executar de novo.
 */
export async function executarAcaoAprovada(id) {
  const acaoId = idAcao(id);
  await transicionar(acaoId, "APROVADA", "EXECUTANDO");
  const acao = await prisma.acaoProposta.findUnique({ where: { id: acaoId } });
  try {
    const dados = validarPayload(acao.tipo, acao.payload); // o contrato vale também na execução
    const resultado = await CONTRATOS[acao.tipo].executar(dados);
    return await prisma.acaoProposta.update({
      where: { id: acaoId },
      data: { status: "EXECUTADA", executadaEm: new Date(), resultado: paraRegistro(resultado) },
    });
  } catch (e) {
    const detalhes = e instanceof ErroDominio ? paraRegistro(e.corpo) : null;
    return prisma.acaoProposta.update({
      where: { id: acaoId },
      data: { status: "FALHA", erro: mensagemSegura(e), resultado: detalhes },
    });
  }
}

/** Fluxo do gestor: aprovar e executar em seguida. */
export async function aprovarEExecutar(id) {
  await aprovarAcao(id);
  return executarAcaoAprovada(id);
}

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
