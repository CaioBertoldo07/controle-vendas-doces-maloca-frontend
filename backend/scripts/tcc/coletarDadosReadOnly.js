/**
 * Coleta de dados da Etapa 0.2 do TCC — ESTRITAMENTE SOMENTE LEITURA.
 *
 * Objetivo: medir volume e qualidade dos dados reais para decidir data de
 * corte do estoque acabado, necessidade de inventário inicial e alcance do
 * Agente de Inteligência.
 *
 * Segurança:
 *   1. Lê o banco APENAS de DATABASE_URL_COLETA (nunca de DATABASE_URL).
 *   2. Sem a flag --executar, não conecta: só mostra alvo e consultas.
 *   3. Toda consulta é constante e validada por validarSomenteLeitura().
 *   4. A sessão MySQL é colocada em READ ONLY antes das consultas, com uma
 *      única conexão (connection_limit=1) para a configuração valer em todas.
 *   5. Recomendado: usar um usuário MySQL com permissão apenas de SELECT.
 *   6. Consultas `privada` (nomes de clientes, séries por cliente/dia) só
 *      alimentam os agregados de analiseColeta.js; suas linhas não são gravadas.
 *
 * Uso:
 *   npm run tcc:coleta                 # simulação: mostra alvo e consultas
 *   npm run tcc:coleta -- --executar   # executa e grava backend/.coleta-tcc/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { analisarUrlBanco, carregarEnv, descreverBanco } from "../ambiente/guardas.js";
import { analisar } from "./analiseColeta.js";
import { CONSULTAS } from "./consultasColeta.js";
import { validarSomenteLeitura } from "./somenteLeitura.js";

const DIR_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR_SAIDA = path.join(DIR_BACKEND, ".coleta-tcc");
const TEMPO_MAXIMO_CONSULTA_MS = 30000;

const executar = process.argv.includes("--executar");

function falhar(mensagem) {
  console.error(`\n⛔ ${mensagem}\n`);
  process.exit(1);
}

// ---------- Normalização de valores vindos do $queryRaw ----------
function normalizarValor(v) {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object" && typeof v.toFixed === "function") {
    return Number(v.toString()); // Prisma.Decimal
  }
  return v;
}

function normalizarLinhas(linhas) {
  return linhas.map((linha) =>
    Object.fromEntries(Object.entries(linha).map(([k, v]) => [k, normalizarValor(v)])),
  );
}

// ---------- Relatório Markdown ----------
function fmt(v) {
  if (v === null || v === undefined) return "—";
  const texto = typeof v === "object" ? JSON.stringify(v) : String(v);
  return texto.replace(/\|/g, "\\|");
}

function tabelaMarkdown(linhas) {
  if (!linhas || linhas.length === 0) return "_(sem linhas)_\n";
  const colunas = Object.keys(linhas[0]);
  return [
    `| ${colunas.join(" | ")} |`,
    `| ${colunas.map(() => "---").join(" | ")} |`,
    ...linhas.map((l) => `| ${colunas.map((c) => fmt(l[c])).join(" | ")} |`),
  ].join("\n") + "\n";
}

// Escalares viram tabela indicador/valor; listas de objetos viram tabelas;
// objetos aninhados viram subseções.
function secaoMarkdown(titulo, obj, nivel = 2) {
  const h = "#".repeat(Math.min(nivel, 6));
  const escalares = [];
  const partes = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (Array.isArray(v)) {
      partes.push(`${h}# ${k}\n\n${tabelaMarkdown(v)}`);
    } else if (v && typeof v === "object") {
      partes.push(secaoMarkdown(k, v, nivel + 1));
    } else {
      escalares.push({ indicador: k, valor: v });
    }
  }
  return [`${h} ${titulo}\n`, escalares.length ? tabelaMarkdown(escalares) : "", ...partes].join("\n");
}

function gerarMarkdown({ alvo, geradoEm, analise, resultados }) {
  const partes = [
    "# Coleta read-only — Etapa 0.2 (TCC Doces da Maloca)",
    "",
    `- Gerado em: ${geradoEm}`,
    `- Banco: \`${alvo}\``,
    "- Modo: sessão MySQL READ ONLY; apenas consultas SELECT validadas.",
    "- Consultas privadas (nomes de clientes, séries por cliente/dia) aparecem só como agregados.",
    "",
    "# Análise",
    "",
  ];
  for (const [secao, conteudo] of Object.entries(analise)) {
    partes.push(
      Array.isArray(conteudo)
        ? `## ${secao}\n\n${tabelaMarkdown(conteudo)}`
        : secaoMarkdown(secao, conteudo),
    );
  }
  partes.push("# Resultados das consultas (não privadas)", "");
  for (const c of CONSULTAS.filter((x) => !x.privada)) {
    partes.push(`## ${c.nome}`, "", `_${c.descricao}_`, "", tabelaMarkdown(resultados[c.nome]));
  }
  return partes.join("\n");
}

// ---------- Execução ----------
async function main() {
  carregarEnv();

  const url = process.env.DATABASE_URL_COLETA;
  if (!url) {
    falhar(
      "DATABASE_URL_COLETA não definida. Defina-a no terminal apenas no momento da coleta " +
        "(de preferência com um usuário somente leitura). DATABASE_URL nunca é usada aqui.",
    );
  }
  const info = analisarUrlBanco(url);
  if (!info.valida) falhar(`DATABASE_URL_COLETA inválida: ${info.motivo}`);

  // Barreira 1: todas as consultas precisam passar no validador.
  for (const c of CONSULTAS) {
    const v = validarSomenteLeitura(c.sql);
    if (!v.valida) falhar(`Consulta "${c.nome}" rejeitada pelo validador: ${v.motivo}`);
  }

  const alvo = descreverBanco(info);
  console.log(`🎯 Alvo da coleta: ${alvo}${info.hostDeProducao ? "  (host do Railway — PRODUÇÃO)" : ""}`);
  console.log(`🔎 ${CONSULTAS.length} consultas validadas como somente leitura.`);

  if (!executar) {
    console.log("\nModo simulação (nada foi conectado). Consultas que seriam executadas:\n");
    for (const c of CONSULTAS) {
      console.log(`  - ${c.nome}${c.privada ? " [privada]" : ""}: ${c.descricao}`);
    }
    console.log("\nPara executar de verdade: npm run tcc:coleta -- --executar\n");
    return;
  }

  const u = new URL(url);
  u.searchParams.set("connection_limit", "1");
  const prisma = new PrismaClient({ datasourceUrl: u.toString() });

  try {
    // Barreira 2: sessão somente leitura (ERRO 1792 em qualquer escrita).
    await prisma.$executeRawUnsafe("SET SESSION TRANSACTION READ ONLY");
    try {
      await prisma.$executeRawUnsafe(
        `SET SESSION MAX_EXECUTION_TIME = ${TEMPO_MAXIMO_CONSULTA_MS}`,
      );
    } catch {
      console.warn("⚠️  MAX_EXECUTION_TIME não suportado neste servidor; seguindo sem limite.");
    }
    const [{ modo }] = await prisma.$queryRawUnsafe(
      "SELECT @@SESSION.transaction_read_only AS modo",
    );
    if (Number(modo) !== 1) falhar("Não foi possível confirmar a sessão READ ONLY. Abortando.");

    const todos = {};
    for (const c of CONSULTAS) {
      process.stdout.write(`   · ${c.nome}${c.privada ? " [privada]" : ""} ... `);
      todos[c.nome] = normalizarLinhas(await prisma.$queryRawUnsafe(c.sql));
      console.log(`${todos[c.nome].length} linha(s)`);
    }

    const analise = analisar(todos);
    const resultados = Object.fromEntries(
      CONSULTAS.filter((c) => !c.privada).map((c) => [c.nome, todos[c.nome]]),
    );

    const geradoEm = new Date().toISOString();
    const carimbo = geradoEm.replace(/[:.]/g, "-");
    fs.mkdirSync(DIR_SAIDA, { recursive: true });
    const arqJson = path.join(DIR_SAIDA, `coleta-${carimbo}.json`);
    const arqMd = path.join(DIR_SAIDA, `coleta-${carimbo}.md`);
    fs.writeFileSync(arqJson, JSON.stringify({ alvo, geradoEm, analise, resultados }, null, 2));
    fs.writeFileSync(arqMd, gerarMarkdown({ alvo, geradoEm, analise, resultados }));

    console.log(`\n✅ Coleta concluída.\n   ${arqMd}\n   ${arqJson}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error("❌ Erro na coleta:", erro.message);
  process.exit(1);
});
