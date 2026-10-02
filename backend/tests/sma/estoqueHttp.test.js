// Etapa 2 — Agente de Estoque pela API (servidor real, banco de teste) e
// decisões do gestor sobre recomendações.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../caracterizacao/helpers/db.js";
import { api } from "../caracterizacao/helpers/http.js";
import { autenticar, criarCliente, criarProducao, criarSabor, criarVenda } from "../caracterizacao/helpers/fixtures.js";

let token;
beforeEach(async () => {
  token = await autenticar();
  const cliente = await criarCliente("Mercearia Fictícia Aurora");
  const tradicional = await criarSabor({ nome: "Tradicional" });
  await criarProducao({ itens: [{ saborId: tradicional.id, quantidade: 80 }], data: new Date("2026-09-25T12:00:00Z") });
  await criarVenda({ clienteId: cliente.id, itens: [{ saborId: tradicional.id, quantidade: 100 }], data: new Date("2026-09-26T12:00:00Z") });
});

const analisar = () => api(token).post("/api/agentes/estoque/executar").send({ tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia: "2026-09-30" } });

describe("POST /api/agentes/estoque/executar (ANALISAR_ESTOQUE)", () => {
  it("executa a análise real: resumo, qualidade e recomendações; detalhe da execução reconstruível", async () => {
    const res = await analisar();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agente: "estoque", status: "SUCESSO", saida: { tipo: "ANALISE_ESTOQUE", resumo: { recomendacoes: 2, modoDegradado: true } } });
    expect(res.body.saida.qualidade.estoqueAcabado.confiabilidade).toBe("NAO_RECONCILIADO");

    const det = await api(token).get(`/api/agentes/execucoes/${res.body.execucaoId}`);
    expect(det.body.chamadasTool).toHaveLength(4); // Etapa 4: ritmo numa janela canônica só (antes 5: janelas de 7 e 30 dias)
    expect(det.body.recomendacoes.map((r) => r.tipo)).toEqual(["CONTAGEM_FISICA", "CADASTRAR_RECEITAS"]);
    expect(det.body.saida.resumo.alertas).toBe(res.body.saida.resumo.alertas);
  });

  it("recomendações: listar por agente, ignorar, resolver; transição inválida 409; inexistente 404", async () => {
    await analisar();
    const lista = await api(token).get("/api/agentes/recomendacoes?agente=estoque&status=ABERTA");
    expect(lista.body.map((r) => r.tipo).sort()).toEqual(["CADASTRAR_RECEITAS", "CONTAGEM_FISICA"]);
    const [a, b] = lista.body;

    const ign = await api(token).post(`/api/agentes/recomendacoes/${a.id}/ignorar`);
    expect(ign.body).toMatchObject({ id: a.id, status: "IGNORADA" });
    expect(ign.body.resolvidaEm).not.toBeNull();
    expect((await api(token).post(`/api/agentes/recomendacoes/${a.id}/resolver`)).status).toBe(409);
    expect((await api(token).post(`/api/agentes/recomendacoes/${b.id}/resolver`)).body.status).toBe("RESOLVIDA");
    expect((await api(token).post("/api/agentes/recomendacoes/999999/resolver")).status).toBe(404);

    await analisar(); // IGNORADA não volta; RESOLVIDA volta como nova ABERTA (o problema continua)
    expect(await prisma.recomendacao.count({ where: { status: "ABERTA" } })).toBe(1);
  });

  it.each([
    ["post", "/api/agentes/recomendacoes/1/resolver"],
    ["post", "/api/agentes/recomendacoes/1/ignorar"],
  ])("%s %s sem token → 401", async (metodo, rota) => {
    expect((await api()[metodo](rota)).status).toBe(401);
  });
});
