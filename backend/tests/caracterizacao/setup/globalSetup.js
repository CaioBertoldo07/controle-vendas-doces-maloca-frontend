/**
 * Setup global da suíte (roda uma vez por execução):
 *   1. valida o ambiente (ambiente.js);
 *   2. recria o schema do banco de teste via wrapper protegido da Etapa 0.1;
 *   3. sobe o src/server.js REAL como processo filho, numa porta livre,
 *      apontando para o banco de teste, com TZ=UTC e segredos fictícios.
 * O servidor não é modificado nem importado: os testes o exercitam por HTTP.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_KEY_TESTE,
  JWT_SECRET_TESTE,
  TZ_TESTE,
  prepararAmbienteDeTeste,
} from "./ambiente.js";

const DIR_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOG_SERVIDOR = path.join(os.tmpdir(), "doces-maloca-caracterizacao-servidor.log");

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function esperarServidor(url, processo, tentativas = 100) {
  for (let i = 0; i < tentativas; i++) {
    if (processo.exitCode !== null) {
      throw new Error(`servidor de teste encerrou (código ${processo.exitCode}); veja ${LOG_SERVIDOR}`);
    }
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`servidor de teste não respondeu; veja ${LOG_SERVIDOR}`);
}

export default async function setup(project) {
  const { url, descricao } = prepararAmbienteDeTeste();
  console.log(`\n🧪 Banco de teste: ${descricao}`);

  // Schema limpo a cada execução (o wrapper reaplica as guardas da 0.1).
  const reset = spawnSync(
    process.execPath,
    ["scripts/ambiente/prisma.js", "teste", "db", "push", "--force-reset", "--skip-generate"],
    { cwd: DIR_BACKEND, encoding: "utf8" },
  );
  if (reset.status !== 0) {
    throw new Error(`falha ao recriar o banco de teste:\n${reset.stdout}\n${reset.stderr}`);
  }

  const porta = await portaLivre();
  const log = fs.createWriteStream(LOG_SERVIDOR, { flags: "w" });
  const servidor = spawn(process.execPath, ["src/server.js"], {
    cwd: DIR_BACKEND,
    env: {
      ...process.env,
      DATABASE_URL: url,
      APP_ENV: "test",
      PORT: String(porta),
      TZ: TZ_TESTE,
      JWT_SECRET: JWT_SECRET_TESTE,
      N8N_API_KEY: API_KEY_TESTE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servidor.stdout.pipe(log);
  servidor.stderr.pipe(log);

  const baseUrl = `http://127.0.0.1:${porta}`;
  await esperarServidor(`${baseUrl}/`, servidor);
  console.log(`🧪 Servidor de teste: ${baseUrl} (log: ${LOG_SERVIDOR})\n`);
  project.provide("baseUrl", baseUrl);

  return async () => {
    if (servidor.exitCode === null) {
      servidor.kill();
      await new Promise((r) => servidor.once("exit", r));
    }
    log.end();
  };
}
