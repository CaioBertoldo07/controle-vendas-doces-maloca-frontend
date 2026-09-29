/**
 * Dump lógico SOMENTE LEITURA do banco de produção (Etapa 0.2 do TCC).
 *
 * Deve ser executado via Railway CLI, que injeta DATABASE_URL do serviço no
 * processo sem exibi-la:
 *
 *   railway run --project <id> --environment production --service doce-maloca-backend \
 *     -- node scripts/tcc/backupProducao.js versao
 *   railway run ... -- node scripts/tcc/backupProducao.js dump
 *
 * Garantias:
 *   - nunca imprime usuário, senha ou URL (só host mascarado e nome do banco);
 *   - a senha vai para o container via variável MYSQL_PWD, não pela linha de comando;
 *   - só executa leitura: `SELECT VERSION()` ou `mysqldump --single-transaction`
 *     (snapshot consistente, sem LOCK TABLES, sem FLUSH);
 *   - grava em backend/.coleta-tcc/backups/ (ignorado pelo Git) e nunca sobrescreve.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR_BACKUPS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".coleta-tcc", "backups",
);
// Cliente na mesma versão do servidor de produção (MySQL 9.7.2, verificado na Etapa 0.2)
const IMAGEM = process.env.IMAGEM_MYSQL || "mysql:9.7";
const modo = process.argv[2];

function falhar(msg) {
  console.error(`⛔ ${msg}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  falhar("DATABASE_URL não encontrada. Rode via `railway run ... -- node scripts/tcc/backupProducao.js`.");
}

const u = new URL(process.env.DATABASE_URL);
if (u.protocol !== "mysql:") falhar("DATABASE_URL não é mysql://");
const host = u.hostname;
const porta = u.port || "3306";
const usuario = decodeURIComponent(u.username);
const banco = decodeURIComponent(u.pathname.slice(1));
console.error(`🎯 alvo: ${host.replace(/^[^.]+/, "***")}:*****/${banco}  (cliente ${IMAGEM})`);

const env = { ...process.env, MYSQL_PWD: decodeURIComponent(u.password) };

function docker(args, saida) {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", ["run", "--rm", "-e", "MYSQL_PWD", IMAGEM, ...args], {
      env,
      stdio: ["ignore", saida ? "pipe" : "inherit", "inherit"],
    });
    if (saida) p.stdout.pipe(saida);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker saiu com código ${code}`))));
  });
}

if (modo === "versao") {
  await docker([
    "mysql", "-h", host, "-P", porta, "-u", usuario, "-N", "-e",
    "SELECT VERSION() AS versao, @@version_comment AS distribuicao, @@global.time_zone AS fuso",
  ]);
} else if (modo === "dump") {
  fs.mkdirSync(DIR_BACKUPS, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const arquivo = path.join(DIR_BACKUPS, `producao-${carimbo}.sql`);
  const out = fs.createWriteStream(arquivo, { flags: "wx" }); // falha se já existir
  try {
    await docker([
      "mysqldump", "-h", host, "-P", porta, "-u", usuario,
      "--single-transaction", "--quick", "--skip-lock-tables",
      "--routines", "--triggers", "--no-tablespaces", "--set-gtid-purged=OFF",
      "--default-character-set=utf8mb4",
      banco, // sem --databases: o dump não contém CREATE DATABASE nem USE
    ], out);
  } finally {
    await new Promise((r) => out.end(r));
  }
  console.error(`✅ dump gravado: ${arquivo} (${fs.statSync(arquivo).size} bytes)`);
} else {
  falhar("uso: node scripts/tcc/backupProducao.js <versao|dump>");
}
