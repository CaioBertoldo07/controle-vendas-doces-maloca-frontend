// Serviço da conversa gestor ↔ Atendimento (Etapa 5): infraestrutura, fora
// dos agentes (como consultas.js). Grava ConversaAgente/MensagemConversa,
// passa ao Atendimento só uma janela do histórico e o estado estruturado, e
// aplica a barreira de segredos no texto que sai.
//
// Etapa 6, um turno por vez: antes de processar, o turno adquire um LEASE na
// conversa (UPDATE condicional: livre ou vencido → ocupado até agora + 120 s,
// com um token). Nenhuma transação fica aberta durante a chamada ao LLM. Um
// segundo turno simultâneo recebe 409 e nada é gravado por ele. O estado só é
// gravado por quem ainda detém o token; se o processo cair, o lease vence
// sozinho e a conversa volta a aceitar mensagens.
import { randomUUID } from "node:crypto";
import { erro } from "../lib/erros.js";
import { prisma } from "../lib/prisma.js";
import { filtrarSegredos } from "../lib/segredos.js";
import { LIMITES_CONVERSA } from "./conversa/intencoes.js";

export const LEASE_TURNO_MS = 120000; // maior que o limite do Atendimento (90 s)
export const OCUPADA = "Ainda estou respondendo à mensagem anterior desta conversa. Aguarde a resposta e envie de novo.";

/** Lease do turno: devolve { conversa, token } ou 409 (conversa ocupada) / 404 (não é do usuário). */
async function adquirirTurno(usuarioId, conversaId) {
  const token = randomUUID();
  const agora = new Date();
  const ate = new Date(agora.getTime() + LEASE_TURNO_MS);
  if (!conversaId) {
    return { conversa: await prisma.conversaAgente.create({ data: { usuarioId, processandoAte: ate, tokenProcessamento: token } }), token };
  }
  const id = idConversa(conversaId);
  const { count } = await prisma.conversaAgente.updateMany({
    where: { id, usuarioId, OR: [{ processandoAte: null }, { processandoAte: { lt: agora } }] },
    data: { processandoAte: ate, tokenProcessamento: token },
  });
  if (count === 0) {
    await carregarConversa(usuarioId, conversaId); // 404 se não existe ou é de outro usuário
    throw erro(409, OCUPADA);
  }
  return { conversa: await prisma.conversaAgente.findUnique({ where: { id } }), token };
}

/** Libera o lease; grava o estado só se este turno ainda o detém. Devolve true se gravou. */
async function liberarTurno(conversaId, token, estado) {
  const { count } = await prisma.conversaAgente.updateMany({
    where: { id: conversaId, tokenProcessamento: token },
    data: { processandoAte: null, tokenProcessamento: null, ...(estado !== undefined && { estado }) },
  });
  return count === 1;
}

const FALHA_TURNO = "Não consegui concluir a resposta agora. Os agentes especializados continuam operacionais; tente de novo em instantes.";

function idConversa(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erro(404, "Conversa não encontrada");
  return n;
}

async function carregarConversa(usuarioId, conversaId) {
  const conversa = await prisma.conversaAgente.findFirst({ where: { id: idConversa(conversaId), usuarioId } });
  if (!conversa) throw erro(404, "Conversa não encontrada"); // de outro usuário também é "não encontrada"
  return conversa;
}

/** Execução do Atendimento e todas as descendentes (Coordenador, especialistas), para a resposta e a auditoria. */
async function arvoreDeExecucoes(raizId) {
  if (!raizId) return [];
  const todas = [];
  let nivel = [raizId];
  while (nivel.length && todas.length < 50) {
    const execs = await prisma.execucaoAgente.findMany({
      where: { id: { in: nivel } },
      select: { id: true, agente: true, tipoExecucao: true, status: true, duracaoMs: true, execucaoPaiId: true },
      orderBy: { id: "asc" },
    });
    todas.push(...execs);
    nivel = (await prisma.execucaoAgente.findMany({ where: { execucaoPaiId: { in: nivel } }, select: { id: true } })).map((e) => e.id);
  }
  return todas;
}

export async function enviarMensagem({ usuarioId, conversaId, mensagem, dataReferencia }, runtime) {
  if (typeof mensagem !== "string" || !mensagem.trim()) throw erro(400, "Escreva uma mensagem");
  if (mensagem.length > LIMITES_CONVERSA.MAX_CARACTERES_MENSAGEM) throw erro(400, `Mensagem longa demais (máximo de ${LIMITES_CONVERSA.MAX_CARACTERES_MENSAGEM} caracteres)`);
  const { conversa, token } = await adquirirTurno(usuarioId, conversaId);
  let liberado = false;
  try {
    const anteriores = await prisma.mensagemConversa.findMany({
      where: { conversaId: conversa.id },
      orderBy: { id: "desc" },
      take: LIMITES_CONVERSA.JANELA_HISTORICO,
      select: { papel: true, conteudo: true },
    });
    await prisma.mensagemConversa.create({ data: { conversaId: conversa.id, papel: "USUARIO", conteudo: mensagem.trim() } });

    let saida;
    let execucaoId = null;
    try {
      const r = await runtime.executarAgente(
        "atendimento",
        { tipo: "CONVERSAR", dados: { mensagem: mensagem.trim(), historico: anteriores.reverse(), estado: conversa.estado ?? {}, ...(dataReferencia && { dataReferencia }) } },
        { gatilho: "CHAT" },
      );
      saida = r.saida;
      execucaoId = r.execucaoId;
    } catch (e) {
      execucaoId = e.execucaoId ?? null; // o detalhe fica na auditoria (ExecucaoAgente.erro)
      saida = { resposta: { texto: FALHA_TURNO, origemTexto: "SISTEMA", acoesPropostas: [], anexos: [], limitacoes: [], pendencia: null }, novoEstado: conversa.estado ?? {} };
    }

    const { texto, bloqueado } = filtrarSegredos(saida.resposta.texto);
    const { acoesPropostas = [], anexos = [], limitacoes = [], pendencia = null, origemTexto } = saida.resposta;
    const dados = { origemTexto: bloqueado ? "SISTEMA" : origemTexto, acoesPropostas, anexos, limitacoes, pendencia, ...(saida.resposta.degradado && { degradado: true }), ...(bloqueado && { segurancaBloqueada: true }) };
    const contextoGravado = await liberarTurno(conversa.id, token, saida.novoEstado ?? {});
    liberado = true;
    if (!contextoGravado) dados.contextoNaoGravado = true; // o lease venceu e outro turno assumiu: o estado dele prevalece
    const msg = await prisma.mensagemConversa.create({ data: { conversaId: conversa.id, papel: "ASSISTENTE", conteudo: texto, dados, execucaoId } });

    return {
      conversaId: conversa.id,
      mensagem: { id: msg.id, papel: msg.papel, conteudo: msg.conteudo, criadaEm: msg.criadaEm, ...dados },
      execucaoId,
      execucoes: await arvoreDeExecucoes(execucaoId),
      acoesPropostas: dados.acoesPropostas,
      anexos: dados.anexos,
      limitacoes: dados.limitacoes,
      pendencia: dados.pendencia,
    };
  } finally {
    if (!liberado) await liberarTurno(conversa.id, token).catch(() => {});
  }
}

/** Histórico de uma conversa do usuário, com o status ATUAL das ações propostas (aprovadas/rejeitadas depois). */
export async function obterConversa({ usuarioId, conversaId }) {
  const conversa = await carregarConversa(usuarioId, conversaId);
  const mensagens = await prisma.mensagemConversa.findMany({ where: { conversaId: conversa.id }, orderBy: { id: "asc" } });
  const ids = mensagens.flatMap((m) => (m.dados?.acoesPropostas ?? []).map((a) => a.acaoId)).filter(Boolean);
  const acoes = ids.length ? await prisma.acaoProposta.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, erro: true } }) : [];
  const status = new Map(acoes.map((a) => [a.id, a]));
  return {
    conversaId: conversa.id,
    criadaEm: conversa.criadaEm,
    mensagens: mensagens.map((m) => ({
      id: m.id, papel: m.papel, conteudo: m.conteudo, criadaEm: m.criadaEm, execucaoId: m.execucaoId,
      ...(m.dados ?? {}),
      ...(m.dados?.acoesPropostas && { acoesPropostas: m.dados.acoesPropostas.map((a) => ({ ...a, status: status.get(a.acaoId)?.status ?? a.status })) }),
    })),
  };
}
