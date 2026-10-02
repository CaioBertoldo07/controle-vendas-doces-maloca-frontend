// Etapa 6 — pela API (servidor real, banco de teste): rotinas internas com
// segredo próprio, sinais de evento disparados por uma venda real, health
// check sem segredos e 409 amigável para turnos simultâneos na conversa.
import { describe, expect, it } from "vitest";
import { prisma } from "../caracterizacao/helpers/db.js";
import { api, cru } from "../caracterizacao/helpers/http.js";
import { criarCliente, criarSabor, criarUsuario, tokenPara } from "../caracterizacao/helpers/fixtures.js";
import { JWT_SECRET_TESTE, ROTINAS_TOKEN_TESTE } from "../caracterizacao/setup/ambiente.js";
import { REF, cenarioVendas } from "./cenarioVendas.js";

const rotina = (nome, token, corpo = { dataReferencia: REF }) => {
  let r = cru().post(`/api/interno/agentes/rotinas/${nome}`);
  if (token !== undefined) r = r.set("x-rotinas-token", token);
  return r.send(corpo);
};

describe("POST /api/interno/agentes/rotinas/:nome", () => {
  it("sem segredo, segredo errado ou só o JWT do gestor → 401; nada é executado", async () => {
    const jwt = tokenPara((await criarUsuario()).usuario);
    expect((await rotina("estoque")).status).toBe(401);
    expect((await rotina("estoque", "errado")).status).toBe(401);
    expect((await cru().post("/api/interno/agentes/rotinas/estoque").set("Authorization", `Bearer ${jwt}`).send({})).status).toBe(401);
    expect(await prisma.execucaoAgente.count()).toBe(0);
    expect(await prisma.execucaoRotina.count()).toBe(0);
  });

  it("segredo certo: executa uma vez por dia (o segundo disparo responde JA_EXECUTADA); fora da allowlist → 404; data inválida → 400", async () => {
    await cenarioVendas();
    const r1 = await rotina("estoque", ROTINAS_TOKEN_TESTE);
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ executada: true, rotina: "estoque", status: "SUCESSO", janela: expect.stringMatching(/^dia:\d{4}-\d{2}-\d{2}$/) });
    const r2 = await rotina("estoque", ROTINAS_TOKEN_TESTE);
    expect(r2.body).toMatchObject({ executada: false, motivo: "JA_EXECUTADA_NA_JANELA" });
    expect(await prisma.execucaoAgente.count({ where: { agente: "estoque", gatilho: "AGENDADO" } })).toBe(1);
    expect((await rotina("registrarVenda", ROTINAS_TOKEN_TESTE)).status).toBe(404);
    expect((await rotina("vendas", ROTINAS_TOKEN_TESTE, { dataReferencia: "ontem" })).status).toBe(400);
    expect(JSON.stringify(r1.body)).not.toContain(ROTINAS_TOKEN_TESTE);
  });

  it("venda registrada pela API → sinais de análise; a rotina \"eventos\" respeita o debounce e depois analisa uma vez", async () => {
    const token = tokenPara((await criarUsuario()).usuario);
    const cliente = await criarCliente();
    const sabor = await criarSabor();
    const venda = await api(token).post("/api/vendas").send({ clienteId: cliente.id, quantidade: 2, valor: 11, data: "2026-09-29T10:00:00", sabores: [{ saborId: sabor.id, quantidade: 2 }] });
    expect(venda.status).toBe(201);
    expect((await prisma.sinalAnalise.findMany({ orderBy: { rotina: "asc" } })).map((s) => [s.rotina, s.pendente, s.ultimoEvento])).toEqual([["estoque", true, "VENDA_REGISTRADA"], ["vendas", true, "VENDA_REGISTRADA"]]);

    const cedo = await rotina("eventos", ROTINAS_TOKEN_TESTE);
    expect(cedo.body).toEqual({ processados: 0, resultados: [], aguardandoDebounce: ["estoque", "vendas"] });
    await prisma.sinalAnalise.updateMany({ data: { ultimoEventoEm: new Date(Date.now() - 10 * 60 * 1000) } }); // a rajada "terminou"
    const depois = await rotina("eventos", ROTINAS_TOKEN_TESTE);
    expect(depois.body.processados).toBe(2);
    expect(depois.body.resultados.map((r) => [r.rotina, r.status])).toEqual([["estoque", "SUCESSO"], ["vendas", "SUCESSO"]]);
    expect(await prisma.execucaoAgente.count({ where: { gatilho: "EVENTO" } })).toBe(2);
    expect(await prisma.acaoProposta.count()).toBe(0); // rotinas nunca propõem nem executam ações
    expect(await prisma.venda.count()).toBe(1);
  });
});

describe("GET /api/health", () => {
  it("público; backend e banco OK; assistente indisponível sem provedor (não é falha); nenhum segredo no corpo", async () => {
    const res = await api().get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "OK", backend: "OK", banco: "OK",
      sma: { habilitado: true, acoesEmExecucao: 0 },
      assistente: { habilitado: true, estado: "INDISPONIVEL", provedor: "NAO_CONFIGURADO" },
      rotinas: { habilitadas: true, eventosHabilitados: true },
    });
    const corpo = JSON.stringify(res.body);
    for (const segredo of [ROTINAS_TOKEN_TESTE, JWT_SECRET_TESTE, "mysql://", "DATABASE_URL", "ANTHROPIC"]) expect(corpo).not.toContain(segredo);
  });
});

describe("conversa simultânea pela API", () => {
  it("turno com a conversa ocupada → 409 com mensagem amigável", async () => {
    const { usuario } = await criarUsuario();
    const c = await prisma.conversaAgente.create({ data: { usuarioId: usuario.id, processandoAte: new Date(Date.now() + 60000), tokenProcessamento: "outro-turno" } });
    const res = await api(tokenPara(usuario)).post("/api/agentes/chat").send({ conversaId: c.id, mensagem: "oi" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Ainda estou respondendo à mensagem anterior desta conversa. Aguarde a resposta e envie de novo." });
    expect(await prisma.mensagemConversa.count()).toBe(0);
  });
});
