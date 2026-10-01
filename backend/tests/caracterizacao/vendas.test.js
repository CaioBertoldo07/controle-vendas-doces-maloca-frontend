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
  data: "2026-03-10T14:00:00", // data-hora civil de Manaus (contrato da 0.5)
  sabores: [
    { saborId: coco.id, quantidade: 10 },
    { saborId: limao.id, quantidade: 5 },
  ],
  ...extra,
});
const itensDe = (vendaId) =>
  prisma.vendaSabor.findMany({ where: { vendaId }, orderBy: { saborId: "asc" } });
/** Estado completo da venda e dos itens, lido direto do banco (atomicidade). */
const retratoVenda = async (id) => ({
  venda: await prisma.venda.findUnique({ where: { id } }),
  itens: await prisma.vendaSabor.findMany({ where: { vendaId: id }, orderBy: { id: "asc" } }),
});

describe("POST /api/vendas — criação", () => {
  it("cria venda pendente com itens, cliente e sabores no retorno", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ desconto: 2.5 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      clienteId: cliente.id,
      quantidade: 15,
      data: "2026-03-10T14:00:00.000-04:00",
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

  // Etapa 0.6: era KNOWN_BEHAVIOR K8 (a quantidade do payload era gravada como veio).
  it("quantidade total é a soma dos itens; a quantidade do payload é ignorada (99 → 15)", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ quantidade: 99 }));
    expect(res.status).toBe(201);
    expect(res.body.quantidade).toBe(15); // itens 10 + 5
    expect((await prisma.venda.findUnique({ where: { id: res.body.id } })).quantidade).toBe(15);
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
      data: "2026-03-11T09:00:00",
      sabores: [{ saborId: limao.id, quantidade: 8 }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clienteId: outro.id, quantidade: 8, data: "2026-03-11T09:00:00.000-04:00" });
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

  // Etapa 0.6: era KNOWN_BEHAVIOR K2 (PUT sem 'sabores' APAGAVA todos os itens).
  it("PUT sem 'sabores' (campo omitido) preserva os itens e a quantidade", async () => {
    const antes = await itensDe(venda.id);
    const res = await api(token).put(`/api/vendas/${venda.id}`).send({ clienteId: cliente.id, quantidade: 15 });
    expect(res.status).toBe(200);
    expect(res.body.quantidade).toBe(15);
    expect(await itensDe(venda.id)).toEqual(antes);
  });

  // Etapa 0.6: era KNOWN_BEHAVIOR K3 (edição não atômica: os itens eram apagados
  // e só então o update falhava por chave estrangeira, deixando a venda sem itens).
  it("cliente inexistente → 404 validado ANTES de qualquer escrita; venda e itens intactos", async () => {
    const antes = await retratoVenda(venda.id);
    const res = await api(token).put(`/api/vendas/${venda.id}`).send({
      clienteId: 999999,
      quantidade: 15,
      sabores: novaVenda().sabores,
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Cliente não encontrado" });
    expect(await retratoVenda(venda.id)).toEqual(antes);
  });

  it("inexistente → 404", async () => {
    const res = await api(token).put("/api/vendas/999999").send({ clienteId: cliente.id, quantidade: 1 });
    expect(res.status).toBe(404);
  });
});

// Etapa 0.6: edição de venda com semântica de campo omitido e atômica.
//   sabores AUSENTE  → itens preservados (e a quantidade também);
//   sabores PRESENTE → validados e substituídos numa transação; quantidade = Σ itens;
//   sabores []       → 400 (venda sem item não tem sentido operacional).
// Toda falha deixa venda e itens EXATAMENTE como estavam (lidos direto via Prisma).
// Obs.: o middleware validateVenda continua exigindo clienteId e quantidade
// (KNOWN_BEHAVIOR K22, mantido); a quantidade enviada não é mais persistida.
describe("PUT /api/vendas/:id — edição parcial e atômica", () => {
  let venda, base;
  beforeEach(async () => {
    venda = (await api(token).post("/api/vendas").send(novaVenda({ desconto: 2.5 }))).body;
    base = { clienteId: cliente.id, quantidade: 1 }; // quantidade exigida pelo middleware e ignorada
  });
  const editar = (corpo) => api(token).put(`/api/vendas/${venda.id}`).send(corpo);

  it("só desconto: muda o desconto e preserva itens, quantidade, valor e data", async () => {
    const antes = await retratoVenda(venda.id);
    const res = await editar({ ...base, desconto: 3 });
    expect(res.status).toBe(200);
    const depois = await retratoVenda(venda.id);
    expect(n(depois.venda.desconto)).toBe(3);
    expect({ ...depois.venda, desconto: null }).toEqual({ ...antes.venda, desconto: null });
    expect(depois.itens).toEqual(antes.itens);
  });

  it("só valor: muda o valor e preserva o resto", async () => {
    const antes = await retratoVenda(venda.id);
    await editar({ ...base, valor: 70 });
    const depois = await retratoVenda(venda.id);
    expect(n(depois.venda.valor)).toBe(70);
    expect({ ...depois.venda, valor: null }).toEqual({ ...antes.venda, valor: null });
    expect(depois.itens).toEqual(antes.itens);
  });

  it("só data: muda a data e preserva o resto", async () => {
    const antes = await retratoVenda(venda.id);
    const res = await editar({ ...base, data: "2026-03-12T08:00:00" });
    expect(res.body.data).toBe("2026-03-12T08:00:00.000-04:00");
    const depois = await retratoVenda(venda.id);
    expect({ ...depois.venda, data: null }).toEqual({ ...antes.venda, data: null });
    expect(depois.itens).toEqual(antes.itens);
  });

  it("alterar cliente preserva os itens", async () => {
    const outro = await criarCliente("Quitanda Fictícia Boreal");
    const antes = await retratoVenda(venda.id);
    await editar({ clienteId: outro.id, quantidade: 1 });
    const depois = await retratoVenda(venda.id);
    expect(depois.venda.clienteId).toBe(outro.id);
    expect(depois.itens).toEqual(antes.itens);
  });

  it("alterar sabores substitui os itens e recalcula a quantidade pela soma (payload 999 → 10)", async () => {
    const res = await editar({ ...base, quantidade: 999, sabores: [{ saborId: limao.id, quantidade: 4 }, { saborId: coco.id, quantidade: 6 }] });
    expect(res.status).toBe(200);
    expect(res.body.quantidade).toBe(10);
    expect((await itensDe(venda.id)).map((i) => [i.saborId, i.quantidade])).toEqual([[coco.id, 6], [limao.id, 4]]);
  });

  it("sabores: [] → 400 e nada muda", async () => {
    const antes = await retratoVenda(venda.id);
    const res = await editar({ ...base, sabores: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Informe ao menos um sabor" });
    expect(await retratoVenda(venda.id)).toEqual(antes);
  });

  it("falha no meio da operação (sabor inexistente: FK depois de apagar os itens) → rollback total", async () => {
    const antes = await retratoVenda(venda.id);
    const res = await editar({ ...base, desconto: 9, sabores: [{ saborId: coco.id, quantidade: 1 }, { saborId: 999999, quantidade: 2 }] });
    expect(res.status).toBe(500); // sabor inexistente continua 500 (K14, mantido)
    expect(res.body).toEqual({ error: "Erro ao atualizar venda" });
    expect(await retratoVenda(venda.id)).toEqual(antes); // venda E itens originais
  });

  it("itens que somam zero → 400 (regra 'quantidade > 0' aplicada à soma) e nada muda", async () => {
    const antes = await retratoVenda(venda.id);
    const res = await editar({ ...base, sabores: [{ saborId: coco.id, quantidade: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Quantidade deve ser maior que zero" });
    expect(await retratoVenda(venda.id)).toEqual(antes);
  });
});

// Etapa 0.6: Venda.quantidade = Σ VendaSabor.quantidade (fonte de verdade).
describe("POST /api/vendas — quantidade derivada dos itens", () => {
  it("vários sabores: payload 999, itens 2 + 3 → 5 gravado", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ quantidade: 999, sabores: [{ saborId: coco.id, quantidade: 2 }, { saborId: limao.id, quantidade: 3 }] }));
    expect(res.status).toBe(201);
    expect((await prisma.venda.findUnique({ where: { id: res.body.id } })).quantidade).toBe(5);
  });

  it("item decimal é truncado como antes (parseInt) e a soma usa o valor gravado: 2.7 + 3 → 2 + 3 = 5", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ sabores: [{ saborId: coco.id, quantidade: 2.7 }, { saborId: limao.id, quantidade: 3 }] }));
    expect(res.body.quantidade).toBe(5);
    expect((await itensDe(res.body.id)).map((i) => i.quantidade)).toEqual([2, 3]);
  });

  it("itens que somam zero → 400 'Quantidade deve ser maior que zero' e nada é gravado", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ quantidade: 5, sabores: [{ saborId: coco.id, quantidade: 0 }] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Quantidade deve ser maior que zero" });
    expect(await prisma.venda.count()).toBe(0);
  });

  it("KNOWN_BEHAVIOR: item com quantidade 0 ou negativa é aceito se a soma for positiva (5 − 2 → 3)", async () => {
    const res = await api(token).post("/api/vendas").send(novaVenda({ sabores: [{ saborId: coco.id, quantidade: 5 }, { saborId: limao.id, quantidade: -2 }] }));
    expect(res.status).toBe(201);
    expect(res.body.quantidade).toBe(3);
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
      .send({ pago: "true", dataPagamento: "2026-03-20T10:00:00" });
    expect(res.body).toMatchObject({ pago: true, dataPagamento: "2026-03-20T10:00:00.000-04:00" });
  });

  it("marcar como paga de novo preserva a primeira dataPagamento", async () => {
    await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: true, dataPagamento: "2026-03-20T10:00:00" });
    const res = await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: true });
    expect(res.body.dataPagamento).toBe("2026-03-20T10:00:00.000-04:00");
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

describe("GET /api/vendas — filtros (calendário civil de Manaus)", () => {
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
      "2026-04-15T12:00:00.000-04:00",
      "2026-04-01T00:30:00.000-04:00",
      "2026-03-31T23:30:00.000-04:00",
      "2026-03-05T12:00:00.000-04:00",
    ]);
    expect(res.body[0].cliente).toBeDefined();
    expect(res.body[0].sabores[0].sabor).toBeDefined();
  });

  // Etapa 0.5 (K17): antes o mês era calculado no fuso do PROCESSO; agora é o
  // calendário de Manaus, com o mesmo resultado em TZ=UTC e TZ=America/Manaus.
  it("mes/ano usa o calendário civil de Manaus: 31/03 23:30 é março e 01/04 00:30 é abril", async () => {
    expect(datas(await api(token).get("/api/vendas?mes=3&ano=2026"))).toEqual([
      "2026-03-31T23:30:00.000-04:00",
      "2026-03-05T12:00:00.000-04:00",
    ]);
    expect(datas(await api(token).get("/api/vendas?mes=4&ano=2026"))).toHaveLength(2);
  });

  // Etapa 0.5: era o KNOWN_BEHAVIOR K16 (fim do mês em 23:59:59.000 com lte deixava
  // 999 ms fora de qualquer mês). Corrigido com o intervalo semiaberto
  // [1º dia 00:00, 1º dia do mês seguinte 00:00).
  it("venda às 23:59:59,500 do último dia do mês pertence a esse mês (K16 corrigido)", async () => {
    await criarVenda({ clienteId: cliente.id, itens: [{ saborId: coco.id, quantidade: 1 }], data: new Date("2026-03-31T23:59:59.500Z") });
    const mar = datas(await api(token).get("/api/vendas?mes=3&ano=2026"));
    const abr = datas(await api(token).get("/api/vendas?mes=4&ano=2026"));
    expect(mar).toContain("2026-03-31T23:59:59.500-04:00");
    expect(abr).not.toContain("2026-03-31T23:59:59.500-04:00");
  });

  it("intervalo dataInicio/dataFim inclui o dia final inteiro", async () => {
    const res = await api(token).get("/api/vendas?dataInicio=2026-03-31&dataFim=2026-04-01");
    expect(datas(res)).toEqual(["2026-04-01T00:30:00.000-04:00", "2026-03-31T23:30:00.000-04:00"]);
  });

  it("intervalo tem precedência sobre mes/ano quando ambos são enviados", async () => {
    const res = await api(token).get("/api/vendas?mes=3&ano=2026&dataInicio=2026-04-10&dataFim=2026-04-30");
    expect(datas(res)).toEqual(["2026-04-15T12:00:00.000-04:00"]);
  });

  it("filtra por cliente, por pago=true/false e respeita limit", async () => {
    expect((await api(token).get(`/api/vendas?clienteId=${outro.id}`)).body).toHaveLength(2);
    expect((await api(token).get("/api/vendas?pago=true")).body.every((v) => v.pago)).toBe(true);
    expect((await api(token).get("/api/vendas?pago=true")).body).toHaveLength(2);
    expect((await api(token).get("/api/vendas?pago=false")).body).toHaveLength(2);
    expect((await api(token).get("/api/vendas?pago=talvez")).body).toHaveLength(4); // valor inválido é ignorado
    expect(datas(await api(token).get("/api/vendas?limit=1"))).toEqual(["2026-04-15T12:00:00.000-04:00"]);
  });
});
