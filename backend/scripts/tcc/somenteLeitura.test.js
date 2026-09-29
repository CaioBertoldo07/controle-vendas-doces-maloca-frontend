// Testes do validador somente leitura. Executar com: npm run test:guardas
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarSomenteLeitura } from "./somenteLeitura.js";
import { CONSULTAS } from "./consultasColeta.js";

test("todas as consultas do catálogo da coleta são aceitas", () => {
  for (const c of CONSULTAS) {
    const r = validarSomenteLeitura(c.sql);
    assert.equal(r.valida, true, `${c.nome}: ${r.motivo}`);
  }
});

test("aceita SELECT simples, WITH e ponto e vírgula final", () => {
  assert.equal(validarSomenteLeitura("SELECT 1").valida, true);
  assert.equal(validarSomenteLeitura("select count(*) from vendas;").valida, true);
  assert.equal(
    validarSomenteLeitura("WITH t AS (SELECT 1 AS x) SELECT x FROM t").valida,
    true,
  );
});

test("palavras proibidas dentro de literais não causam falso positivo", () => {
  assert.equal(
    validarSomenteLeitura("SELECT * FROM custos WHERE nome = 'update drop'").valida,
    true,
  );
});

test("rejeita escrita e DDL", () => {
  for (const sql of [
    "INSERT INTO clientes (nome) VALUES ('x')",
    "UPDATE vendas SET pago = 1",
    "DELETE FROM vendas",
    "DROP TABLE vendas",
    "ALTER TABLE vendas ADD COLUMN x INT",
    "TRUNCATE vendas",
    "REPLACE INTO clientes VALUES (1, 'x')",
    "CREATE TABLE x (id INT)",
    "SET SESSION TRANSACTION READ WRITE",
  ]) {
    assert.equal(validarSomenteLeitura(sql).valida, false, sql);
  }
});

test("rejeita SELECT com efeito colateral ou bloqueio", () => {
  for (const sql of [
    "SELECT * FROM vendas FOR UPDATE",
    "SELECT * FROM vendas LOCK IN SHARE MODE",
    "SELECT * INTO OUTFILE '/tmp/x' FROM vendas",
    "SELECT id INTO @x FROM vendas LIMIT 1",
    "SELECT SLEEP(10)",
    "SELECT BENCHMARK(1000000, MD5('x'))",
  ]) {
    assert.equal(validarSomenteLeitura(sql).valida, false, sql);
  }
});

test("rejeita múltiplas instruções e comentários", () => {
  for (const sql of [
    "SELECT 1; DELETE FROM vendas",
    "SELECT 1; SELECT 2",
    "SELECT 1 -- comentário",
    "SELECT 1 /* x */",
    "SELECT 1 # x",
  ]) {
    assert.equal(validarSomenteLeitura(sql).valida, false, sql);
  }
});

test("rejeita vazio e não-string", () => {
  assert.equal(validarSomenteLeitura("").valida, false);
  assert.equal(validarSomenteLeitura(null).valida, false);
  assert.equal(validarSomenteLeitura("SHOW TABLES").valida, false);
});
