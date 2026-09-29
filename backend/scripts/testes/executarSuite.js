/**
 * `npm test`: roda a suíte de caracterização completa e aplica o gate da
 * baseline. Termina com código ≠ 0 se o Vitest falhar OU se o relatório não
 * tiver exatamente os testes e arquivos esperados (falso sucesso).
 *
 * Para rodar um arquivo isolado (sem gate): npx vitest run <arquivo>
 * Modo watch (sem gate): npm run test:watch
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verificarResultado } from "./verificarBaseline.js";

const DIR_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(DIR_BACKEND, "tests", "caracterizacao", "baseline.json");

if (process.argv.length > 2) {
  console.error(
    "⛔ `npm test` executa sempre a suíte completa com o gate da baseline.\n" +
      "   Para um arquivo isolado (sem gate): npx vitest run <arquivo>",
  );
  process.exit(2);
}

const relatorio = path.join(os.tmpdir(), `doces-maloca-vitest-${process.pid}.json`);
const require = createRequire(import.meta.url);
const vitestBin = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");

const execucao = spawnSync(
  process.execPath,
  [vitestBin, "run", "--reporter=default", "--reporter=json", `--outputFile.json=${relatorio}`],
  { cwd: DIR_BACKEND, stdio: "inherit" },
);

if (execucao.status !== 0) {
  console.error(`\n⛔ Vitest terminou com código ${execucao.status}.`);
  process.exit(execucao.status ?? 1);
}

let resultado;
try {
  resultado = JSON.parse(fs.readFileSync(relatorio, "utf8"));
} finally {
  fs.rmSync(relatorio, { force: true });
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const motivos = verificarResultado(resultado, baseline);

if (motivos.length > 0) {
  console.error("\n⛔ GATE DA BASELINE REPROVADO (o Vitest saiu com 0, mas o resultado está incompleto):");
  for (const m of motivos) console.error(`   - ${m}`);
  console.error(`   Baseline: ${baseline.testes} testes em ${baseline.arquivos} arquivos (${path.relative(DIR_BACKEND, BASELINE)}).`);
  process.exit(1);
}

console.log(
  `\n✅ Gate da baseline aprovado: ${resultado.numPassedTests}/${baseline.testes} testes em ` +
    `${resultado.testResults.length}/${baseline.arquivos} arquivos, 0 falhas, 0 pendentes.`,
);
