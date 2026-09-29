// Testes das guardas de ambiente. Executar com: npm run test:guardas
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FINALIDADES,
  analisarUrlBanco,
  avaliarAcessoAoBanco,
} from "./guardas.js";

const DEV_LOCAL = "mysql://maloca:maloca_local@127.0.0.1:3307/doces_maloca_dev";
const TEST_LOCAL = "mysql://maloca:maloca_local@127.0.0.1:3307/doces_maloca_test";
const PROD_PROXY = "mysql://root:segredo@exemplo.proxy.rlwy.net:12345/railway";
const PROD_INTERNO = "mysql://root:segredo@mysql.railway.internal:3306/railway";

const { DESENVOLVIMENTO, TESTE } = FINALIDADES;

test("analisarUrlBanco identifica host local e host do Railway", () => {
  assert.equal(analisarUrlBanco(DEV_LOCAL).local, true);
  assert.equal(analisarUrlBanco(DEV_LOCAL).banco, "doces_maloca_dev");
  assert.equal(analisarUrlBanco(PROD_PROXY).hostDeProducao, true);
  assert.equal(analisarUrlBanco(PROD_INTERNO).hostDeProducao, true);
  assert.equal(analisarUrlBanco("postgres://x@localhost/db").valida, false);
  assert.equal(analisarUrlBanco(undefined).valida, false);
});

test("desenvolvimento: permite banco local com APP_ENV=development", () => {
  const r = avaliarAcessoAoBanco(DESENVOLVIMENTO, {
    APP_ENV: "development",
    DATABASE_URL: DEV_LOCAL,
  });
  assert.equal(r.permitido, true, r.motivos.join("; "));
});

test("desenvolvimento: bloqueia quando APP_ENV não foi declarado", () => {
  const r = avaliarAcessoAoBanco(DESENVOLVIMENTO, { DATABASE_URL: DEV_LOCAL });
  assert.equal(r.permitido, false);
});

test("desenvolvimento: bloqueia APP_ENV=production e NODE_ENV=production", () => {
  for (const env of [
    { APP_ENV: "production", DATABASE_URL: DEV_LOCAL },
    { APP_ENV: "development", NODE_ENV: "production", DATABASE_URL: DEV_LOCAL },
  ]) {
    assert.equal(avaliarAcessoAoBanco(DESENVOLVIMENTO, env).permitido, false);
  }
});

test("desenvolvimento: bloqueia host do Railway mesmo com a liberação de host remoto", () => {
  for (const url of [PROD_PROXY, PROD_INTERNO]) {
    const r = avaliarAcessoAoBanco(DESENVOLVIMENTO, {
      APP_ENV: "development",
      DATABASE_URL: url,
      ALLOW_NON_LOCAL_DEV_DATABASE: "true",
    });
    assert.equal(r.permitido, false);
  }
});

test("desenvolvimento: bloqueia quando executado dentro do Railway", () => {
  const r = avaliarAcessoAoBanco(DESENVOLVIMENTO, {
    APP_ENV: "development",
    DATABASE_URL: DEV_LOCAL,
    RAILWAY_ENVIRONMENT_NAME: "production",
  });
  assert.equal(r.permitido, false);
});

test("desenvolvimento: host remoto desconhecido exige liberação explícita", () => {
  const env = {
    APP_ENV: "development",
    DATABASE_URL: "mysql://u:p@db.exemplo.com:3306/doces_maloca_dev",
  };
  assert.equal(avaliarAcessoAoBanco(DESENVOLVIMENTO, env).permitido, false);
  assert.equal(
    avaliarAcessoAoBanco(DESENVOLVIMENTO, {
      ...env,
      ALLOW_NON_LOCAL_DEV_DATABASE: "true",
    }).permitido,
    true,
  );
});

test("teste: permite banco local terminado em _test e diferente do dev", () => {
  const r = avaliarAcessoAoBanco(TESTE, {
    DATABASE_URL: DEV_LOCAL,
    DATABASE_URL_TEST: TEST_LOCAL,
  });
  assert.equal(r.permitido, true, r.motivos.join("; "));
});

test("teste: bloqueia DATABASE_URL_TEST ausente", () => {
  assert.equal(
    avaliarAcessoAoBanco(TESTE, { DATABASE_URL: DEV_LOCAL }).permitido,
    false,
  );
});

test("teste: bloqueia banco sem sufixo _test", () => {
  const r = avaliarAcessoAoBanco(TESTE, {
    DATABASE_URL_TEST: "mysql://u:p@127.0.0.1:3307/doces_maloca_dev2",
  });
  assert.equal(r.permitido, false);
});

test("teste: bloqueia quando teste e desenvolvimento são o mesmo banco", () => {
  const mesmo = "mysql://u:p@127.0.0.1:3307/app_test";
  const r = avaliarAcessoAoBanco(TESTE, {
    DATABASE_URL: mesmo,
    DATABASE_URL_TEST: mesmo,
  });
  assert.equal(r.permitido, false);
});

test("teste: bloqueia produção por qualquer indicador", () => {
  const casos = [
    { DATABASE_URL_TEST: TEST_LOCAL, APP_ENV: "production" },
    { DATABASE_URL_TEST: TEST_LOCAL, NODE_ENV: "production" },
    { DATABASE_URL_TEST: TEST_LOCAL, RAILWAY_PROJECT_ID: "x" },
    {
      DATABASE_URL_TEST: "mysql://u:p@abc.proxy.rlwy.net:1/railway_test",
      ALLOW_NON_LOCAL_DEV_DATABASE: "true",
    },
  ];
  for (const env of casos) {
    assert.equal(avaliarAcessoAoBanco(TESTE, env).permitido, false);
  }
});

test("finalidade desconhecida é negada", () => {
  assert.equal(avaliarAcessoAoBanco("producao", {}).permitido, false);
});
