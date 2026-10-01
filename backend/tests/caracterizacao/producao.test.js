// Caracterização: produção e MRP (producaoController: calcularNecessidades,
// getSaldoMateriaPrima, criar/atualizar/deletar produção).
// As funções internas não são exportadas; o comportamento é observado pela API
// e pelo efeito no banco (Producao, ProducaoSabor, MovimentacaoMateriaPrima).
import { beforeEach, describe, expect, it } from "vitest";
import { n, prisma } from "./helpers/db.js";
import { api } from "./helpers/http.js";
import {
  autenticar,
  cenarioReceitaBasica,
  criarMateriaPrima,
  criarSabor,
  definirReceita,
  movimentacoesDe,
  movimentar,
} from "./helpers/fixtures.js";

let token;
beforeEach(async () => {
  token = await autenticar();
});

const produzir = (sabores, extra = {}) =>
  api(token).post("/api/producao").send({ data: "2026-03-10T12:00:00", sabores, ...extra }); // civil de Manaus

/** Estado completo: produção, itens e TODAS as movimentações (atomicidade). */
const retratoProducao = async (id) => ({
  producao: await prisma.producao.findUnique({ where: { id } }),
  itens: await prisma.producaoSabor.findMany({ where: { producaoId: id }, orderBy: { id: "asc" } }),
  movimentacoes: await prisma.movimentacaoMateriaPrima.findMany({ orderBy: { id: "asc" } }),
});

/** Saídas de produção agrupadas por matéria-prima: { [mpId]: quantidade } */
async function saidasPorInsumo(where = {}) {
  const movs = await movimentacoesDe({ tipo: "SAIDA", ...where });
  return Object.fromEntries(movs.map((m) => [m.materiaPrimaId, n(m.quantidade)]));
}

describe("cálculo de necessidades (quantidadeBase × quantidade / rendimentoBase)", () => {
  it("abaixo do rendimento: 50 de 100 → 500 g açúcar e 250 g coco", async () => {
    const { acucar, coco, sabor } = await cenarioReceitaBasica();
    const res = await produzir([{ saborId: sabor.id, quantidade: 50 }]);
    expect(res.status).toBe(201);
    expect(await saidasPorInsumo()).toEqual({ [acucar.id]: 500, [coco.id]: 250 });
  });

  it("igual ao rendimento: 100 de 100 → 1000 g e 500 g", async () => {
    const { acucar, coco, sabor } = await cenarioReceitaBasica();
    await produzir([{ saborId: sabor.id, quantidade: 100 }]);
    expect(await saidasPorInsumo()).toEqual({ [acucar.id]: 1000, [coco.id]: 500 });
  });

  it("acima do rendimento: 250 de 100 → 2500 g e 1250 g", async () => {
    const { acucar, coco, sabor } = await cenarioReceitaBasica();
    await produzir([{ saborId: sabor.id, quantidade: 250 }]);
    expect(await saidasPorInsumo()).toEqual({ [acucar.id]: 2500, [coco.id]: 1250 });
  });

  it("vários sabores compartilhando insumo → UMA saída somada por matéria-prima", async () => {
    const { acucar, coco, sabor } = await cenarioReceitaBasica();
    const outro = await criarSabor({ nome: "Beijinho Fictício" });
    await definirReceita(outro.id, 50, [{ materiaPrimaId: acucar.id, quantidadeBase: 200 }]);

    const res = await produzir([
      { saborId: sabor.id, quantidade: 50 }, // 500 açúcar + 250 coco
      { saborId: outro.id, quantidade: 25 }, // 100 açúcar
    ]);
    expect(res.status).toBe(201);
    const movs = await movimentacoesDe({ tipo: "SAIDA" });
    expect(movs).toHaveLength(2);
    expect(await saidasPorInsumo()).toEqual({ [acucar.id]: 600, [coco.id]: 250 });
  });

  it("valores decimais são arredondados a 3 casas (toFixed(3))", async () => {
    // Receita de 22 cocadas: 1000 g coco + 1000 g açúcar + 395 g leite condensado
    const coco = await criarMateriaPrima({ nome: "Coco Ralado Fictício" });
    const acucar = await criarMateriaPrima({ nome: "Açúcar Cristal Fictício" });
    const leite = await criarMateriaPrima({ nome: "Leite Condensado Fictício" });
    const sabor = await criarSabor({ nome: "Cocada de Forno Fictícia" });
    await definirReceita(sabor.id, 22, [
      { materiaPrimaId: coco.id, quantidadeBase: 1000 },
      { materiaPrimaId: acucar.id, quantidadeBase: 1000 },
      { materiaPrimaId: leite.id, quantidadeBase: 395 },
    ]);
    for (const mp of [coco, acucar, leite]) await movimentar(mp.id, { quantidade: 5000 });

    await produzir([{ saborId: sabor.id, quantidade: 10 }]);
    expect(await saidasPorInsumo()).toEqual({
      [coco.id]: 454.545, // 1000 × 10 / 22 = 454,5454…
      [acucar.id]: 454.545,
      [leite.id]: 179.545, // 395 × 10 / 22 = 179,5454…
    });
  });

  it("KNOWN_BEHAVIOR: sabor sem receita é produzido sem consumir insumo", async () => {
    const semReceita = await criarSabor({ nome: "Sabor Sem Receita" });
    const res = await produzir([{ saborId: semReceita.id, quantidade: 80 }]);
    expect(res.status).toBe(201);
    expect(await movimentacoesDe({})).toHaveLength(0);
    expect(await prisma.producaoSabor.count()).toBe(1);
  });

  it("KNOWN_BEHAVIOR: receita sem rendimentoBase é ignorada (sem consumo)", async () => {
    const mp = await criarMateriaPrima();
    const sabor = await criarSabor({ nome: "Sabor Sem Rendimento" });
    await prisma.receitaItem.create({ data: { saborId: sabor.id, materiaPrimaId: mp.id, quantidadeBase: 100 } });
    const res = await produzir([{ saborId: sabor.id, quantidade: 10 }]);
    expect(res.status).toBe(201);
    expect(await movimentacoesDe({ tipo: "SAIDA" })).toHaveLength(0);
  });

  it("mistura de sabor com e sem receita: só o com receita consome", async () => {
    const { acucar, coco, sabor } = await cenarioReceitaBasica();
    const semReceita = await criarSabor({ nome: "Sabor Sem Receita" });
    await produzir([
      { saborId: sabor.id, quantidade: 10 },
      { saborId: semReceita.id, quantidade: 999 },
    ]);
    expect(await saidasPorInsumo()).toEqual({ [acucar.id]: 100, [coco.id]: 50 });
  });
});

describe("POST /api/producao — criação", () => {
  it("com insumos suficientes cria Producao, ProducaoSabor e SAIDA/PRODUCAO", async () => {
    const { acucar, sabor } = await cenarioReceitaBasica();
    const res = await produzir([{ saborId: sabor.id, quantidade: 50 }], { observacao: "  lote teste  " });

    expect(res.status).toBe(201);
    expect(res.body.observacao).toBe("lote teste"); // trim
    expect(res.body.data).toBe("2026-03-10T12:00:00.000-04:00");
    expect(res.body.sabores).toHaveLength(1);
    expect(res.body.sabores[0]).toMatchObject({ saborId: sabor.id, quantidade: 50, sabor: { id: sabor.id } });

    const [mov] = await movimentacoesDe({ tipo: "SAIDA", materiaPrimaId: acucar.id });
    expect(mov).toMatchObject({
      origem: "PRODUCAO",
      producaoId: res.body.id,
      custoId: null,
      observacao: `Produção #${res.body.id}`,
    });
    expect(mov.data.toISOString()).toBe("2026-03-10T12:00:00.000Z");
  });

  it("saldo exatamente igual à necessidade é aceito (comparação é saldo < necessidade)", async () => {
    const { sabor } = await cenarioReceitaBasica({ estoqueAcucar: 500, estoqueCoco: 250 });
    const res = await produzir([{ saborId: sabor.id, quantidade: 50 }]);
    expect(res.status).toBe(201);
  });

  it("insumo insuficiente → 422 com faltantes e NADA gravado", async () => {
    const { sabor } = await cenarioReceitaBasica({ estoqueAcucar: 200, estoqueCoco: 10000 });
    const res = await produzir([{ saborId: sabor.id, quantidade: 50 }]);

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "Estoque insuficiente de matéria-prima",
      faltantes: ["Açúcar Fictício: necessário 500.0g, disponível 200.0g (falta 300.0g)"],
    });
    expect(await prisma.producao.count()).toBe(0);
    expect(await movimentacoesDe({ tipo: "SAIDA" })).toHaveLength(0);
  });

  it("vários insumos faltando → um item por insumo em faltantes", async () => {
    const { sabor } = await cenarioReceitaBasica({ estoqueAcucar: 0, estoqueCoco: 100 });
    const res = await produzir([{ saborId: sabor.id, quantidade: 100 }]);
    expect(res.status).toBe(422);
    expect(res.body.faltantes).toEqual([
      "Açúcar Fictício: necessário 1000.0g, disponível 0.0g (falta 1000.0g)",
      "Coco Fictício: necessário 500.0g, disponível 100.0g (falta 400.0g)",
    ]);
  });

  it("KNOWN_BEHAVIOR: saldo negativo aparece como 'disponível 0.0', mas a falta usa o saldo real", async () => {
    const { acucar, sabor } = await cenarioReceitaBasica({ estoqueAcucar: 0 });
    await movimentar(acucar.id, { tipo: "SAIDA", origem: "PRODUCAO", quantidade: 50 }); // saldo −50
    const res = await produzir([{ saborId: sabor.id, quantidade: 10 }]); // precisa 100
    expect(res.status).toBe(422);
    expect(res.body.faltantes).toEqual([
      "Açúcar Fictício: necessário 100.0g, disponível 0.0g (falta 150.0g)",
    ]);
  });

  it("sem data usa o momento atual", async () => {
    const { sabor } = await cenarioReceitaBasica();
    const antes = Date.now();
    const res = await api(token).post("/api/producao").send({ sabores: [{ saborId: sabor.id, quantidade: 1 }] });
    expect(res.status).toBe(201);
    expect(new Date(res.body.data).getTime()).toBeGreaterThanOrEqual(antes - 1000);
  });

  it("validação: sem sabores → 400", async () => {
    const res = await api(token).post("/api/producao").send({ sabores: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Informe ao menos um sabor" });
  });

  it.each([
    ["quantidade zero", { quantidade: 0 }],
    ["quantidade negativa", { quantidade: -5 }],
    ["sem saborId", { saborId: undefined, quantidade: 5 }],
  ])("validação: %s → 400", async (_, item) => {
    const sabor = await criarSabor();
    const res = await produzir([{ saborId: sabor.id, ...item }]);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Quantidade inválida para um dos sabores" });
  });

  it("KNOWN_BEHAVIOR: sabor inexistente → 500 (não 404/400)", async () => {
    const res = await produzir([{ saborId: 999999, quantidade: 5 }]);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Erro ao registrar produção: Sabor 999999 não encontrado" });
    expect(await prisma.producao.count()).toBe(0);
  });
});

describe("PUT /api/producao/:id — edição", () => {
  async function producaoInicial(estoques) {
    const cenario = await cenarioReceitaBasica(estoques);
    const res = await produzir([{ saborId: cenario.sabor.id, quantidade: 50 }]);
    return { ...cenario, id: res.body.id };
  }

  it("recalcula: remove as saídas antigas e grava as novas (sem duplicar)", async () => {
    const { acucar, coco, sabor, id } = await producaoInicial();
    const res = await api(token).put(`/api/producao/${id}`).send({ sabores: [{ saborId: sabor.id, quantidade: 80 }] });

    expect(res.status).toBe(200);
    expect(res.body.sabores).toHaveLength(1);
    expect(res.body.sabores[0].quantidade).toBe(80);
    expect(await saidasPorInsumo({ producaoId: id })).toEqual({ [acucar.id]: 800, [coco.id]: 400 });
    expect(await movimentacoesDe({ producaoId: id })).toHaveLength(2);
  });

  it("verifica o saldo DEPOIS de reverter as saídas antigas desta produção", async () => {
    // Estoque 1000 g açúcar; produção inicial consome 500. Editar para 100 un.
    // precisa de 1000: só passa porque os 500 antigos voltam antes da checagem.
    const { acucar, sabor, id } = await producaoInicial({ estoqueAcucar: 1000 });
    const res = await api(token).put(`/api/producao/${id}`).send({ sabores: [{ saborId: sabor.id, quantidade: 100 }] });
    expect(res.status).toBe(200);
    expect(await saidasPorInsumo({ producaoId: id })).toMatchObject({ [acucar.id]: 1000 });
  });

  it("sem saldo para o novo cenário → 422 e rollback completo (itens e saídas antigos preservados)", async () => {
    const { acucar, sabor, id } = await producaoInicial({ estoqueAcucar: 1000 });
    const res = await api(token).put(`/api/producao/${id}`).send({ sabores: [{ saborId: sabor.id, quantidade: 150 }] });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "Estoque insuficiente de matéria-prima",
      faltantes: ["Açúcar Fictício: necessário 1500.0g, disponível 1000.0g (falta 500.0g)"],
    });
    expect(await saidasPorInsumo({ producaoId: id })).toMatchObject({ [acucar.id]: 500 });
    const itens = await prisma.producaoSabor.findMany({ where: { producaoId: id } });
    expect(itens.map((i) => i.quantidade)).toEqual([50]);
  });

  it("nova data é aplicada à produção e às saídas", async () => {
    const { sabor, id } = await producaoInicial();
    await api(token).put(`/api/producao/${id}`).send({
      data: "2026-04-02T08:00:00",
      sabores: [{ saborId: sabor.id, quantidade: 50 }],
    });
    const movs = await movimentacoesDe({ producaoId: id });
    expect(movs.every((m) => m.data.toISOString() === "2026-04-02T08:00:00.000Z")).toBe(true);
  });

  // Etapa 0.6: era KNOWN_BEHAVIOR K1 (editar só a observação APAGAVA as saídas de
  // insumo e não as recriava, devolvendo ao saldo um consumo que aconteceu).
  it("editar só a observação preserva itens e saídas de insumo (campo omitido)", async () => {
    const { acucar, id } = await producaoInicial();
    const antes = await retratoProducao(id);
    const res = await api(token).put(`/api/producao/${id}`).send({ observacao: "só texto" });

    expect(res.status).toBe(200);
    expect(res.body.observacao).toBe("só texto");
    const depois = await retratoProducao(id);
    expect(depois.itens).toEqual(antes.itens);
    expect(depois.movimentacoes).toEqual(antes.movimentacoes); // consumo preservado
    const resumo = await api(token).get("/api/materias-primas/resumo");
    expect(resumo.body.find((m) => m.id === acucar.id).saldo).toBe(9500); // 10000 − 500
  });

  it("KNOWN_BEHAVIOR: sabor inexistente na edição → 500 e nada muda", async () => {
    const { id } = await producaoInicial();
    const res = await api(token).put(`/api/producao/${id}`).send({ sabores: [{ saborId: 999999, quantidade: 1 }] });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Erro ao atualizar produção" });
    expect(await movimentacoesDe({ producaoId: id })).toHaveLength(2);
  });

  it("produção inexistente → 404", async () => {
    const res = await api(token).put("/api/producao/999999").send({ observacao: "x" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Registro não encontrado" });
  });

  // Etapa 0.6: edição parcial e atômica da produção.
  //   sabores AUSENTE  → itens e saídas preservados; só os campos enviados mudam
  //                      (uma data nova também é aplicada às saídas existentes);
  //   sabores PRESENTE → validados como na criação; necessidades, saldo, itens e
  //                      saídas substituídos numa única transação.
  // Toda falha deixa produção, itens e TODAS as movimentações como estavam.
  it("editar só a data preserva itens e quantidades das saídas, que passam a ter a nova data", async () => {
    const { id } = await producaoInicial();
    const antes = await retratoProducao(id);
    const res = await api(token).put(`/api/producao/${id}`).send({ data: "2026-04-05T10:00:00" });
    expect(res.status).toBe(200);
    expect(res.body.data).toBe("2026-04-05T10:00:00.000-04:00");
    const depois = await retratoProducao(id);
    expect(depois.itens).toEqual(antes.itens);
    expect(depois.movimentacoes.map((m) => [m.id, m.materiaPrimaId, n(m.quantidade)])).toEqual(
      antes.movimentacoes.map((m) => [m.id, m.materiaPrimaId, n(m.quantidade)]),
    );
    const daProducao = depois.movimentacoes.filter((m) => m.producaoId === id);
    expect(daProducao.every((m) => m.data.toISOString() === "2026-04-05T10:00:00.000Z")).toBe(true);
  });

  it("insumo insuficiente → 422 e estado exatamente igual ao anterior", async () => {
    const { sabor, id } = await producaoInicial({ estoqueAcucar: 1000 });
    const antes = await retratoProducao(id);
    const res = await api(token).put(`/api/producao/${id}`).send({ observacao: "nova", sabores: [{ saborId: sabor.id, quantidade: 150 }] });
    expect(res.status).toBe(422);
    expect(await retratoProducao(id)).toEqual(antes);
  });

  it("falha no meio da transação (observação acima de 255 caracteres, depois de apagar itens e saídas) → rollback total", async () => {
    const { sabor, id } = await producaoInicial();
    const antes = await retratoProducao(id);
    const res = await api(token).put(`/api/producao/${id}`).send({ observacao: "x".repeat(300), sabores: [{ saborId: sabor.id, quantidade: 80 }] });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Erro ao atualizar produção" });
    expect(await retratoProducao(id)).toEqual(antes);
  });

  it("sabores: [] → 400 (como na criação) e nada muda", async () => {
    const { id } = await producaoInicial();
    const antes = await retratoProducao(id);
    const res = await api(token).put(`/api/producao/${id}`).send({ sabores: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Informe ao menos um sabor" });
    expect(await retratoProducao(id)).toEqual(antes);
  });

  it("item inválido (quantidade 0) → 400 com a mesma regra da criação e nada muda", async () => {
    const { sabor, id } = await producaoInicial();
    const antes = await retratoProducao(id);
    const res = await api(token).put(`/api/producao/${id}`).send({ sabores: [{ saborId: sabor.id, quantidade: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Quantidade inválida para um dos sabores" });
    expect(await retratoProducao(id)).toEqual(antes);
  });
});

describe("DELETE /api/producao/:id — exclusão", () => {
  it("remove produção, itens (cascade) e saídas; saldo do insumo volta", async () => {
    const { acucar, sabor } = await cenarioReceitaBasica();
    const { body } = await produzir([{ saborId: sabor.id, quantidade: 50 }]);

    const res = await api(token).delete(`/api/producao/${body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Registro deletado com sucesso" });
    expect(await prisma.producao.count()).toBe(0);
    expect(await prisma.producaoSabor.count()).toBe(0);
    expect(await movimentacoesDe({ producaoId: body.id })).toHaveLength(0);
    const resumo = await api(token).get("/api/materias-primas/resumo");
    expect(resumo.body.find((m) => m.id === acucar.id).saldo).toBe(10000);
  });

  it("exclusão não afeta outras produções nem entradas de insumo", async () => {
    const { sabor } = await cenarioReceitaBasica();
    const a = (await produzir([{ saborId: sabor.id, quantidade: 10 }])).body;
    const b = (await produzir([{ saborId: sabor.id, quantidade: 20 }])).body;
    await api(token).delete(`/api/producao/${a.id}`);
    expect(await movimentacoesDe({ producaoId: b.id })).toHaveLength(2);
    expect(await movimentacoesDe({ tipo: "ENTRADA" })).toHaveLength(2);
  });

  it("inexistente → 404", async () => {
    const res = await api(token).delete("/api/producao/999999");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/producao — listagem", () => {
  it("filtra por mês/ano e ordena da mais recente para a mais antiga", async () => {
    const sabor = await criarSabor();
    for (const data of ["2026-03-01T10:00:00", "2026-03-31T23:30:00", "2026-04-01T00:30:00"]) {
      await produzir([{ saborId: sabor.id, quantidade: 1 }], { data });
    }
    const res = await api(token).get("/api/producao?mes=3&ano=2026");
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.data)).toEqual(["2026-03-31T23:30:00.000-04:00", "2026-03-01T10:00:00.000-04:00"]);
    expect(res.body[0].sabores[0].sabor.id).toBe(sabor.id);
  });
});
