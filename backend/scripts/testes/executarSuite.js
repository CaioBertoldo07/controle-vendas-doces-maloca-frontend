/**
 * `npm test`: roda a suíte de caracterização completa e aplica o gate da
 * baseline. Termina com código ≠ 0 se o Vitest falhar OU se o relatório não
 * tiver exatamente os testes e arquivos esperados (falso sucesso).
 *
 * Queda nativa do processo de teste: no Windows, o processo do Vitest às vezes
 * morre com 0xC0000409 (abort nativo; investigado na Etapa 0.4, anterior à
 * refatoração e fora do código sob teste, que roda em outro processo). Só
 * nesse caso, identificado pela assinatura exata, a suíte INTEIRA é refeita
 * do zero, até MAX_TENTATIVAS vezes. Falhas de teste nunca são repetidas, e o
 * gate continua exigindo uma execução completa 202/202.
 *
 * Para rodar um arquivo isolado (sem gate): npx vitest run <arquivo>
 * Modo watch (sem gate): npm run test:watch
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ehQuedaNativa, verificarResultado } from "./verificarBaseline.js";

const DIR_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(DIR_BACKEND, "tests", "caracterizacao", "baseline.json");
const MAX_TENTATIVAS = 3;

if (process.argv.length > 2) {
  console.error(
    "⛔ `npm test` executa sempre a suíte completa com o gate da baseline.\n" +
      "   Para um arquivo isolado (sem gate): npx vitest run <arquivo>",
  );
  process.exit(2);
}

const require = createRequire(import.meta.url);
const vitestBin = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");

/** Roda o Vitest espelhando a saída; devolve { codigo, saida, relatorio }. */
function executarVitest(relatorio) {
  return new Promise((resolve) => {
    const filho = spawn(
      process.execPath,
      [vitestBin, "run", "--reporter=default", "--reporter=json", `--outputFile.json=${relatorio}`],
      { cwd: DIR_BACKEND, stdio: ["inherit", "pipe", "pipe"] },
    );
    let saida = "";
    filho.stdout.on("data", (d) => { saida += d; process.stdout.write(d); });
    filho.stderr.on("data", (d) => { saida += d; process.stderr.write(d); });
    filho.on("close", (codigo) => resolve({ codigo, saida }));
  });
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
let quedasNativas = 0;

for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
  const relatorio = path.join(os.tmpdir(), `doces-maloca-vitest-${process.pid}-${tentativa}.json`);
  const { codigo, saida } = await executarVitest(relatorio);

  if (codigo !== 0) {
    fs.rmSync(relatorio, { force: true });
    if (ehQuedaNativa(saida)) {
      quedasNativas += 1;
      if (tentativa < MAX_TENTATIVAS) {
        console.error(
          `\n⚠️  Queda nativa do processo de teste (0xC0000409), não é falha de teste. ` +
            `Refazendo a suíte inteira do zero (tentativa ${tentativa + 1}/${MAX_TENTATIVAS}).\n`,
        );
        continue;
      }
      console.error(`\n⛔ ${MAX_TENTATIVAS} quedas nativas seguidas do processo de teste. Suíte não validada.`);
      process.exit(1);
    }
    console.error(`\n⛔ Vitest terminou com código ${codigo}.`);
    process.exit(codigo ?? 1);
  }

  let resultado;
  try {
    resultado = JSON.parse(fs.readFileSync(relatorio, "utf8"));
  } finally {
    fs.rmSync(relatorio, { force: true });
  }

  const motivos = verificarResultado(resultado, baseline);
  if (motivos.length > 0) {
    console.error("\n⛔ GATE DA BASELINE REPROVADO (o Vitest saiu com 0, mas o resultado está incompleto):");
    for (const m of motivos) console.error(`   - ${m}`);
    console.error(`   Baseline: ${baseline.testes} testes em ${baseline.arquivos} arquivos (${path.relative(DIR_BACKEND, BASELINE)}).`);
    process.exit(1);
  }

  const aviso = quedasNativas > 0 ? ` (após ${quedasNativas} queda(s) nativa(s) do processo de teste)` : "";
  console.log(
    `\n✅ Gate da baseline aprovado: ${resultado.numPassedTests}/${baseline.testes} testes em ` +
      `${resultado.testResults.length}/${baseline.arquivos} arquivos, 0 falhas, 0 pendentes${aviso}.`,
  );
  process.exit(0);
}

console.error(`\n⛔ ${MAX_TENTATIVAS} quedas nativas seguidas do processo de teste. Suíte não validada.`);
process.exit(1);
