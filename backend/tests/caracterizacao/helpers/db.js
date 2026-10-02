// PrismaClient da suíte: aponta EXPLICITAMENTE para o banco de teste ativado
// em setup/porArquivo.js. Nunca usa a DATABASE_URL de desenvolvimento.
import { PrismaClient } from "@prisma/client";

const url = process.env.MALOCA_SUITE_URL_TESTE;
if (!url || !new URL(url).pathname.endsWith("_test")) {
  throw new Error("⛔ helpers/db.js importado sem o banco de teste ativado (setup/porArquivo.js).");
}

export const prisma = new PrismaClient({ datasourceUrl: url });

// Ordem respeita as chaves estrangeiras (filhos antes dos pais).
const TABELAS = [
  // Conversa do Atendimento (Etapa 5)
  "mensagemConversa",
  "conversaAgente",
  // Camada SMA (Etapa 1)
  "chamadaTool",
  "mensagemAgente",
  "recomendacao",
  "acaoProposta",
  "execucaoAgente",
  // Domínio
  "vendaSabor",
  "venda",
  "producaoSabor",
  "producao",
  "movimentacaoMateriaPrima",
  "custo",
  "receitaItem",
  "sabor",
  "materiaPrima",
  "cliente",
  "usuario",
];

export async function limparBanco() {
  for (const t of TABELAS) await prisma[t].deleteMany();
}

/** Converte Decimal/strings numéricas do Prisma em Number para asserções. */
export const n = (v) => (v == null ? v : Number(v));
