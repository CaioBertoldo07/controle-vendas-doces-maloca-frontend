// Caracterização: autenticação (authController, middlewares/auth.js)
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { JWT_SECRET_TESTE } from "./setup/ambiente.js";
import { prisma } from "./helpers/db.js";
import { api, cru } from "./helpers/http.js";
import { criarUsuario, tokenPara } from "./helpers/fixtures.js";

describe("ambiente da suíte", () => {
  it("roda com TZ=UTC (mesmo fuso do container de produção)", () => {
    expect(new Date(2026, 0, 1).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("POST /api/auth/login", () => {
  it("login válido devolve token e usuário sem a senha", async () => {
    const { usuario, senha } = await criarUsuario();
    const res = await api().post("/api/auth/login").send({ email: usuario.email, senha });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Login realizado com sucesso");
    expect(res.body.usuario).toEqual({ id: usuario.id, nome: usuario.nome, email: usuario.email });
    const payload = jwt.verify(res.body.token, JWT_SECRET_TESTE);
    expect(payload).toMatchObject({ id: usuario.id, email: usuario.email });
    expect(payload.exp - payload.iat).toBe(7 * 24 * 3600); // validade de 7 dias
  });

  it("senha errada → 401 com mensagem genérica", async () => {
    const { usuario } = await criarUsuario();
    const res = await api().post("/api/auth/login").send({ email: usuario.email, senha: "errada" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Email ou senha inválidos" });
  });

  it("email inexistente → 401 com a mesma mensagem", async () => {
    const res = await api().post("/api/auth/login").send({ email: "ninguem@exemplo.test", senha: "x" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Email ou senha inválidos" });
  });

  it("KNOWN_BEHAVIOR: login sem email → 500 (erro do Prisma, não 400)", async () => {
    const res = await api().post("/api/auth/login").send({ senha: "x" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Erro ao fazer login" });
  });

  it("rota de registro foi removida → 404", async () => {
    const res = await api().post("/api/auth/registro").send({ nome: "X", email: "x@exemplo.test", senha: "x" });
    expect(res.status).toBe(404);
  });
});

describe("rotas protegidas (verificarAuth)", () => {
  it("GET / é pública", async () => {
    const res = await api().get("/");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "online", version: "3.0.0" });
  });

  it("sem Authorization → 401 Token não fornecido", async () => {
    const res = await api().get("/api/clientes");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Token não fornecido" });
  });

  it("Authorization sem token → 401 Token mal formatado", async () => {
    const res = await cru().get("/api/clientes").set("Authorization", "Bearer");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Token mal formatado" });
  });

  it("token assinado com outro segredo → 401 Token inválido", async () => {
    const { usuario } = await criarUsuario();
    const falso = jwt.sign({ id: usuario.id }, "outro-segredo");
    const res = await api(falso).get("/api/clientes");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Token inválido" });
  });

  it("token expirado → 401 Token inválido", async () => {
    const { usuario } = await criarUsuario();
    const expirado = tokenPara(usuario, { exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await api(expirado).get("/api/clientes");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Token inválido" });
  });

  it("token de usuário que não existe mais → 401 Usuário não encontrado", async () => {
    const { usuario } = await criarUsuario();
    const token = tokenPara(usuario);
    await prisma.usuario.delete({ where: { id: usuario.id } });
    const res = await api(token).get("/api/clientes");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Usuário não encontrado" });
  });

  it("token válido → acesso liberado; /api/auth/verificar devolve o usuário", async () => {
    const { usuario } = await criarUsuario();
    const token = tokenPara(usuario);
    expect((await api(token).get("/api/clientes")).status).toBe(200);
    const res = await api(token).get("/api/auth/verificar");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Token válido",
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    });
  });

  it("KNOWN_BEHAVIOR: o esquema do Authorization não é verificado (qualquer palavra antes do token)", async () => {
    const { usuario } = await criarUsuario();
    const res = await cru().get("/api/clientes").set("Authorization", `Qualquer ${tokenPara(usuario)}`);
    expect(res.status).toBe(200);
  });
});
