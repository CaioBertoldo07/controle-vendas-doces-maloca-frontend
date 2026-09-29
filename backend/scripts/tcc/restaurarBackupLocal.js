/**
 * Restaura um dump de produção no MySQL LOCAL do Docker (Etapa 0.2 do TCC).
 *
 *   npm run tcc:restaurar -- .coleta-tcc/backups/producao-AAAAMMDD-HHMMSS.sql
 *
 * Garantias:
 *   - só atua no container local `doces-maloca-mysql` (docker exec);
 *   - cria SEMPRE um banco novo `doces_maloca_restore_<carimbo>` e aborta se
 *     ele já existir: nunca substitui dev, test ou outro restore;
 *   - recusa dumps com CREATE DATABASE/USE (poderiam escrever em outro banco)
 *     ou sem a marca final "Dump completed" (dump incompleto);
 *   - concede ao usuário local `maloca` apenas SELECT no banco restaurado, para a
 *     coleta rodar com um usuário somente leitura.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

const CONTAINER = "doces-maloca-mysql";
const arquivo = process.argv[2];

function falhar(msg) {
  console.error(`⛔ ${msg}`);
  process.exit(1);
}

function mysqlRoot(sql) {
  const r = spawnSync(
    "docker",
    ["exec", CONTAINER, "sh", "-c", `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "${sql}"`],
    { encoding: "utf8" },
  );
  if (r.status !== 0) falhar(`erro no MySQL local: ${(r.stderr || "").replace(/.*Using a password.*\n?/g, "").trim()}`);
  return r.stdout.trim();
}

if (!arquivo || !fs.existsSync(arquivo)) falhar("informe o caminho de um dump existente");
if (fs.statSync(arquivo).size === 0) falhar("o dump está vazio");

// 1. Inspeção do dump
let completo = false;
const proibidas = [];
const rl = readline.createInterface({ input: fs.createReadStream(arquivo, "utf8") });
for await (const linha of rl) {
  if (/^\s*(USE\s|CREATE\s+DATABASE)/i.test(linha)) proibidas.push(linha.slice(0, 60));
  if (linha.startsWith("-- Dump completed")) completo = true;
}
if (proibidas.length) falhar(`dump contém instruções de troca/criação de banco: ${proibidas[0]}`);
if (!completo) falhar('dump sem a marca "-- Dump completed" (provavelmente incompleto)');

// 2. Banco de destino novo
const status = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER], { encoding: "utf8" });
if (status.stdout.trim() !== "true") falhar(`container ${CONTAINER} não está rodando (cd backend && docker compose up -d --wait)`);

const carimbo = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "_");
const destino = `doces_maloca_restore_${carimbo}`;
if (mysqlRoot(`SHOW DATABASES LIKE '${destino}'`)) falhar(`o banco ${destino} já existe; nada foi feito`);

mysqlRoot(`CREATE DATABASE ${destino} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
console.log(`📦 banco local criado: ${destino}`);

// 3. Importação via stdin
await new Promise((resolve, reject) => {
  const p = spawn(
    "docker",
    ["exec", "-i", CONTAINER, "sh", "-c", `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 ${destino}`],
    { stdio: ["pipe", "inherit", "pipe"] },
  );
  let erro = "";
  p.stderr.on("data", (d) => { erro += d; });
  fs.createReadStream(arquivo).pipe(p.stdin);
  p.on("close", (code) =>
    code === 0 ? resolve() : reject(new Error(erro.replace(/.*Using a password.*\n?/g, "").trim())),
  );
}).catch((e) => falhar(`falha ao importar: ${e.message}`));

// 4. Usuário local só com leitura no banco restaurado
mysqlRoot(`GRANT SELECT ON ${destino}.* TO 'maloca'@'%'`);

const tabelas = mysqlRoot(
  `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${destino}'`,
);
console.log(`✅ restaurado: ${tabelas} tabelas em ${destino} (usuário maloca: somente SELECT)`);
console.log("\nPróximo passo (coleta read-only):");
console.log(`  DATABASE_URL_COLETA="mysql://maloca:<senha-local>@127.0.0.1:3307/${destino}" npm run tcc:coleta -- --executar`);
console.log("  (<senha-local> = MYSQL_PASSWORD do docker compose; padrão: maloca_local)");
