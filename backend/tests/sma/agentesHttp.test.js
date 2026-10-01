// Etapa 1 — rotas /api/agentes contra o servidor real (processo separado,
// banco de teste). Ações são propostas no processo de teste (mesmo banco) e
// aprovadas/rejeitadas pela API, como o gestor fará.
import { beforeEach, describe, expect, it } from "vitest";
import * as acoes from "../../src/agents/acoes/servicoAcoes.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { api } from "../caracterizacao/helpers/http.js";
import { autenticar, criarCliente, criarSabor } from "../caracterizacao/helpers/fixtures.js";

let token;
beforeEach(async () => {
  token = await autenticar();
});

const ROTAS = [
  ["get", "/api/agentes"],
  ["post", "/api/agentes/estoque/executar"],
  ["get", "/api/agentes/execucoes"],
  ["get", "/api/agentes/execucoes/1"],
  ["get", "/api/agentes/recomendacoes"],
  ["get", "/api/agentes/acoes"],
  ["post", "/api/agentes/acoes/1/aprovar"],
  ["post", "/api/agentes/acoes/1/rejeitar"],
];

/** Nenhuma resposta pode vazar stack, SQL, Prisma ou segredo. */
const semVazamento = (body) => expect(JSON.stringify(body)).not.toMatch(/\bat \w|stack|prisma|SELECT|mysql:\/\/|JWT_SECRET/i);

describe("segurança", () => {
  it.each(ROTAS)("%s %s sem token → 401", async (metodo, rota) => {
    const res = await api()[metodo](rota).send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Token não fornecido" });
  });

  it("token inválido → 401 e nenhuma execução", async () => {
    const res = await api("token-falso").post("/api/agentes/estoque/executar").send({ tipo: "PING" });
    expect(res.status).toBe(401);
    expect(await prisma.execucaoAgente.count()).toBe(0);
  });
});

describe("agentes e execuções", () => {
  it("GET /api/agentes lista os 5 agentes com as tools permitidas", async () => {
    const res = await api(token).get("/api/agentes");
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.nome)).toEqual(["coordenador", "estoque", "vendas", "inteligencia", "atendimento"]);
    expect(res.body.find((a) => a.nome === "vendas").tools).toContain("consultarRecebiveis");
  });

  it("POST /:nome/executar → 200 e a execução fica auditada (lista e detalhe com as tools chamadas)", async () => {
    const res = await api(token).post("/api/agentes/estoque/executar").send({ tipo: "DIAGNOSTICO" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agente: "estoque", status: "SUCESSO", saida: { toolsOk: true } });

    const lista = await api(token).get("/api/agentes/execucoes?agente=estoque");
    expect(lista.body).toEqual([expect.objectContaining({ id: res.body.execucaoId, gatilho: "HTTP", status: "SUCESSO", tipoExecucao: "DIAGNOSTICO" })]);
    const det = await api(token).get(`/api/agentes/execucoes/${res.body.execucaoId}`);
    expect(det.body.chamadasTool.map((c) => [c.tool, c.ok])).toEqual([["consultarEstoqueAcabado", true], ["consultarSaldoMateriasPrimas", true]]);
  });

  it("coordenador pela API: delegação completa", async () => {
    const res = await api(token).post("/api/agentes/coordenador/executar").send({ tipo: "DIAGNOSTICO_GERAL" });
    expect(res.body.saida).toMatchObject({ completo: true, delegadoPara: ["estoque", "vendas", "inteligencia"] });
    const det = await api(token).get(`/api/agentes/execucoes/${res.body.execucaoId}`);
    expect(det.body.mensagens).toHaveLength(3);
    expect(det.body.filhas.map((f) => f.agente)).toEqual(["estoque", "vendas", "inteligencia"]);
  });

  it("erros controlados: agente inexistente 404, tipo ausente 400, falha do agente 500 com execucaoId e sem detalhes internos", async () => {
    expect((await api(token).post("/api/agentes/fantasma/executar").send({ tipo: "PING" })).status).toBe(404);
    const semTipo = await api(token).post("/api/agentes/estoque/executar").send({});
    expect(semTipo.status).toBe(400);
    const falha = await api(token).post("/api/agentes/estoque/executar").send({ tipo: "PERGUNTA", dados: { pergunta: "oi" } });
    expect(falha.status).toBe(500);
    expect(falha.body).toEqual({ error: 'Falha na execução do agente "estoque"', execucaoId: expect.any(Number) });
    semVazamento(falha.body);
    const det = await api(token).get(`/api/agentes/execucoes/${falha.body.execucaoId}`);
    expect(det.body).toMatchObject({ status: "FALHA", erro: "Nenhum provedor de LLM configurado" });
    expect((await api(token).get("/api/agentes/execucoes/999999")).status).toBe(404);
  });
});

describe("recomendações e ações pela API do gestor", () => {
  it("GET /recomendacoes lista as recomendações registradas", async () => {
    await prisma.recomendacao.create({ data: { agente: "estoque", tipo: "TESTE", titulo: "Repor coco", descricao: "Saldo baixo", prioridade: "ALTA" } });
    const res = await api(token).get("/api/agentes/recomendacoes?status=ABERTA");
    expect(res.body).toEqual([expect.objectContaining({ titulo: "Repor coco", status: "ABERTA" })]);
  });

  it("aprovar executa pelo executor determinístico; repetir → 409; rejeitar outra → REJEITADA e nunca executa", async () => {
    const cliente = await criarCliente("Mercearia Fictícia Aurora");
    const coco = await criarSabor({ nome: "Coco Fictício" });
    const proposta = () => acoes.proporAcao({
      tipo: "REGISTRAR_VENDA", descricao: "Venda relatada", criadaPorAgente: "vendas",
      payload: { clienteId: cliente.id, sabores: [{ saborId: coco.id, quantidade: 6 }], valor: 33 },
    });
    const a = await proposta();
    const b = await proposta();

    const pendentes = await api(token).get("/api/agentes/acoes?status=PENDENTE");
    expect(pendentes.body.map((x) => x.id).sort((x, y) => x - y)).toEqual([a.id, b.id]);

    const aprovada = await api(token).post(`/api/agentes/acoes/${a.id}/aprovar`);
    expect(aprovada.status).toBe(200);
    expect(aprovada.body).toMatchObject({ id: a.id, status: "EXECUTADA", resultado: { quantidade: 6, valor: 33 } });
    expect((await api(token).post(`/api/agentes/acoes/${a.id}/aprovar`)).status).toBe(409);

    const rejeitada = await api(token).post(`/api/agentes/acoes/${b.id}/rejeitar`).send({ motivo: "duplicada" });
    expect(rejeitada.body).toMatchObject({ status: "REJEITADA", motivoRejeicao: "duplicada" });
    expect((await api(token).post(`/api/agentes/acoes/${b.id}/aprovar`)).status).toBe(409);
    expect(await prisma.venda.count()).toBe(1);
    expect((await api(token).post("/api/agentes/acoes/abc/aprovar")).status).toBe(404);
  });
});
