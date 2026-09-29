// Caracterização: clientes, estatísticas e rankings (clientesController;
// middleware validateCliente). Base das análises do futuro Agente de Vendas.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./helpers/db.js";
import { api } from "./helpers/http.js";
import { autenticar, criarCliente, criarSabor, criarVenda } from "./helpers/fixtures.js";

let token;
beforeEach(async () => {
  token = await autenticar();
});

describe("CRUD de clientes", () => {
  it("cria com trim; lista em ordem alfabética com contagem de vendas", async () => {
    const res = await api(token).post("/api/clientes").send({ nome: "  Quitanda Fictícia Boreal  " });
    expect(res.status).toBe(201);
    expect(res.body.nome).toBe("Quitanda Fictícia Boreal");
    await criarCliente("Armazém Fictício");
    const lista = (await api(token).get("/api/clientes")).body;
    expect(lista.map((c) => c.nome)).toEqual(["Armazém Fictício", "Quitanda Fictícia Boreal"]);
    expect(lista[0]._count).toEqual({ vendas: 0 });
  });

  it.each([
    ["", "Nome do cliente é obrigatório"],
    ["ab", "Nome deve ter pelo menos 3 caracteres"],
    ["x".repeat(101), "Nome não pode ter mais de 100 caracteres"],
  ])("validação nome=%j → 400", async (nome, erro) => {
    const res = await api(token).post("/api/clientes").send({ nome });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: erro });
  });

  it("nome duplicado ignorando maiúsculas → 400", async () => {
    await criarCliente("Quitanda Fictícia Boreal");
    const res = await api(token).post("/api/clientes").send({ nome: "QUITANDA fictícia boreal" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Já existe um cliente com este nome" });
  });

  it("KNOWN_BEHAVIOR: duplicidade não normaliza acentos ('Jose' e 'José' convivem)", async () => {
    await criarCliente("Padaria do José Fictícia");
    const res = await api(token).post("/api/clientes").send({ nome: "Padaria do Jose Fictícia" });
    expect(res.status).toBe(201);
  });

  it("PUT renomeia; nome de outro cliente → 400; inexistente → 404", async () => {
    const a = await criarCliente("Cliente Fictício Alfa");
    await criarCliente("Cliente Fictício Beta");
    expect((await api(token).put(`/api/clientes/${a.id}`).send({ nome: "Cliente Fictício Gama" })).body.nome).toBe("Cliente Fictício Gama");
    const dup = await api(token).put(`/api/clientes/${a.id}`).send({ nome: "cliente fictício beta" });
    expect(dup.status).toBe(400);
    expect(dup.body).toEqual({ error: "Já existe outro cliente com este nome" });
    expect((await api(token).put("/api/clientes/999999").send({ nome: "Qualquer Nome" })).status).toBe(404);
  });

  it("DELETE bloqueado se houver vendas; permitido sem vendas", async () => {
    const com = await criarCliente("Cliente Com Venda");
    const sem = await criarCliente("Cliente Sem Venda");
    const s = await criarSabor();
    await criarVenda({ clienteId: com.id, itens: [{ saborId: s.id, quantidade: 1 }] });

    const bloqueado = await api(token).delete(`/api/clientes/${com.id}`);
    expect(bloqueado.status).toBe(400);
    expect(bloqueado.body).toEqual({ error: "Cliente possui 1 venda(s) registrada(s). Não é possível deletar." });

    const ok = await api(token).delete(`/api/clientes/${sem.id}`);
    expect(ok.status).toBe(200);
    expect(await prisma.cliente.count()).toBe(1);
  });

  it("GET /:id devolve as 10 vendas mais recentes e a contagem total", async () => {
    const c = await criarCliente();
    const s = await criarSabor();
    for (let d = 1; d <= 12; d++) {
      await criarVenda({ clienteId: c.id, itens: [{ saborId: s.id, quantidade: 1 }], data: new Date(Date.UTC(2026, 2, d, 12)) });
    }
    const res = await api(token).get(`/api/clientes/${c.id}`);
    expect(res.body._count).toEqual({ vendas: 12 });
    expect(res.body.vendas).toHaveLength(10);
    expect(res.body.vendas[0].data).toBe("2026-03-12T12:00:00.000Z");
    expect((await api(token).get("/api/clientes/999999")).status).toBe(404);
  });
});

describe("estatísticas e sabores por cliente", () => {
  let cliente, coco, limao;
  beforeEach(async () => {
    cliente = await criarCliente("Cliente Fictício Alfa");
    coco = await criarSabor({ nome: "Coco Fictício" });
    limao = await criarSabor({ nome: "Limão Fictício" });
    await criarVenda({ clienteId: cliente.id, data: new Date("2026-03-02T12:00:00.000Z"), itens: [{ saborId: coco.id, quantidade: 10 }] });
    await criarVenda({ clienteId: cliente.id, data: new Date("2026-03-20T12:00:00.000Z"), itens: [{ saborId: coco.id, quantidade: 4 }, { saborId: limao.id, quantidade: 1 }] });
    await criarVenda({ clienteId: cliente.id, data: new Date("2026-04-05T12:00:00.000Z"), itens: [{ saborId: limao.id, quantidade: 5 }] });
  });

  it("GET /:id/estatisticas: totais, média, por mês (pt-BR) e últimas vendas", async () => {
    const res = await api(token).get(`/api/clientes/${cliente.id}/estatisticas`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalQuantidade: 20,
      totalVendas: 3,
      mediaQuantidade: 6.67,
      vendasPorMes: { "março de 2026": 15, "abril de 2026": 5 },
    });
    expect(res.body.ultimasVendas.map((v) => v.data)).toEqual([
      "2026-04-05T12:00:00.000Z",
      "2026-03-20T12:00:00.000Z",
      "2026-03-02T12:00:00.000Z",
    ]);
  });

  it("GET /:id/sabores: quantidade, vezes e porcentagem (string, 1 casa), do maior para o menor", async () => {
    const res = await api(token).get(`/api/clientes/${cliente.id}/sabores`);
    expect(res.body.totalGeral).toBe(20);
    expect(res.body.sabores).toEqual([
      { nome: "Coco Fictício", quantidade: 14, vezes: 2, porcentagem: "70.0" },
      { nome: "Limão Fictício", quantidade: 6, vezes: 2, porcentagem: "30.0" },
    ]);
  });

  it("cliente sem vendas: estatísticas zeradas e lista de sabores vazia", async () => {
    const vazio = await criarCliente("Cliente Fictício Vazio");
    const est = (await api(token).get(`/api/clientes/${vazio.id}/estatisticas`)).body;
    expect(est).toMatchObject({ totalQuantidade: 0, totalVendas: 0, mediaQuantidade: 0, vendasPorMes: {}, ultimasVendas: [] });
    const sab = (await api(token).get(`/api/clientes/${vazio.id}/sabores`)).body;
    expect(sab).toMatchObject({ totalGeral: 0, sabores: [] });
  });

  it("cliente inexistente → 404 nas duas rotas", async () => {
    expect((await api(token).get("/api/clientes/999999/estatisticas")).status).toBe(404);
    expect((await api(token).get("/api/clientes/999999/sabores")).status).toBe(404);
  });
});

describe("GET /api/clientes/ranking-sabores", () => {
  it("clientes por total comprado, com sabor favorito; clientes sem venda ficam de fora", async () => {
    const alfa = await criarCliente("Cliente Fictício Alfa");
    const beta = await criarCliente("Cliente Fictício Beta");
    await criarCliente("Cliente Fictício Sem Venda");
    const coco = await criarSabor({ nome: "Coco Fictício" });
    const limao = await criarSabor({ nome: "Limão Fictício" });
    await criarVenda({ clienteId: alfa.id, itens: [{ saborId: coco.id, quantidade: 3 }, { saborId: limao.id, quantidade: 1 }] });
    await criarVenda({ clienteId: beta.id, itens: [{ saborId: limao.id, quantidade: 9 }] });
    await criarVenda({ clienteId: beta.id, itens: [{ saborId: coco.id, quantidade: 1 }] });

    const res = await api(token).get("/api/clientes/ranking-sabores");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        cliente: "Cliente Fictício Beta",
        totalComprado: 10,
        saborFavorito: "Limão Fictício",
        quantidadeFavorito: 9,
        sabores: [
          { nome: "Limão Fictício", quantidade: 9, porcentagem: "90.0" },
          { nome: "Coco Fictício", quantidade: 1, porcentagem: "10.0" },
        ],
      },
      {
        cliente: "Cliente Fictício Alfa",
        totalComprado: 4,
        saborFavorito: "Coco Fictício",
        quantidadeFavorito: 3,
        sabores: [
          { nome: "Coco Fictício", quantidade: 3, porcentagem: "75.0" },
          { nome: "Limão Fictício", quantidade: 1, porcentagem: "25.0" },
        ],
      },
    ]);
  });

  it("KNOWN_BEHAVIOR: o ranking agrupa por NOME do cliente (não por id)", async () => {
    // Dois clientes com o mesmo nome só são possíveis fora da API (a API bloqueia),
    // mas o agrupamento por nome os fundiria.
    const a = await prisma.cliente.create({ data: { nome: "Nome Repetido Fictício" } });
    const b = await prisma.cliente.create({ data: { nome: "Nome Repetido Fictício" } });
    const s = await criarSabor();
    await criarVenda({ clienteId: a.id, itens: [{ saborId: s.id, quantidade: 2 }] });
    await criarVenda({ clienteId: b.id, itens: [{ saborId: s.id, quantidade: 3 }] });
    const res = await api(token).get("/api/clientes/ranking-sabores");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].totalComprado).toBe(5);
  });
});
