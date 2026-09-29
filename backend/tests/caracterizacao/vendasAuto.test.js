// Caracterização: POST /api/vendas/auto (vendasController.criarVendaAuto,
// middlewares apiKeyAuth e auth). Sem reativar o n8n: só o contrato HTTP atual.
import { beforeEach, describe, expect, it } from "vitest";
import { n, prisma } from "./helpers/db.js";
import { api } from "./helpers/http.js";
import { API_KEY_TESTE } from "./setup/ambiente.js";
import { autenticar, criarCliente, criarSabor } from "./helpers/fixtures.js";

let token, cliente, coco, limao;
beforeEach(async () => {
  token = await autenticar();
  cliente = await criarCliente("Mercearia Fictícia Aurora");
  coco = await criarSabor({ nome: "Coco Fictício" });
  limao = await criarSabor({ nome: "Limão Fictício" });
});

const payload = (extra = {}) => ({
  clienteNome: "mercearia ficticia aurora",
  sabores: [
    { nome: "coco", quantidade: 20 },
    { nome: "LIMAO", quantidade: 10 },
  ],
  valor: 165,
  ...extra,
});
const auto = (body, { jwt = token, chave = API_KEY_TESTE } = {}) =>
  api(jwt, chave).post("/api/vendas/auto").send(body);

describe("autenticação do /vendas/auto", () => {
  it("KNOWN_BEHAVIOR: API Key sozinha NÃO basta — o JWT também é exigido (verificarAuth em /api/vendas)", async () => {
    const res = await auto(payload(), { jwt: null });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Token não fornecido" });
    expect(await prisma.venda.count()).toBe(0);
  });

  it("JWT sem API Key → 401", async () => {
    const res = await auto(payload(), { chave: null });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "API Key inválida ou ausente" });
  });

  it("JWT com API Key errada → 401", async () => {
    const res = await auto(payload(), { chave: "chave-errada" });
    expect(res.status).toBe(401);
  });

  it("JWT + API Key → 201", async () => {
    expect((await auto(payload())).status).toBe(201);
  });
});

describe("registro automático", () => {
  it("resolve cliente e sabores por texto; quantidade = soma dos itens; nasce pendente", async () => {
    const res = await auto(payload({ desconto: 5 }));
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Venda registrada com sucesso");
    expect(res.body.resolucao).toEqual({ clienteEncontrado: "Mercearia Fictícia Aurora", saboresResolvidos: 2 });
    expect(res.body.venda).toMatchObject({ clienteId: cliente.id, quantidade: 30, pago: false, dataPagamento: null });
    expect(n(res.body.venda.valor)).toBe(165);
    expect(n(res.body.venda.desconto)).toBe(5);
    const itens = await prisma.vendaSabor.findMany({ orderBy: { saborId: "asc" } });
    expect(itens.map((i) => [i.saborId, i.quantidade])).toEqual([[coco.id, 20], [limao.id, 10]]);
  });

  it("KNOWN_BEHAVIOR: o valor vem do chamador (não é calculado pelo preço dos sabores)", async () => {
    const res = await auto(payload({ valor: 1 }));
    expect(n(res.body.venda.valor)).toBe(1);
  });

  it("aceita data e pago=true informados", async () => {
    const res = await auto(payload({ data: "2026-03-10T12:00:00.000Z", pago: true }));
    expect(res.body.venda.data).toBe("2026-03-10T12:00:00.000Z");
    expect(res.body.venda.pago).toBe(true);
    expect(res.body.venda.dataPagamento).not.toBeNull();
  });
});

describe("idempotência", () => {
  it("mesma idempotencyKey → segunda chamada devolve 200 duplicata:true e não cria outra venda", async () => {
    const primeira = await auto(payload({ idempotencyKey: "msg-ficticia-001" }));
    const segunda = await auto(payload({ idempotencyKey: "msg-ficticia-001", valor: 999 }));
    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(200);
    expect(segunda.body).toMatchObject({
      message: "Venda já registrada anteriormente (idempotente)",
      duplicata: true,
      venda: { id: primeira.body.venda.id },
    });
    expect(await prisma.venda.count()).toBe(1);
  });

  it("chaves diferentes → vendas diferentes; sem chave → toda chamada cria", async () => {
    await auto(payload({ idempotencyKey: "a" }));
    await auto(payload({ idempotencyKey: "b" }));
    await auto(payload());
    await auto(payload());
    expect(await prisma.venda.count()).toBe(4);
  });
});

describe("validações e entidades não encontradas", () => {
  it.each([
    [{ clienteNome: "  " }, "clienteNome é obrigatório"],
    [{ sabores: [] }, "Informe ao menos um sabor"],
    [{ valor: 0 }, "Valor inválido"],
  ])("%o → 400", async (extra, erro) => {
    const res = await auto(payload(extra));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: erro });
  });

  it("cliente não encontrado → 404 com sugestão fixa (sem candidatos)", async () => {
    const res = await auto(payload({ clienteNome: "Padaria Inexistente" }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'Cliente não encontrado: "Padaria Inexistente"',
      sugestao: "Verifique o nome ou cadastre o cliente primeiro",
    });
  });

  it("sabor não encontrado → 404 com a lista dos não encontrados; nada é gravado", async () => {
    const res = await auto(payload({ sabores: [{ nome: "coco", quantidade: 1 }, { nome: "pistache", quantidade: 2 }] }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Sabores não encontrados", naoEncontrados: ["pistache"], encontrados: 1 });
    expect(await prisma.venda.count()).toBe(0);
  });

  it("KNOWN_BEHAVIOR: clienteNome que normaliza para vazio ('!!!') registra venda para o PRIMEIRO cliente", async () => {
    await criarCliente("Outro Cliente Fictício");
    const res = await auto(payload({ clienteNome: "!!!" }));
    expect(res.status).toBe(201);
    expect(res.body.venda.clienteId).toBe(cliente.id);
  });
});
