/**
 * Executa o Prisma CLI contra o banco de desenvolvimento ou de teste,
 * sempre passando pelas guardas de ambiente. Nunca aponta para produção.
 *
 * Uso:
 *   node scripts/ambiente/prisma.js desenvolvimento db push
 *   node scripts/ambiente/prisma.js teste db push --force-reset --skip-generate
 *
 * No alvo "teste", DATABASE_URL é substituída por DATABASE_URL_TEST apenas
 * no processo filho do Prisma.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { FINALIDADES, carregarEnv, garantirAcessoAoBanco } from "./guardas.js";

const [finalidade, ...argsPrisma] = process.argv.slice(2);

if (!Object.values(FINALIDADES).includes(finalidade) || argsPrisma.length === 0) {
  console.error(
    "Uso: node scripts/ambiente/prisma.js <desenvolvimento|teste> <comando do prisma...>",
  );
  process.exit(1);
}

carregarEnv();
garantirAcessoAoBanco(finalidade, {
  operacao: `prisma ${argsPrisma.join(" ")}`,
  env: process.env,
});

const envFilho = { ...process.env };
if (finalidade === FINALIDADES.TESTE) {
  envFilho.APP_ENV = "test";
  envFilho.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const require = createRequire(import.meta.url);
const cliPrisma = require.resolve("prisma/build/index.js");

const { status } = spawnSync(process.execPath, [cliPrisma, ...argsPrisma], {
  stdio: "inherit",
  env: envFilho,
});

process.exit(status ?? 1);
