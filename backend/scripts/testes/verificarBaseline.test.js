// Testes do gate da baseline. Executar com: npm run test:guardas
import { test } from "node:test";
import assert from "node:assert/strict";
import { verificarResultado } from "./verificarBaseline.js";

const baseline = { testes: 4, arquivos: 2, pendentesPermitidos: 0 };

function relatorio({ arquivos = 2, porArquivo = 2, status = "passed", sucesso = true } = {}) {
  const testResults = Array.from({ length: arquivos }, (_, i) => ({
    name: `C:/x/backend/tests/caracterizacao/a${i}.test.js`,
    status: "passed",
    assertionResults: Array.from({ length: porArquivo }, (_, j) => ({ title: `t${j}`, status })),
  }));
  const total = arquivos * porArquivo;
  const passaram = status === "passed" ? total : 0;
  return {
    success: sucesso,
    numTotalTests: total,
    numPassedTests: passaram,
    numFailedTests: status === "failed" ? total : 0,
    numPendingTests: status === "pending" ? total : 0,
    numTodoTests: 0,
    testResults,
  };
}

test("resultado completo e verde é aprovado", () => {
  assert.deepEqual(verificarResultado(relatorio(), baseline), []);
});

test("falso sucesso: um arquivo a menos, com success=true, é reprovado", () => {
  const motivos = verificarResultado(relatorio({ arquivos: 1 }), baseline);
  assert.ok(motivos.some((m) => m.startsWith("arquivos de teste: 1")));
  assert.ok(motivos.some((m) => m.startsWith("testes reportados: 2")));
});

test("falso sucesso: testes pendentes com success=true são reprovados", () => {
  const r = relatorio();
  r.testResults[1].assertionResults[1].status = "pending";
  r.numPassedTests = 3;
  r.numPendingTests = 1;
  const motivos = verificarResultado(r, baseline);
  assert.ok(motivos.some((m) => m.includes("pendentes/todo: 1")));
  assert.ok(motivos.some((m) => m.includes("a1.test.js > t1: pending")));
});

test("testes a mais também reprovam (a baseline deve ser atualizada conscientemente)", () => {
  assert.ok(verificarResultado(relatorio({ porArquivo: 3 }), baseline).length > 0);
});

test("falhas e relatório inválido são reprovados", () => {
  assert.ok(verificarResultado(relatorio({ status: "failed", sucesso: false }), baseline).length > 0);
  assert.deepEqual(verificarResultado(null, baseline), ["relatório JSON do Vitest ausente ou inválido"]);
});

test("ehQuedaNativa reconhece só a queda 0xC0000409 do worker", async () => {
  const { ehQuedaNativa } = await import("./verificarBaseline.js");
  // Mensagem real capturada na Etapa 0.4 (caminhos abreviados)
  const real =
    "Caused by: Error: Worker exited unexpectedly with exit code 3221226505 during started state while running test files C:/x/tests/caracterizacao/producao.test.js";
  assert.equal(ehQuedaNativa(real), true);
  assert.equal(ehQuedaNativa("Worker exited unexpectedly with exit code 134 during started state"), false);
  assert.equal(ehQuedaNativa("AssertionError: expected 201 to be 200"), false);
  assert.equal(ehQuedaNativa("Worker exited unexpectedly with exit code 32212265050"), false);
  assert.equal(ehQuedaNativa(undefined), false);
});
