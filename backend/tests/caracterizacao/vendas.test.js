// Caracterização: vendas (vendasController: criar, buscar, atualizar,
// pagamento, deletar, listar com filtros; middleware validateVenda).
import { beforeEach, describe, expect, it } from "vitest";
import { n, prisma } from "./helpers/db.js";
import { api } from "./helpers/http.js";
import { autenticar, criarCliente, criarSabor, criarVenda } from "./helpers/fixtures.js";

let token, cliente, coco, limao;
beforeEach(async () => {
  token = await autenticar();
  cliente = await criarCliente("Mercearia Fictícia Aurora");
  coco = await criarSabor({ nome: "Coco Fictício" });
  limao = await criarSabor({ nome: "Limão Fictício" });
});

const novaVenda = (extra = {}) => ({
  clienteId: cliente.id,
  quantidade: 15,
  valor: 82.5,
  desconto: 0,
  data: "2026-03-10T14:00:00.000Z",
  sabores: [
    { saborId: coco.id, quantidade: 10 },
    { saborId: limao.id, quantidade: 5 },
  ],
  ...extra,
});
const itensDe = (vendaId) =>
  prisma.vendaSabor.findMany({ where: { vendaId }, orderBy: { saborId: "asc" } });

describe("POST /api/vendas — criação", () => {
  it("cria venda pendente com itens, cliente e sabores no retorno", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ desconto: 2.5 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      clienteId: cliente.id,
      quantidade: 15,
      data: "2026-03-10T14:00:00.000Z",
      pago: false,
      dataPagamento: null,
      idempotencyKey: null,
      cliente: { id: cliente.id, nome: cliente.nome },
    });
    expect(n(res.body.valor)).toBe(82.5);
    expect(n(res.body.desconto)).toBe(2.5);
    expect(res.body.sabores).toHaveLength(2);
    expect(res.body.sabores[0].sabor).toHaveProperty("nome");

    const itens = await itensDe(res.body.id);
    expect(itens.map((i) => [i.saborId, i.quantidade])).toEqual([[coco.id, 10], [limao.id, 5]]);
  });

  it("desconto omitido → 0; data omitida → agora", async () => {
    const antes = Date.now();
    const res = await api(token).post("/api/vendas").send(novaVenda({ desconto: undefined, data: undefined }));
    expect(n(res.body.desconto)).toBe(0);
    expect(new Date(res.body.data).getTime()).toBeGreaterThanOrEqual(antes - 1000);
  });

  it("pago=true na criação grava dataPagamento", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ pago: true }));
    expect(res.body.pago).toBe(true);
    expect(res.body.dataPagamento).not.toBeNull();
  });

  it("KNOWN_BEHAVIOR: a quantidade total NÃO é recalculada a partir dos itens", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ quantidade: 99 }));
    expect(res.status).toBe(201);
    expect(res.body.quantidade).toBe(99); // itens somam 15
  });

  it("KNOWN_BEHAVIOR: o valor vem do cliente HTTP (não é calculado pelo preço do sabor)", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ valor: 1 }));
    expect(res.status).toBe(201);
    expect(n(res.body.valor)).toBe(1);
  });

  it("KNOWN_BEHAVIOR: venda não valida estoque (sabor sem nenhuma produção é vendido)", async () => {
    expect(await prisma.producao.count()).toBe(0);
    const res = await api(token).post("/api/vendas").send(novaVenda());
    expect(res.status).toBe(201);
  });

  it("KNOWN_BEHAVIOR: sabor inativo é aceito", async () => {
    const inativo = await criarSabor({ nome: "Sabor Inativo", ativo: false });
    const res = await api(token).post("/api/vendas").send(novaVenda({ sabores: [{ saborId: inativo.id, quantidade: 15 }] }));
    expect(res.status).toBe(201);
  });

  it.each([
    [{ clienteId: undefined }, 400, "Cliente e quantidade são obrigatórios"],
    [{ quantidade: undefined }, 400, "Cliente e quantidade são obrigatórios"],
    [{ quantidade: "abc" }, 400, "Cliente e quantidade devem ser números"],
    [{ quantidade: -1 }, 400, "Quantidade deve ser maior que zero"],
    [{ valor: undefined }, 400, "Dados incompletos"],
    [{ sabores: [] }, 400, "Dados incompletos"],
    [{ sabores: undefined }, 400, "Dados incompletos"],
    [{ clienteId: 999999 }, 404, "Cliente não encontrado"],
  ])("validação %o → %s", async (extra, status, erro) => {
    const res = await api(token).post("/api/vendas").send(novaVenda(extra));
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: erro });
    expect(await prisma.venda.count()).toBe(0);
  });

  it("KNOWN_BEHAVIOR: sabor inexistente → 500 (erro de FK), e nada é gravado", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ sabores: [{ saborId: 999999, quantidade: 15 }] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/^Erro ao registrar venda: /);
    expect(await prisma.venda.count()).toBe(0);
  });
});

describe("GET /api/vendas/:id", () => {
  it("devolve a venda com cliente e sabores; 404 se não existe", async () => {
    const v = await criarVenda({ clienteId: cliente.id, itens: [{ saborId: coco.id, quantidade: 3 }] });
    const res = await api(token).get(`/api/vendas/${v.id}`);
    expect(res.status).toBe(200);
    expect(res.body.cliente.id).toBe(cliente.id);
    expect(res.body.sabores[0].sabor.id).toBe(coco.id);
    expect((await api(token).get("/api/vendas/999999")).status).toBe(404);
  });
});

describe("PUT /api/vendas/:id — edição", () => {
  let venda;
  beforeEach(async () => {
    venda = (await api(token).post("/api/vendas").send(novaVenda())).body;
  });

  it("substitui os itens e atualiza os campos enviados", async () => {
    const outro = await criarCliente("Quitanda Fictícia Boreal");
    const res = await api(token).put(`/api/vendas/${venda.id}`).send({
      clienteId: outro.id,
      quantidade: 8,
      valor: 44,
      desconto: 1,
      data: "2026-03-11T09:00:00.000Z",
      sabores: [{ saborId: limao.id, quantidade: 8 }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clienteId: outro.id, quantidade: 8, data: "2026-03-11T09:00:00.000Z" });
    expect(n(res.body.valor)).toBe(44);
    expect(n(res.body.desconto)).toBe(1);
    expect((await itensDe(venda.id)).map((i) => [i.saborId, i.quantidade])).toEqual([[limao.id, 8]]);
  });

  it("desconto 0 é aplicado (checagem explícita de undefined)", async () => {
    await api(token).put(`/api/vendas/${venda.id}`).send({ clienteId: cliente.id, quantidade: 15, desconto: 5, sabores: novaVenda().sabores });
    const res = await api(token).put(`/api/vendas/${venda.id}`).send({ clienteId: cliente.id, quantidade: 15, desconto: 0, sabores: novaVenda().sabores });
    expect(n(res.body.desconto)).toBe(0);
  });

  it("pago=true grava dataPagamento; pago=false limpa", async () => {
    const base = { clienteId: cliente.id, quantidade: 15, sabores: novaVenda().sabores };
    const pago = await api(token).put(`/api/vendas/${venda.id}`).send({ ...base, pago: true });
    expect(pago.body.pago).toBe(true);
    expect(pago.body.dataPagamento).not.toBeNull();
    const pendente = await api(token).put(`/api/vendas/${venda.id}`).send({ ...base, pago: false });
    expect(pendente.body).toMatchObject({ pago: false, dataPagamento: null });
  });

  it("KNOWN_BEHAVIOR: PUT exige clienteId e quantidade (validateVenda), mesmo para editar um campo", async () => {
    const res = await api(token).put(`/api/vendas/${venda.id}`).send({ valor: 10 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Cliente e quantidade são obrigatórios" });
  });

  it("KNOWN_BEHAVIOR: PUT sem 'sabores' APAGA todos os itens da venda", async () => {
    const res = await api(token).put(`/api/vendas/${venda.id}`).send({ clienteId: cliente.id, quantidade: 15 });
    expect(res.status).toBe(200);
    expect(res.body.quantidade).toBe(15);
    expect(await itensDe(venda.id)).toHaveLength(0);
  });

  it("KNOWN_BEHAVIOR: edição não atômica — se o update falha, os itens já foram apagados", async () => {
    // clienteId numérico inexistente passa na validação, os itens são apagados
    // e só então o update falha por chave estrangeira.
    const res = await api(token).put(`/api/vendas/${venda.id}`).send({
      clienteId: 999999,
      quantidade: 15,
      sabores: novaVenda().sabores,
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Erro ao atualizar venda" });
    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    expect(depois.clienteId).toBe(cliente.id); // venda intacta...
    expect(await itensDe(venda.id)).toHaveLength(0); // ...mas sem itens
  });

  it("inexistente → 404", async () => {
    const res = await api(token).put("/api/vendas/999999").send({ clienteId: cliente.id, quantidade: 1 });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/vendas/:id", () => {
  it("remove a venda e os itens (cascade)", async () => {
    const v = await criarVenda({ clienteId: cliente.id, itens: [{ saborId: coco.id, quantidade: 3 }] });
    const res = await api(token).delete(`/api/vendas/${v.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Venda deletada com sucesso" });
    expect(await prisma.venda.count()).toBe(0);
    expect(await prisma.vendaSabor.count()).toBe(0);
  });

  it("inexistente → 404", async () => {
    expect((await api(token).delete("/api/vendas/999999")).status).toBe(404);
  });
});

describe("PATCH /api/vendas/:id/pagamento", () => {
  let venda;
  beforeEach(async () => {
    venda = await criarVenda({ clienteId: cliente.id, itens: [{ saborId: coco.id, quantidade: 3 }] });
  });

  it("marca como paga com dataPagamento = agora", async () => {
    const antes = Date.now();
    const res = await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: true });
    expect(res.status).toBe(200);
    expect(res.body.pago).toBe(true);
    expect(new Date(res.body.dataPagamento).getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(res.body.cliente.id).toBe(cliente.id);
  });

  it("aceita dataPagamento explícita e a string 'true'", async () => {
    const res = await api(token)
      .patch(`/api/vendas/${venda.id}/pagamento`)
      .send({ pago: "true", dataPagamento: "2026-03-20T10:00:00.000Z" });
    expect(res.body).toMatchObject({ pago: true, dataPagamento: "2026-03-20T10:00:00.000Z" });
  });

  it("marcar como paga de novo preserva a primeira dataPagamento", async () => {
    await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: true, dataPagamento: "2026-03-20T10:00:00.000Z" });
    const res = await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: true });
    expect(res.body.dataPagamento).toBe("2026-03-20T10:00:00.000Z");
  });

  it("voltar para pendente limpa dataPagamento", async () => {
    await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: true });
    const res = await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: false });
    expect(res.body).toMatchObject({ pago: false, dataPagamento: null });
  });

  it("sem 'pago' → 400; venda inexistente → 404", async () => {
    const sem = await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({});
    expect(sem.status).toBe(400);
    expect(sem.body).toEqual({ error: "Campo 'pago' é obrigatório" });
    expect((await api(token).patch("/api/vendas/999999/pagamento").send({ pago: true })).status).toBe(404);
  });
});

describe("GET /api/vendas — filtros (servidor em TZ=UTC)", () => {
  let outro;
  beforeEach(async () => {
    outro = await criarCliente("Quitanda Fictícia Boreal");
    const item = [{ saborId: coco.id, quantidade: 1 }];
    await criarVenda({ clienteId: cliente.id, itens: item, data: new Date("2026-03-05T12:00:00.000Z"), pago: true });
    await criarVenda({ clienteId: outro.id, itens: item, data: new Date("2026-03-31T23:30:00.000Z") });
    await criarVenda({ clienteId: cliente.id, itens: item, data: new Date("2026-04-01T00:30:00.000Z"), pago: true });
    await criarVenda({ clienteId: outro.id, itens: item, data: new Date("2026-04-15T12:00:00.000Z") });
  });
  const datas = (res) => res.body.map((v) => v.data);

  it("sem filtro: todas, da mais recente para a mais antiga, com cliente e itens", async () => {
    const res = await api(token).get("/api/vendas");
    expect(datas(res)).toEqual([
      "2026-04-15T12:00:00.000Z",
      "2026-04-01T00:30:00.000Z",
      "2026-03-31T23:30:00.000Z",
      "2026-03-05T12:00:00.000Z",
    ]);
    expect(res.body[0].cliente).toBeDefined();
    expect(res.body[0].sabores[0].sabor).toBeDefined();
  });

  it("mes/ano usa o calendário do fuso do servidor (UTC): 31/03 23:30Z é março", async () => {
    expect(datas(await api(token).get("/api/vendas?mes=3&ano=2026"))).toEqual([
      "2026-03-31T23:30:00.000Z",
      "2026-03-05T12:00:00.000Z",
    ]);
    expect(datas(await api(token).get("/api/vendas?mes=4&ano=2026"))).toHaveLength(2);
  });

  it("KNOWN_BEHAVIOR: venda no último segundo fracionado do mês (23:59:59.500) cai fora de qualquer mês", async () => {
    await criarVenda({ clienteId: cliente.id, itens: [{ saborId: coco.id, quantidade: 1 }], data: new Date("2026-03-31T23:59:59.500Z") });
    const mar = datas(await api(token).get("/api/vendas?mes=3&ano=2026"));
    const abr = datas(await api(token).get("/api/vendas?mes=4&ano=2026"));
    expect(mar).not.toContain("2026-03-31T23:59:59.500Z");
    expect(abr).not.toContain("2026-03-31T23:59:59.500Z");
  });

  it("intervalo dataInicio/dataFim inclui o dia final inteiro", async () => {
    const res = await api(token).get("/api/vendas?dataInicio=2026-03-31&dataFim=2026-04-01");
    expect(datas(res)).toEqual(["2026-04-01T00:30:00.000Z", "2026-03-31T23:30:00.000Z"]);
  });

  it("intervalo tem precedência sobre mes/ano quando ambos são enviados", async () => {
    const res = await api(token).get("/api/vendas?mes=3&ano=2026&dataInicio=2026-04-10&dataFim=2026-04-30");
    expect(datas(res)).toEqual(["2026-04-15T12:00:00.000Z"]);
  });

  it("filtra por cliente, por pago=true/false e respeita limit", async () => {
    expect((await api(token).get(`/api/vendas?clienteId=${outro.id}`)).body).toHaveLength(2);
    expect((await api(token).get("/api/vendas?pago=true")).body.every((v) => v.pago)).toBe(true);
    expect((await api(token).get("/api/vendas?pago=true")).body).toHaveLength(2);
    expect((await api(token).get("/api/vendas?pago=false")).body).toHaveLength(2);
    expect((await api(token).get("/api/vendas?pago=talvez")).body).toHaveLength(4); // valor inválido é ignorado
    expect(datas(await api(token).get("/api/vendas?limit=1"))).toEqual(["2026-04-15T12:00:00.000Z"]);
  });
});
