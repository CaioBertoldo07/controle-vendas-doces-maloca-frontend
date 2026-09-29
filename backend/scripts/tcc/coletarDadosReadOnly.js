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

// ---------- Indicadores derivados ----------
function diasEntre(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function calcularIndicadores(r) {
  const vendas = r.vendas_resumo?.[0] ?? {};
  const producao = r.producao_resumo?.[0] ?? {};
  const antes = r.vendas_antes_da_primeira_producao?.[0] ?? {};
  const receitas = r.receitas_resumo?.[0] ?? {};

  const antesPorSabor = new Map(
    (r.vendido_antes_da_producao_por_sabor ?? []).map((l) => [l.sabor_id, l.unidades]),
  );

  const sabores = (r.sabores_produzido_vendido ?? []).map((s) => {
    const vendidoAntes = antesPorSabor.get(s.id) ?? 0;
    return {
      id: s.id,
      nome: s.nome,
      ativo: Boolean(s.ativo),
      tem_receita: s.itens_receita > 0 && s.rendimento_base != null,
      produzido: s.produzido,
      vendido: s.vendido,
      saldo_historico: s.produzido - s.vendido,
      vendido_antes_da_primeira_producao: vendidoAntes,
      saldo_desde_primeira_producao:
        s.primeira_producao == null ? null : s.produzido - (s.vendido - vendidoAntes),
    };
  });

  const unidadesVendidas = vendas.unidades_vendidas ?? 0;

  return {
    periodo_vendas_dias: diasEntre(vendas.primeira_venda, vendas.ultima_venda),
    meses_com_venda: (r.vendas_por_mes ?? []).length,
    periodo_producao_dias: diasEntre(producao.primeira_producao, producao.ultima_producao),
    meses_com_producao: (r.producao_por_mes ?? []).length,
    // null quando não há produção registrada (a comparação não se aplica)
    percentual_unidades_vendidas_antes_da_primeira_producao:
      unidadesVendidas > 0 && producao.primeira_producao
        ? Number(((100 * (antes.unidades ?? 0)) / unidadesVendidas).toFixed(1))
        : null,
    sabores_com_saldo_historico_negativo: sabores.filter((s) => s.saldo_historico < 0).length,
    sabores_com_saldo_negativo_desde_primeira_producao: sabores.filter(
      (s) => s.saldo_desde_primeira_producao != null && s.saldo_desde_primeira_producao < 0,
    ).length,
    sabores_ativos_sem_receita: sabores.filter((s) => s.ativo && !s.tem_receita).length,
    sabores_com_receita: receitas.sabores_com_receita ?? 0,
    materias_primas_com_saldo_negativo: (r.materias_primas_saldo ?? []).filter(
      (m) => m.saldo < 0,
    ).length,
    sabores,
  };
}

// ---------- Relatório Markdown ----------
function tabelaMarkdown(linhas) {
  if (!linhas || linhas.length === 0) return "_(sem linhas)_\n";
  const colunas = Object.keys(linhas[0]);
  const fmt = (v) => (v === null || v === undefined ? "—" : String(v).replace(/\|/g, "\\|"));
  return [
    `| ${colunas.join(" | ")} |`,
    `| ${colunas.map(() => "---").join(" | ")} |`,
    ...linhas.map((l) => `| ${colunas.map((c) => fmt(l[c])).join(" | ")} |`),
  ].join("\n") + "\n";
}

function gerarMarkdown({ alvo, geradoEm, indicadores, resultados }) {
  const { sabores, ...resumo } = indicadores;
  const partes = [
    "# Coleta read-only — Etapa 0.2 (TCC Doces da Maloca)",
    "",
    `- Gerado em: ${geradoEm}`,
    `- Banco: \`${alvo}\``,
    "- Modo: sessão MySQL READ ONLY; apenas consultas SELECT validadas.",
    "",
    "## Indicadores para decisão",
    "",
    tabelaMarkdown(Object.entries(resumo).map(([indicador, valor]) => ({ indicador, valor }))),
    "## Estoque acabado por sabor",
    "",
    "`saldo_historico` = produzido − vendido desde sempre (regra atual de GET /api/estoque).",
    "`saldo_desde_primeira_producao` desconsidera vendas anteriores à primeira produção do sabor.",
    "",
    tabelaMarkdown(sabores),
  ];
  for (const c of CONSULTAS) {
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
    for (const c of CONSULTAS) console.log(`  - ${c.nome}: ${c.descricao}`);
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

    const resultados = {};
    for (const c of CONSULTAS) {
      process.stdout.write(`   · ${c.nome} ... `);
      resultados[c.nome] = normalizarLinhas(await prisma.$queryRawUnsafe(c.sql));
      console.log(`${resultados[c.nome].length} linha(s)`);
    }

    const geradoEm = new Date().toISOString();
    const indicadores = calcularIndicadores(resultados);
    const carimbo = geradoEm.replace(/[:.]/g, "-");

    fs.mkdirSync(DIR_SAIDA, { recursive: true });
    const arqJson = path.join(DIR_SAIDA, `coleta-${carimbo}.json`);
    const arqMd = path.join(DIR_SAIDA, `coleta-${carimbo}.md`);
    fs.writeFileSync(
      arqJson,
      JSON.stringify({ alvo, geradoEm, indicadores, resultados }, null, 2),
    );
    fs.writeFileSync(arqMd, gerarMarkdown({ alvo, geradoEm, indicadores, resultados }));

    console.log(`\n✅ Coleta concluída.\n   ${arqMd}\n   ${arqJson}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error("❌ Erro na coleta:", erro.message);
  process.exit(1);
});
