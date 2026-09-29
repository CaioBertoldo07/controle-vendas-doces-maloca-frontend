// Caracterização: saldo de matéria-prima (soma de movimentações) e CRUD
// (materiasPrimasController; mesma regra de saldo usada na produção).
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./helpers/db.js";
import { api } from "./helpers/http.js";
import { autenticar, criarMateriaPrima, movimentar } from "./helpers/fixtures.js";

let token;
beforeEach(async () => {
  token = await autenticar();
});

const resumo = async () => (await api(token).get("/api/materias-primas/resumo")).body;

describe("GET /api/materias-primas/resumo — saldo", () => {
  it("ENTRADA soma, SAIDA subtrai, AJUSTE soma com o próprio sinal", async () => {
    const mp = await criarMateriaPrima({ nome: "Farinha Fictícia" });
    await movimentar(mp.id, { tipo: "ENTRADA", quantidade: 1000 });
    await movimentar(mp.id, { tipo: "ENTRADA", quantidade: 500.5 });
    await movimentar(mp.id, { tipo: "SAIDA", origem: "PRODUCAO", quantidade: 300 });
    await movimentar(mp.id, { tipo: "AJUSTE", origem: "MANUAL", quantidade: -100.25 });
    await movimentar(mp.id, { tipo: "AJUSTE", origem: "MANUAL", quantidade: 50 });

    expect(await resumo()).toEqual([
      {
        id: mp.id,
        nome: "Farinha Fictícia",
        unidadeBase: "g",
        saldo: 1150.25,
        saldoBaixo: false,
        saldoNegativo: false,
      },
    ]);
  });

  it("sem movimentações → saldo 0 (não é 'baixo' nem 'negativo')", async () => {
    await criarMateriaPrima();
    expect(await resumo()).toMatchObject([{ saldo: 0, saldoBaixo: false, saldoNegativo: false }]);
  });

  it("saldo que zera → 0", async () => {
    const mp = await criarMateriaPrima();
    await movimentar(mp.id, { tipo: "ENTRADA", quantidade: 400 });
    await movimentar(mp.id, { tipo: "SAIDA", quantidade: 400 });
    expect((await resumo())[0].saldo).toBe(0);
  });

  it("saldo negativo é permitido e sinalizado", async () => {
    const mp = await criarMateriaPrima();
    await movimentar(mp.id, { tipo: "SAIDA", quantidade: 30 });
    expect(await resumo()).toMatchObject([{ saldo: -30, saldoBaixo: false, saldoNegativo: true }]);
  });

  it.each([
    [199.999, true],
    [200, false],
    [0.001, true],
  ])("KNOWN_BEHAVIOR: 'saldo baixo' é 0 < saldo < 200 em qualquer unidade (saldo %s → %s)", async (q, baixo) => {
    const mp = await criarMateriaPrima({ unidadeBase: "un" });
    await movimentar(mp.id, { tipo: "ENTRADA", quantidade: q });
    expect((await resumo())[0].saldoBaixo).toBe(baixo);
  });

  it("KNOWN_BEHAVIOR: tipo desconhecido é ignorado no saldo", async () => {
    const mp = await criarMateriaPrima();
    await movimentar(mp.id, { tipo: "ENTRADA", quantidade: 100 });
    await movimentar(mp.id, { tipo: "OUTRO", quantidade: 999 });
    expect((await resumo())[0].saldo).toBe(100);
  });

  it("lista só ativas, em ordem alfabética", async () => {
    await criarMateriaPrima({ nome: "Zimbro Fictício" });
    await criarMateriaPrima({ nome: "Amêndoa Fictícia" });
    await criarMateriaPrima({ nome: "Inativa Fictícia", ativo: false });
    expect((await resumo()).map((m) => m.nome)).toEqual(["Amêndoa Fictícia", "Zimbro Fictício"]);
  });
});

describe("CRUD de matérias-primas", () => {
  it("cria com nome e unidade (trim)", async () => {
    const res = await api(token).post("/api/materias-primas").send({ nome: "  Cacau Fictício ", unidadeBase: " g " });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nome: "Cacau Fictício", unidadeBase: "g", ativo: true });
  });

  it.each([
    [{ unidadeBase: "g" }, "Nome é obrigatório"],
    [{ nome: "X" }, "Unidade base é obrigatória"],
  ])("validação %o → 400", async (body, erro) => {
    const res = await api(token).post("/api/materias-primas").send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: erro });
  });

  it("nome duplicado ativo → 400", async () => {
    await criarMateriaPrima({ nome: "Cacau Fictício" });
    const res = await api(token).post("/api/materias-primas").send({ nome: "Cacau Fictício", unidadeBase: "g" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Já existe uma matéria-prima com este nome" });
  });

  it("recriar nome de uma inativa reativa o MESMO registro (mantém histórico)", async () => {
    const antiga = await criarMateriaPrima({ nome: "Cacau Fictício", unidadeBase: "g", ativo: false });
    const res = await api(token).post("/api/materias-primas").send({ nome: "Cacau Fictício", unidadeBase: "ml" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: antiga.id, ativo: true, unidadeBase: "ml" });
  });

  it("DELETE é desativação (soft delete); movimentações permanecem", async () => {
    const mp = await criarMateriaPrima();
    await movimentar(mp.id, { quantidade: 10 });
    const res = await api(token).delete(`/api/materias-primas/${mp.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Matéria-prima desativada com sucesso" });
    expect((await prisma.materiaPrima.findUnique({ where: { id: mp.id } })).ativo).toBe(false);
    expect(await prisma.movimentacaoMateriaPrima.count()).toBe(1);
  });

  it("GET lista ativas; ?todos=true inclui inativas", async () => {
    await criarMateriaPrima({ nome: "Ativa Fictícia" });
    await criarMateriaPrima({ nome: "Inativa Fictícia", ativo: false });
    expect((await api(token).get("/api/materias-primas")).body).toHaveLength(1);
    expect((await api(token).get("/api/materias-primas?todos=true")).body).toHaveLength(2);
  });

  it("PUT atualiza campos informados; 404 se não existe", async () => {
    const mp = await criarMateriaPrima();
    const res = await api(token).put(`/api/materias-primas/${mp.id}`).send({ nome: " Novo Nome ", ativo: false });
    expect(res.body).toMatchObject({ nome: "Novo Nome", ativo: false, unidadeBase: "g" });
    expect((await api(token).put("/api/materias-primas/999999").send({ nome: "x" })).status).toBe(404);
  });
});
