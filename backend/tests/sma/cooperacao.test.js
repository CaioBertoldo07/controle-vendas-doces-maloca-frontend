// Etapa 3 — primeira cooperação real entre especialistas:
//   Estoque ──DEMANDA_MEDIA──▶ Inteligência ──tools──▶ resposta ──▶ Estoque continua
// Tudo pelo runtime SMA (MensagemAgente + execução filha), provado pela auditoria.
import { z } from "zod";
import { describe, expect, it } from "vitest";
import * as consultas from "../../src/agents/consultas.js";
import { CATALOGO, criarRegistro, criarRuntime } from "../../src/agents/index.js";
import { DEMANDA_MEDIA } from "../../src/agents/contratos/demandaMedia.js";
import { definirTool } from "../../src/agents/tools/definirTool.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { api } from "../caracterizacao/helpers/http.js";
import { autenticar } from "../caracterizacao/helpers/fixtures.js";
import { REF, cenarioMultiagente, contagemDominio } from "./cenarioInteligencia.js";
import { agenteTeste, runtimeTeste } from "./helpers.js";
import { AGENTES_PADRAO } from "../../src/agents/index.js";

const analisar = (rt = runtimeTeste()) => rt.executarAgente("estoque", { tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia: REF } }, { gatilho: "HTTP" });

describe("cenário acadêmico multiagente (Tradicional em alta, Maracujá em queda)", () => {
  it("Estoque pede DEMANDA_MEDIA, recebe as médias, compara com a produção das mesmas semanas e contextualiza a divergência", async () => {
    const { tradicional, maracuja } = await cenarioMultiagente();
    const antes = await contagemDominio();
    const { saida, status } = await analisar();
    expect(status).toBe("SUCESSO");

    expect(saida.demanda).toMatchObject({
      fonte: "AGENTE_INTELIGENCIA", solicitada: true, disponivel: true,
      metodologia: { tipo: "MEDIA_HISTORICA_RECENTE", janelaSemanas: 4, periodo: { dataInicio: "2026-08-30", dataFim: "2026-09-26" } },
    });
    // Etapa 4: a comparação produção × demanda passou para o ritmo canônico (mesma janela, uma visão só)
    expect(saida.ritmo.sabores.map((s) => [s.sabor, s.demandaMediaSemanal, s.producaoMediaSemanal, s.razaoProducaoVendas, s.situacao])).toEqual([
      ["Maracujá", 20, 20, 1, "ALINHADA"],
      ["Tradicional", 30, 20, 0.667, "PRODUCAO_ABAIXO_DA_DEMANDA"],
    ]);
    expect(saida.ritmo.sabores[1].texto).toBe(
      "A demanda média recente de Tradicional é 30 un./semana (4 semanas completas, 30/08 a 26/09). A produção no mesmo período foi de 20 un./semana, abaixo desse ritmo.",
    );
    expect(saida.demanda.divergencias).toEqual([{
      saborId: tradicional.id, sabor: "Tradicional", saldo: -20, mediaSemanal: 30, semanasDeDemanda: 0.67,
      texto: "A divergência histórica de Tradicional (-20 un.) equivale a 0,7 semana(s) da demanda média recente.",
    }]);
    expect(saida.qualidade.demandaMediaRecente).toEqual({ confiabilidade: "UTILIZAVEL", saboresComMedia: 2, sabores: 2 });
    expect(saida.alertas.find((a) => a.entidade.id === tradicional.id && a.tipo === "SALDO_NEGATIVO")).toBeDefined();
    expect(saida.alertas.filter((a) => a.entidade.id === maracuja.id).map((a) => a.tipo)).toEqual(["RECEITA_AUSENTE"]);

    // enriquece, mas não decide: nenhuma quantidade a produzir, nenhuma ação, nada de domínio escrito
    expect(JSON.stringify(saida)).not.toMatch(/produza|produzir \d|quantidadeSugerida|sugestaoProducao/i);
    expect(await contagemDominio()).toEqual(antes);
    expect(await prisma.acaoProposta.count()).toBe(0);
  });

  it("auditoria prova a cadeia: execução pai → mensagem → execução filha → tools → resposta → uso pelo Estoque", async () => {
    await cenarioMultiagente();
    const { execucaoId } = await analisar();
    const pai = await consultas.buscarExecucao(execucaoId);
    expect(pai).toMatchObject({ agente: "estoque", tipoExecucao: "ANALISAR_ESTOQUE", gatilho: "HTTP", status: "SUCESSO", execucaoPaiId: null });

    // Etapa 4: o pai também consulta Vendas (Tradicional); aqui a cadeia da Inteligência
    const msg = pai.mensagens.find((m) => m.tipo === "DEMANDA_MEDIA");
    expect(pai.mensagens.map((m) => m.tipo)).toEqual(["DEMANDA_MEDIA", "EXPOSICAO_CLIENTES_POR_SABOR"]);
    expect(msg).toMatchObject({ agenteOrigem: "estoque", agenteDestino: "inteligencia", tipo: "DEMANDA_MEDIA", status: "RESPONDIDA" });
    expect(msg.conteudo).toEqual({ dataReferencia: REF, janelaSemanas: 4, saborIds: expect.any(Array) });
    expect(DEMANDA_MEDIA.resposta.safeParse(msg.resposta).success).toBe(true);

    expect(pai.filhas[0]).toEqual(expect.objectContaining({ id: msg.execucaoDestinoId, agente: "inteligencia", tipoExecucao: "DEMANDA_MEDIA", status: "SUCESSO" }));
    const filha = await consultas.buscarExecucao(msg.execucaoDestinoId);
    expect(filha).toMatchObject({ gatilho: "MENSAGEM", execucaoPaiId: execucaoId, metadados: { profundidade: 1 } });
    expect(filha.duracaoMs).toBeGreaterThanOrEqual(0);
    expect(filha.recebidas.map((m) => m.id)).toEqual([msg.id]);
    expect(filha.chamadasTool.map((c) => [c.tool, c.ok, c.entrada])).toEqual([
      ["consultarVendasDiariasPorSabor", true, { dataInicio: "2026-08-30", dataFim: "2026-09-26" }],
    ]);

    // o Estoque usou a resposta: consultou a produção exatamente na janela devolvida pela Inteligência
    const usoPeloEstoque = pai.chamadasTool.filter((c) => c.tool === "consultarProducaoVendasPeriodo").map((c) => c.entrada);
    expect(usoPeloEstoque).toContainEqual(msg.resposta.metodologia.periodo);
    expect(pai.saida.demanda.metodologia.periodo).toEqual(msg.resposta.metodologia.periodo);
  });
});

describe("falha da Inteligência: o Estoque não cai, entra em modo degradado", () => {
  const conferirDegradado = async ({ saida, status, execucaoId }, motivo) => {
    expect(status).toBe("SUCESSO");
    expect(saida.demanda).toMatchObject({ solicitada: true, disponivel: false, motivo });
    expect(saida.qualidade.demandaMediaRecente).toEqual({ confiabilidade: "INDISPONIVEL", motivo });
    expect(saida.resumo.modoDegradado).toBe(true);
    expect(saida.falhasDeConsulta).toContainEqual({ agente: "inteligencia", mensagem: "DEMANDA_MEDIA", codigo: motivo });
    // as análises locais continuam
    expect(saida.alertas.map((a) => a.tipo)).toContain("SALDO_NEGATIVO");
    expect(saida.recomendacoes.map((r) => r.tipo)).toEqual(["CONTAGEM_FISICA", "CADASTRAR_RECEITAS"]);
    return consultas.buscarExecucao(execucaoId);
  };

  it("agente lança erro → mensagem e execução filha ficam FALHA e ligadas ao pai", async () => {
    await cenarioMultiagente();
    const r = await analisar(runtimeTeste({ substituir: [agenteTeste("inteligencia", async () => { throw new Error("indisponível"); })] }));
    const pai = await conferirDegradado(r, "FALHA_AGENTE_INTELIGENCIA");
    // Etapa 4: a falha da Inteligência não impede a consulta ao Vendas (a divergência é base local suficiente)
    expect(pai.mensagens.map((m) => [m.tipo, m.status])).toEqual([["DEMANDA_MEDIA", "FALHA"], ["EXPOSICAO_CLIENTES_POR_SABOR", "RESPONDIDA"]]);
    expect(pai.filhas.map((f) => [f.agente, f.status])).toEqual([["inteligencia", "FALHA"], ["vendas", "SUCESSO"]]);
    expect(r.saida.clientes).toMatchObject({ solicitada: true, disponivel: true });
    expect(r.saida.ritmo.fonteDemanda).toBe("FLUXO_LOCAL");
    expect(r.saida.demanda.execucaoInteligenciaId).toBe(pai.filhas[0].id);
  });

  it("tool de vendas da Inteligência falhando → FALHA na filha, degradado no Estoque", async () => {
    await cenarioMultiagente();
    const quebrada = definirTool({ nome: "consultarVendasDiariasPorSabor", descricao: "falha simulada", entrada: z.object({}).passthrough(), executar: async () => { throw new Error("banco fora"); } });
    const r = await analisar(runtimeTeste({ catalogo: new Map([...CATALOGO, ["consultarVendasDiariasPorSabor", quebrada]]) }));
    const pai = await conferirDegradado(r, "FALHA_AGENTE_INTELIGENCIA");
    const filha = await consultas.buscarExecucao(pai.filhas[0].id);
    expect(filha).toMatchObject({ status: "FALHA", erro: "Dados de vendas indisponíveis para a demanda média (ERRO_INTERNO)" });
    expect(filha.chamadasTool).toEqual([expect.objectContaining({ tool: "consultarVendasDiariasPorSabor", ok: false, erro: "banco fora" })]);
  });

  it("resposta fora do contrato → descartada (RESPOSTA_INVALIDA), nada usado", async () => {
    await cenarioMultiagente();
    const r = await analisar(runtimeTeste({ substituir: [agenteTeste("inteligencia", async () => ({ sabores: [{ saborId: 1, mediaSemanal: 999 }] }))] }));
    await conferirDegradado(r, "RESPOSTA_INVALIDA");
    expect(await prisma.chamadaTool.count({ where: { execucaoId: r.execucaoId, tool: "consultarProducaoVendasPeriodo" } })).toBe(1); // Etapa 4: só a janela canônica
  });

  it("limite de profundidade: sem margem para delegar, nenhuma mensagem é criada e o Estoque conclui", async () => {
    await cenarioMultiagente();
    const registro = criarRegistro();
    for (const a of AGENTES_PADRAO) registro.registrar(a);
    const r = await analisar(criarRuntime({ registro, catalogo: CATALOGO, profundidadeMaxima: 0 }));
    await conferirDegradado(r, "FALHA_AGENTE_INTELIGENCIA");
    expect(await prisma.mensagemAgente.count()).toBe(0);
  });

  it("loop (Inteligência maliciosa que devolve a pergunta ao Estoque) é contido pela profundidade máxima", async () => {
    await cenarioMultiagente();
    const eco = agenteTeste("inteligencia", (ctx) => ctx.enviarMensagem({ para: "estoque", tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia: REF } }), []);
    const r = await analisar(runtimeTeste({ substituir: [eco] }));
    expect(r.status).toBe("SUCESSO");
    const execs = await prisma.execucaoAgente.findMany({ orderBy: { id: "asc" }, select: { agente: true, status: true, metadados: true } });
    // Etapa 4: cada Estoque da cadeia também consulta Vendas (o de profundidade 4 não pode mais delegar)
    expect(execs.map((e) => [e.agente, e.metadados.profundidade])).toEqual([
      ["estoque", 0], ["inteligencia", 1], ["estoque", 2], ["inteligencia", 3], ["estoque", 4], ["vendas", 3], ["vendas", 1],
    ]);
    expect(execs.every((e) => e.status === "SUCESSO")).toBe(true);
  });
});

describe("pela API (autenticada)", () => {
  it("POST /estoque/executar → detalhe com mensagem e filha; POST /inteligencia/executar com DEMANDA_MEDIA e ANALISAR_INTELIGENCIA", async () => {
    await cenarioMultiagente();
    const token = await autenticar();
    const res = await api(token).post("/api/agentes/estoque/executar").send({ tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia: REF } });
    expect(res.status).toBe(200);
    const det = await api(token).get(`/api/agentes/execucoes/${res.body.execucaoId}`);
    expect(det.body.mensagens.map((m) => [m.agenteDestino, m.tipo, m.status])).toEqual([["inteligencia", "DEMANDA_MEDIA", "RESPONDIDA"], ["vendas", "EXPOSICAO_CLIENTES_POR_SABOR", "RESPONDIDA"]]);
    expect(det.body.filhas.map((f) => [f.agente, f.status])).toEqual([["inteligencia", "SUCESSO"], ["vendas", "SUCESSO"]]);
    const filha = await api(token).get(`/api/agentes/execucoes/${det.body.filhas[0].id}`);
    expect(filha.body.chamadasTool.map((c) => c.tool)).toEqual(["consultarVendasDiariasPorSabor"]);

    const dm = await api(token).post("/api/agentes/inteligencia/executar").send({ tipo: "DEMANDA_MEDIA", dados: { dataReferencia: REF } });
    expect(dm.body).toMatchObject({ agente: "inteligencia", status: "SUCESSO", saida: { metodologia: { tipo: "MEDIA_HISTORICA_RECENTE" } } });
    const ai = await api(token).post("/api/agentes/inteligencia/executar").send({ tipo: "ANALISAR_INTELIGENCIA", dados: { dataReferencia: REF } });
    expect(ai.body.saida.tendencias.sabores).toMatchObject({ ALTA: ["Tradicional"], QUEDA: ["Maracujá"] });
    expect((await api().post("/api/agentes/inteligencia/executar").send({ tipo: "PING" })).status).toBe(401);
  });
});
