// Caracterização: sabores e receitas (saboresController). A receita é a base
// do MRP caracterizado em producao.test.js.
import { beforeEach, describe, expect, it } from "vitest";
import { n, prisma } from "./helpers/db.js";
import { api } from "./helpers/http.js";
import { autenticar, criarCliente, criarMateriaPrima, criarSabor, criarVenda } from "./helpers/fixtures.js";

let token;
beforeEach(async () => {
  token = await autenticar();
});

describe("CRUD de sabores", () => {
  it("cria ativo com preço; lista só ativos (ordem alfabética) com contagem de vendas", async () => {
    const res = await api(token).post("/api/sabores").send({ nome: " Pistache Fictício ", precoUnitario: "6.5" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nome: "Pistache Fictício", ativo: true, rendimentoBase: null });
    expect(n(res.body.precoUnitario)).toBe(6.5);

    await criarSabor({ nome: "Amora Fictícia" });
    await criarSabor({ nome: "Inativo Fictício", ativo: false });
    const lista = (await api(token).get("/api/sabores")).body;
    expect(lista.map((s) => s.nome)).toEqual(["Amora Fictícia", "Pistache Fictício"]);
    expect(lista[0]._count).toEqual({ vendaSabores: 0 });
    expect((await api(token).get("/api/sabores?todos=true")).body).toHaveLength(3);
  });

  it.each([
    [{ precoUnitario: 5 }, "Nome do sabor é obrigatório"],
    [{ nome: "X", precoUnitario: 0 }, "Preço unitário inválido"],
    [{ nome: "X", precoUnitario: "abc" }, "Preço unitário inválido"],
  ])("validação %o → 400", async (body, erro) => {
    const res = await api(token).post("/api/sabores").send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: erro });
  });

  it("nome duplicado → 400", async () => {
    await criarSabor({ nome: "Pistache Fictício" });
    const res = await api(token).post("/api/sabores").send({ nome: "Pistache Fictício", precoUnitario: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Já existe um sabor com este nome" });
  });

  it("DELETE com vendas → desativa (soft); sem vendas → apaga e remove a receita", async () => {
    const comVenda = await criarSabor({ nome: "Com Venda Fictício" });
    const semVenda = await criarSabor({ nome: "Sem Venda Fictício" });
    const mp = await criarMateriaPrima();
    await prisma.receitaItem.create({ data: { saborId: semVenda.id, materiaPrimaId: mp.id, quantidadeBase: 1 } });
    const cliente = await criarCliente();
    await criarVenda({ clienteId: cliente.id, itens: [{ saborId: comVenda.id, quantidade: 1 }] });

    const des = await api(token).delete(`/api/sabores/${comVenda.id}`);
    expect(des.body).toMatchObject({ message: "Sabor desativado pois possui vendas vinculadas", desativado: true, sabor: { ativo: false } });

    const apag = await api(token).delete(`/api/sabores/${semVenda.id}`);
    expect(apag.body).toEqual({ message: "Sabor deletado com sucesso" });
    expect(await prisma.sabor.findUnique({ where: { id: semVenda.id } })).toBeNull();
    expect(await prisma.receitaItem.count()).toBe(0);
  });

  it("PUT atualiza nome/preço/ativo; inexistente → 404", async () => {
    const s = await criarSabor();
    const res = await api(token).put(`/api/sabores/${s.id}`).send({ precoUnitario: 7, ativo: false });
    expect(n(res.body.precoUnitario)).toBe(7);
    expect(res.body.ativo).toBe(false);
    expect((await api(token).put("/api/sabores/999999").send({ nome: "x" })).status).toBe(404);
  });
});

describe("receita do sabor (GET/PUT /api/sabores/:id/receita)", () => {
  it("salva rendimento e itens; GET devolve os itens com a matéria-prima", async () => {
    const s = await criarSabor();
    const acucar = await criarMateriaPrima({ nome: "Açúcar Fictício" });
    const coco = await criarMateriaPrima({ nome: "Coco Fictício" });
    const res = await api(token).put(`/api/sabores/${s.id}/receita`).send({
      rendimentoBase: "22",
      itens: [
        { materiaPrimaId: acucar.id, quantidadeBase: "1000" },
        { materiaPrimaId: coco.id, quantidadeBase: 395.5 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.rendimentoBase).toBe(22);
    expect(res.body.itens.map((i) => [i.materiaPrima.nome, n(i.quantidadeBase)])).toEqual([
      ["Açúcar Fictício", 1000],
      ["Coco Fictício", 395.5],
    ]);
    const get = (await api(token).get(`/api/sabores/${s.id}/receita`)).body;
    expect(get.rendimentoBase).toBe(22);
    expect(get.itens).toHaveLength(2);
  });

  it("salvar de novo SUBSTITUI os itens (não acumula); lista vazia remove todos", async () => {
    const s = await criarSabor();
    const mp = await criarMateriaPrima();
    await api(token).put(`/api/sabores/${s.id}/receita`).send({ rendimentoBase: 10, itens: [{ materiaPrimaId: mp.id, quantidadeBase: 1 }] });
    await api(token).put(`/api/sabores/${s.id}/receita`).send({ rendimentoBase: 10, itens: [{ materiaPrimaId: mp.id, quantidadeBase: 2 }] });
    expect(await prisma.receitaItem.count()).toBe(1);
    await api(token).put(`/api/sabores/${s.id}/receita`).send({ rendimentoBase: 10, itens: [] });
    expect(await prisma.receitaItem.count()).toBe(0);
  });

  it.each([[0], [-1], [undefined]])("rendimentoBase inválido (%s) → 400", async (rendimentoBase) => {
    const s = await criarSabor();
    const res = await api(token).put(`/api/sabores/${s.id}/receita`).send({ rendimentoBase, itens: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Rendimento base inválido" });
  });

  it("sabor inexistente → 404 (GET e PUT)", async () => {
    expect((await api(token).get("/api/sabores/999999/receita")).status).toBe(404);
    expect((await api(token).put("/api/sabores/999999/receita").send({ rendimentoBase: 1, itens: [] })).status).toBe(404);
  });
});
