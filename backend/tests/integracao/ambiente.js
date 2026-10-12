// Ambiente dos testes de integração: banco de TESTE local (docker compose),
// sempre validado pelas guardas de ambiente, e o src/server.js real.
//
//   cd backend && docker compose up -d && npm run test:integracao
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { carregarEnv, garantirAcessoAoBanco } from "../../scripts/ambiente/guardas.js";

const DIR_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const JWT_SECRET = "segredo-somente-para-testes";

let servidor;
let baseUrl;
export let prisma;

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export async function iniciarAmbiente() {
  carregarEnv();
  garantirAcessoAoBanco("teste", { operacao: "testes de integração", env: process.env });
  const urlTeste = process.env.DATABASE_URL_TEST;

  // Recria o schema no banco de teste (descartável), pelas mesmas guardas.
  const reset = spawnSync(
    process.execPath,
    ["scripts/ambiente/prisma.js", "teste", "db", "push", "--force-reset", "--skip-generate"],
    { cwd: DIR_BACKEND, encoding: "utf8" },
  );
  if (reset.status !== 0) {
    throw new Error(`Falha ao recriar o banco de teste:\n${reset.stdout}\n${reset.stderr}`);
  }

  prisma = new PrismaClient({ datasources: { db: { url: urlTeste } } });

  const porta = await portaLivre();
  baseUrl = `http://127.0.0.1:${porta}`;
  servidor = spawn(process.execPath, ["src/server.js"], {
    cwd: DIR_BACKEND,
    env: {
      ...process.env,
      APP_ENV: "test",
      DATABASE_URL: urlTeste,
      PORT: String(porta),
      JWT_SECRET,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });

  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${baseUrl}/`)).ok) return;
    } catch {
      // servidor ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Servidor de teste não respondeu");
}

export async function encerrarAmbiente() {
  servidor?.kill();
  await prisma?.$disconnect();
}

// Apaga todos os dados do banco de teste (ordem respeita as chaves estrangeiras).
export async function limparBanco() {
  await prisma.ajusteEstoque.deleteMany();
  await prisma.vendaSabor.deleteMany();
  await prisma.venda.deleteMany();
  await prisma.producaoSabor.deleteMany();
  await prisma.producao.deleteMany();
  await prisma.sabor.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.usuario.deleteMany();
}

export const tokenPara = (usuario) =>
  jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: "1h" });

export const tokenComSegredoErrado = (usuario) =>
  jwt.sign({ id: usuario.id, email: usuario.email }, "outro-segredo");

export async function api(metodo, rota, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/api${rota}`, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    dados = texto;
  }
  return { status: res.status, dados };
}
