// Caracterização: custos e entrada de matéria-prima (custosController,
// incluindo converterParaBase, que é interna e observada pela movimentação gerada).
import { beforeEach, describe, expect, it } from "vitest";
import { n, prisma } from "./helpers/db.js";
import { api } from "./helpers/http.js";
import { autenticar, criarMateriaPrima, movimentacoesDe } from "./helpers/fixtures.js";

let token;
beforeEach(async () => {
  token = await autenticar();
});

const custoBase = {
  nome: "Compra fictícia",
  categoria: "Matéria Prima",
  quantidade: 2,
  unidade: "kg",
  valorTotal: 30,
  data: "2026-03-15T12:00:00.000Z",
};
const criarCusto = (extra = {}) => api(token).post("/api/custos").send({ ...custoBase, ...extra });

describe("POST /api/custos — criação", () => {
  it("sem matéria-prima: cria o custo e NENHUMA movimentação", async () => {
    const res = await criarCusto({ observacao: "  obs  " });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      nome: "Compra fictícia",
      categoria: "Matéria Prima",
      unidade: "kg",
      observacao: "obs",
      materiaPrimaId: null,
      data: "2026-03-15T12:00:00.000Z",
    });
    expect(n(res.body.quantidade)).toBe(2);
    expect(n(res.body.valorTotal)).toBe(30);
    expect(await movimentacoesDe({})).toHaveLength(0);
  });

  it("categoria omitida → 'Matéria Prima' por padrão", async () => {
    const res = await criarCusto({ categoria: undefined });
    expect(res.body.categoria).toBe("Matéria Prima");
  });

  it("com matéria-prima: cria o custo e uma ENTRADA/CUSTO vinculada", async () => {
    const mp = await criarMateriaPrima({ nome: "Açúcar Fictício", unidadeBase: "g" });
    const res = await criarCusto({ materiaPrimaId: mp.id });
    expect(res.status).toBe(201);

    const movs = await movimentacoesDe({});
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({
      materiaPrimaId: mp.id,
      tipo: "ENTRADA",
      origem: "CUSTO",
      custoId: res.body.id,
      producaoId: null,
      observacao: "Compra: Compra fictícia",
    });
    expect(n(movs[0].quantidade)).toBe(2000);
    expect(movs[0].data.toISOString()).toBe("2026-03-15T12:00:00.000Z");
  });

  it.each([
    // [unidade do custo, unidade base, quantidade, quantidade gerada]
    ["kg", "g", 2, 2000],
    ["L", "ml", 1.5, 1500],
    ["g", "g", 250, 250],
    ["ml", "ml", 300, 300],
    ["un", "un", 12, 12],
  ])("conversão: %s → %s (%s → %s)", async (unidade, unidadeBase, quantidade, esperado) => {
    const mp = await criarMateriaPrima({ unidadeBase });
    await criarCusto({ materiaPrimaId: mp.id, unidade, quantidade });
    expect(n((await movimentacoesDe({}))[0].quantidade)).toBe(esperado);
  });

  it.each([
    ["cx", "g", 2, 2],
    ["pct", "g", 3, 3],
    ["saco", "g", 1, 1],
    ["un", "g", 12, 12],
    ["kg", "ml", 1, 1],
    ["l", "ml", 1, 1], // L minúsculo não é reconhecido
    ["KG", "g", 1, 1],
  ])(
    "KNOWN_BEHAVIOR: sem conversão, a quantidade entra crua: %s → %s (%s → %s)",
    async (unidade, unidadeBase, quantidade, esperado) => {
      const mp = await criarMateriaPrima({ unidadeBase });
      await criarCusto({ materiaPrimaId: mp.id, unidade, quantidade });
      expect(n((await movimentacoesDe({}))[0].quantidade)).toBe(esperado);
    },
  );

  it("KNOWN_BEHAVIOR: gera ENTRADA mesmo quando a categoria não é 'Matéria Prima'", async () => {
    const mp = await criarMateriaPrima();
    await criarCusto({ materiaPrimaId: mp.id, categoria: "Embalagem" });
    expect(await movimentacoesDe({ tipo: "ENTRADA" })).toHaveLength(1);
  });

  it.each([
    [{ nome: "" }, "Nome é obrigatório"],
    [{ quantidade: 0 }, "Quantidade inválida"],
    [{ quantidade: -1 }, "Quantidade inválida"],
    [{ unidade: " " }, "Unidade é obrigatória"],
    [{ valorTotal: 0 }, "Valor inválido"],
    [{ materiaPrimaId: 999999 }, "Matéria-prima não encontrada"],
  ])("validação %o → 400", async (extra, erro) => {
    const res = await criarCusto(extra);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: erro });
    expect(await prisma.custo.count()).toBe(0);
  });
});

describe("PUT /api/custos/:id — edição", () => {
  async function custoComInsumo() {
    const mp = await criarMateriaPrima({ unidadeBase: "g" });
    const { body } = await criarCusto({ materiaPrimaId: mp.id });
    return { mp, id: body.id };
  }

  it("nova quantidade: remove a movimentação antiga e cria outra recalculada", async () => {
    const { mp, id } = await custoComInsumo();
    const res = await api(token).put(`/api/custos/${id}`).send({ quantidade: 3 });
    expect(res.status).toBe(200);
    const movs = await movimentacoesDe({ custoId: id });
    expect(movs).toHaveLength(1);
    expect(n(movs[0].quantidade)).toBe(3000);
    expect(movs[0].materiaPrimaId).toBe(mp.id);
  });

  it("nova unidade e data são usadas na movimentação recriada", async () => {
    const { id } = await custoComInsumo();
    await api(token).put(`/api/custos/${id}`).send({ unidade: "g", quantidade: 750, data: "2026-04-01T09:00:00.000Z" });
    const [mov] = await movimentacoesDe({ custoId: id });
    expect(n(mov.quantidade)).toBe(750);
    expect(mov.data.toISOString()).toBe("2026-04-01T09:00:00.000Z");
  });

  it("sem materiaPrimaId no corpo: mantém o vínculo atual", async () => {
    const { mp, id } = await custoComInsumo();
    await api(token).put(`/api/custos/${id}`).send({ nome: "Renomeado" });
    const [mov] = await movimentacoesDe({ custoId: id });
    expect(mov.materiaPrimaId).toBe(mp.id);
    expect(mov.observacao).toBe("Compra: Renomeado");
  });

  it("materiaPrimaId null: desvincula e remove a movimentação", async () => {
    const { id } = await custoComInsumo();
    const res = await api(token).put(`/api/custos/${id}`).send({ materiaPrimaId: null });
    expect(res.body.materiaPrimaId).toBeNull();
    expect(await movimentacoesDe({ custoId: id })).toHaveLength(0);
  });

  it("vincular na edição um custo que não tinha insumo cria a ENTRADA", async () => {
    const mp = await criarMateriaPrima({ unidadeBase: "g" });
    const { body } = await criarCusto();
    await api(token).put(`/api/custos/${body.id}`).send({ materiaPrimaId: mp.id });
    const movs = await movimentacoesDe({ custoId: body.id });
    expect(movs).toHaveLength(1);
    expect(n(movs[0].quantidade)).toBe(2000);
  });

  it("insumo inexistente → 400 e nada muda", async () => {
    const { id } = await custoComInsumo();
    const res = await api(token).put(`/api/custos/${id}`).send({ materiaPrimaId: 999999 });
    expect(res.status).toBe(400);
    expect(await movimentacoesDe({ custoId: id })).toHaveLength(1);
  });

  it("KNOWN_BEHAVIOR: valores 'falsy' (0) são ignorados na edição", async () => {
    const { id } = await custoComInsumo();
    const res = await api(token).put(`/api/custos/${id}`).send({ valorTotal: 0 });
    expect(res.status).toBe(200);
    expect(n(res.body.valorTotal)).toBe(30);
  });

  it("inexistente → 404", async () => {
    const res = await api(token).put("/api/custos/999999").send({ nome: "x" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Custo não encontrado" });
  });
});

describe("DELETE /api/custos/:id", () => {
  it("remove o custo e a movimentação associada, sem tocar nas demais", async () => {
    const mp = await criarMateriaPrima({ unidadeBase: "g" });
    const a = (await criarCusto({ materiaPrimaId: mp.id })).body;
    const b = (await criarCusto({ materiaPrimaId: mp.id, quantidade: 1 })).body;

    const res = await api(token).delete(`/api/custos/${a.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Custo deletado com sucesso" });
    expect(await prisma.custo.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await movimentacoesDe({ custoId: a.id })).toHaveLength(0);
    expect(await movimentacoesDe({ custoId: b.id })).toHaveLength(1);
  });

  it("inexistente → 404", async () => {
    expect((await api(token).delete("/api/custos/999999")).status).toBe(404);
  });
});

describe("GET /api/custos e /api/custos/resumo", () => {
  async function dataset() {
    const mp = await criarMateriaPrima({ nome: "Insumo Listado" });
    await criarCusto({ categoria: "Matéria Prima", valorTotal: 100, data: "2026-03-01T00:00:00.000Z", materiaPrimaId: mp.id });
    await criarCusto({ categoria: "Embalagem", valorTotal: 50.5, data: "2026-03-31T23:30:00.000Z" });
    await criarCusto({ categoria: "Outros", valorTotal: 20, data: "2026-04-01T00:30:00.000Z" });
  }

  it("listagem filtra por mês/ano e categoria, mais recente primeiro, com o insumo", async () => {
    await dataset();
    const mar = (await api(token).get("/api/custos?mes=3&ano=2026")).body;
    expect(mar.map((c) => c.categoria)).toEqual(["Embalagem", "Matéria Prima"]);
    expect(mar[1].materiaPrima).toMatchObject({ nome: "Insumo Listado", unidadeBase: "g" });
    const emb = (await api(token).get("/api/custos?categoria=Embalagem")).body;
    expect(emb).toHaveLength(1);
  });

  it("resumo do mês: total, itens, por categoria e 12 meses", async () => {
    await dataset();
    const res = await api(token).get("/api/custos/resumo?mes=3&ano=2026");
    expect(res.status).toBe(200);
    expect(res.body.totalGeral).toBe("150.50");
    expect(res.body.totalItens).toBe(2);
    expect(res.body.porCategoria).toEqual({ "Matéria Prima": 100, Embalagem: 50.5 });
    expect(res.body.meses).toHaveLength(12);
    expect(res.body.meses[2]).toEqual({ mes: 3, nomeMes: "março", total: "150.50", quantidade: 2 });
    expect(res.body.meses[3]).toMatchObject({ mes: 4, total: "20.00", quantidade: 1 });
    expect(res.body.meses[0]).toMatchObject({ total: "0.00", quantidade: 0 });
  });
});
