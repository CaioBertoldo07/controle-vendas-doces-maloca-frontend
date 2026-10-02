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
//
// Etapa 6, unicidade NO BANCO: a ABERTA guarda `chaveAtiva` = agente|tipo|chave
// (índice único; NULL quando RESOLVIDA/IGNORADA). O registro roda numa transação
// com SELECT ... FOR UPDATE na chave; se duas análises simultâneas tentam criar,
// uma recebe violação de unicidade (ou deadlock) e repete: na repetição encontra
// a ABERTA da outra e só a atualiza. N análises concorrentes → 1 ABERTA.
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
const TENTATIVAS_CONCORRENCIA = 5;
/** P2002 = violação de unicidade (outra análise criou antes); P2034 = deadlock/conflito de escrita. */
export const ehConflitoDeConcorrencia = (e) => e?.code === "P2002" || e?.code === "P2034";

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
  const ativa = `${agente}|${efetiva}`;
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const [travada] = await tx.$queryRaw`SELECT id FROM recomendacoes WHERE chaveAtiva = ${ativa} FOR UPDATE`;
        if (travada) {
          const aberta = await tx.recomendacao.findUnique({ where: { id: travada.id } });
          const controle = { ...aberta.dados.controle, ocorrencias: (aberta.dados.controle.ocorrencias ?? 1) + 1, ultimaDeteccaoEm: agora, ultimaExecucaoId: execucaoId };
          const recomendacao = await tx.recomendacao.update({
            where: { id: aberta.id },
            data: { ...campos, execucaoId, dados: paraRegistro({ ...(extras ?? {}), controle }) },
          });
          return { operacao: "ATUALIZADA", recomendacao };
        }
        const ignorada = await tx.recomendacao.findFirst({ where: { agente, status: STATUS_RECOMENDACAO.IGNORADA, dados: { path: "$.controle.chave", equals: efetiva } }, orderBy: { id: "desc" } });
        if (ignorada) return { operacao: "SUPRIMIDA", recomendacao: ignorada };

        const controle = { chave: efetiva, ocorrencias: 1, primeiraDeteccaoEm: agora, ultimaDeteccaoEm: agora, primeiraExecucaoId: execucaoId, ultimaExecucaoId: execucaoId };
        const recomendacao = await tx.recomendacao.create({
          data: { ...campos, agente, execucaoId, chaveAtiva: ativa, dados: paraRegistro({ ...(extras ?? {}), controle }) },
        });
        return { operacao: "CRIADA", recomendacao };
      });
    } catch (e) {
      if (!ehConflitoDeConcorrencia(e) || tentativa >= TENTATIVAS_CONCORRENCIA) throw e;
      await new Promise((r) => setTimeout(r, 10 * tentativa + Math.floor(Math.random() * 20)));
    }
  }
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
        chaveAtiva: null,
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
      chaveAtiva: null,
      dados: paraRegistro({ ...(atual.dados ?? {}), controle: { ...(atual.dados?.controle ?? {}), resolucao: { modo: "GESTOR" } } }),
    },
  });
  if (count !== 1) throw erro(409, `Recomendação ${n} está ${atual.status}; só ABERTA pode mudar de status`);
  return prisma.recomendacao.findUnique({ where: { id: n } });
}
