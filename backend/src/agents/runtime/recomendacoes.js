// Ciclo de vida das recomendações (Etapa 2).
//
//   ABERTA ──gestor──▶ RESOLVIDA | IGNORADA
//   ABERTA ──condição deixou de ser detectada──▶ RESOLVIDA (automática)
//
// Deduplicação por CHAVE (tipo + entidade, ex.: "CONTAGEM_FISICA|estoque-acabado"),
// guardada em dados.controle.chave (Json; não exigiu migration):
//   - existe ABERTA com a mesma chave  → atualiza (texto, prioridade, dados,
//     execução mais recente) e soma uma ocorrência: nunca cria duplicata;
//   - existe IGNORADA com a mesma chave → não recria (o gestor já descartou);
//   - só RESOLVIDA ou nenhuma           → cria uma nova ABERTA (o problema voltou).
// Recomendações sem chave seguem a regra da Etapa 1 (sempre cria).
import { z } from "zod";
import { erro } from "../../lib/erros.js";
import { prisma } from "../../lib/prisma.js";
import { paraRegistro } from "./util.js";

export const STATUS_RECOMENDACAO = Object.freeze({ ABERTA: "ABERTA", RESOLVIDA: "RESOLVIDA", IGNORADA: "IGNORADA" });

const esquema = z
  .object({
    tipo: z.string().min(1).max(50),
    titulo: z.string().min(3).max(200),
    descricao: z.string().min(3).max(5000),
    prioridade: z.enum(["BAIXA", "MEDIA", "ALTA"]),
    chave: z.string().min(1).max(150).optional(),
    dados: z.unknown().optional(),
  })
  .strict();

const chaveEfetiva = (tipo, chave) => `${tipo}|${chave}`;
const porChave = (agente, chave, status) =>
  prisma.recomendacao.findFirst({
    where: { agente, status, dados: { path: "$.controle.chave", equals: chave } },
    orderBy: { id: "desc" },
  });

/** Devolve { operacao: CRIADA | ATUALIZADA | SUPRIMIDA, recomendacao }. */
export async function registrarRecomendacao({ agente, execucaoId, entrada }) {
  const r = esquema.safeParse(entrada);
  if (!r.success) throw erro(400, `Recomendação inválida: ${r.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  const { dados: extras, chave, ...campos } = r.data;
  const agora = new Date().toISOString();

  if (!chave) {
    const recomendacao = await prisma.recomendacao.create({ data: { ...campos, agente, execucaoId, dados: paraRegistro(extras) } });
    return { operacao: "CRIADA", recomendacao };
  }

  const efetiva = chaveEfetiva(campos.tipo, chave);
  const aberta = await porChave(agente, efetiva, STATUS_RECOMENDACAO.ABERTA);
  if (aberta) {
    const controle = { ...aberta.dados.controle, ocorrencias: (aberta.dados.controle.ocorrencias ?? 1) + 1, ultimaDeteccaoEm: agora, ultimaExecucaoId: execucaoId };
    const recomendacao = await prisma.recomendacao.update({
      where: { id: aberta.id },
      data: { ...campos, execucaoId, dados: paraRegistro({ ...(extras ?? {}), controle }) },
    });
    return { operacao: "ATUALIZADA", recomendacao };
  }

  const ignorada = await porChave(agente, efetiva, STATUS_RECOMENDACAO.IGNORADA);
  if (ignorada) return { operacao: "SUPRIMIDA", recomendacao: ignorada };

  const controle = { chave: efetiva, ocorrencias: 1, primeiraDeteccaoEm: agora, ultimaDeteccaoEm: agora, primeiraExecucaoId: execucaoId, ultimaExecucaoId: execucaoId };
  const recomendacao = await prisma.recomendacao.create({
    data: { ...campos, agente, execucaoId, dados: paraRegistro({ ...(extras ?? {}), controle }) },
  });
  return { operacao: "CRIADA", recomendacao };
}

/**
 * Resolve automaticamente as recomendações ABERTAS deste agente, dos `tipos`
 * informados, cuja chave não foi detectada nesta análise (`chavesAtivas`:
 * [{ tipo, chave }]). Devolve os ids resolvidos.
 */
export async function encerrarAusentes({ agente, execucaoId, tipos, chavesAtivas }) {
  const ativas = new Set(chavesAtivas.map(({ tipo, chave }) => chaveEfetiva(tipo, chave)));
  const abertas = await prisma.recomendacao.findMany({ where: { agente, status: STATUS_RECOMENDACAO.ABERTA, tipo: { in: tipos } } });
  const resolvidas = [];
  for (const rec of abertas) {
    const chave = rec.dados?.controle?.chave;
    if (!chave || ativas.has(chave)) continue;
    const { count } = await prisma.recomendacao.updateMany({
      where: { id: rec.id, status: STATUS_RECOMENDACAO.ABERTA },
      data: {
        status: STATUS_RECOMENDACAO.RESOLVIDA,
        resolvidaEm: new Date(),
        dados: paraRegistro({ ...rec.dados, controle: { ...rec.dados.controle, resolucao: { modo: "AUTOMATICA", execucaoId, motivo: "Condição não detectada nesta análise" } } }),
      },
    });
    if (count === 1) resolvidas.push(rec.id);
  }
  return resolvidas;
}

/** Ação do gestor: ABERTA → RESOLVIDA ou IGNORADA. */
export async function alterarStatus(id, status) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erro(404, "Recomendação não encontrada");
  if (![STATUS_RECOMENDACAO.RESOLVIDA, STATUS_RECOMENDACAO.IGNORADA].includes(status)) throw erro(400, "Status inválido");
  const atual = await prisma.recomendacao.findUnique({ where: { id: n } });
  if (!atual) throw erro(404, "Recomendação não encontrada");
  const { count } = await prisma.recomendacao.updateMany({
    where: { id: n, status: STATUS_RECOMENDACAO.ABERTA },
    data: {
      status,
      resolvidaEm: new Date(),
      dados: paraRegistro({ ...(atual.dados ?? {}), controle: { ...(atual.dados?.controle ?? {}), resolucao: { modo: "GESTOR" } } }),
    },
  });
  if (count !== 1) throw erro(409, `Recomendação ${n} está ${atual.status}; só ABERTA pode mudar de status`);
  return prisma.recomendacao.findUnique({ where: { id: n } });
}
