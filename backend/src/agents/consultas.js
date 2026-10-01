// Leituras da auditoria SMA para as rotas /api/agentes (Etapa 1).
import { erro } from "../lib/erros.js";
import { prisma } from "../lib/prisma.js";

const limitar = (limite, padrao = 50) => Math.min(Math.max(parseInt(limite) || padrao, 1), 200);

export async function listarExecucoes({ agente, status, limite } = {}) {
  return prisma.execucaoAgente.findMany({
    where: { ...(agente && { agente: String(agente) }), ...(status && { status: String(status) }) },
    orderBy: { id: "desc" },
    take: limitar(limite),
    select: {
      id: true, agente: true, tipoExecucao: true, gatilho: true, status: true,
      iniciadaEm: true, finalizadaEm: true, duracaoMs: true, execucaoPaiId: true, erro: true,
    },
  });
}

/** Execução com tools chamadas, mensagens enviadas/recebidas, filhas e ações. */
export async function buscarExecucao(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erro(404, "Execução não encontrada");
  const execucao = await prisma.execucaoAgente.findUnique({
    where: { id: n },
    include: {
      chamadasTool: { orderBy: { id: "asc" } },
      mensagens: { orderBy: { id: "asc" } },
      recebidas: { orderBy: { id: "asc" } },
      filhas: { orderBy: { id: "asc" }, select: { id: true, agente: true, tipoExecucao: true, status: true, duracaoMs: true } },
      acoes: { orderBy: { id: "asc" } },
      recomendacoes: { orderBy: { id: "asc" } },
    },
  });
  if (!execucao) throw erro(404, "Execução não encontrada");
  return execucao;
}

export async function listarRecomendacoes({ status, agente, limite } = {}) {
  return prisma.recomendacao.findMany({
    where: { ...(status && { status: String(status) }), ...(agente && { agente: String(agente) }) },
    orderBy: { id: "desc" },
    take: limitar(limite),
  });
}
