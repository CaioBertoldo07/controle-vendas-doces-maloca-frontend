// Etapa 4 — cooperação entre três especialistas, consolidada pelo Estoque:
//   Estoque ──DEMANDA_MEDIA──────────────▶ Inteligência
//   Estoque ──EXPOSICAO_CLIENTES_POR_SABOR▶ Vendas
// Tudo pelo runtime SMA (MensagemAgente + execuções filhas), provado pela auditoria.
import { describe, expect, it } from "vitest";
import * as consultas from "../../src/agents/consultas.js";
import { EXPOSICAO_CLIENTES } from "../../src/agents/contratos/exposicaoClientes.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { api } from "../caracterizacao/helpers/http.js";
import { autenticar, criarCliente, criarProducao, criarSabor, criarVenda } from "../caracterizacao/helpers/fixtures.js";
import { REF, cenarioVendas } from "./cenarioVendas.js";
import { agenteTeste, runtimeTeste } from "./helpers.js";

const analisar = (rt = runtimeTeste()) => rt.executarAgente("estoque", { tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia: REF } }, { gatilho: "HTTP" });
const falhando = (nome) => agenteTeste(nome, async () => { throw new Error("indisponível"); });
const alertas = (saida) => saida.alertas.map((a) => [a.tipo, a.prioridade, a.entidade.nome ?? null]);

describe("cenário acadêmico: Estoque consolida Inteligência (demanda) e Vendas (clientes)", () => {
  it("Tradicional: produção abaixo da demanda, divergência e exposição alta a clientes recorrentes; Maracujá não é consultado", async () => {
    const { tradicional, maracuja } = await cenarioVendas();
    const antes = await Promise.all([prisma.venda.count(), prisma.producao.count(), prisma.acaoProposta.count()]);
    const { saida, status } = await analisar();
    expect(status).toBe("SUCESSO");

    // Inteligência → ritmo canônico (mesma janela)
    expect(saida.ritmo).toMatchObject({ fonteDemanda: "AGENTE_INTELIGENCIA", janela: { dataInicio: "2026-08-30", dataFim: "2026-09-26" } });
    expect(saida.ritmo.sabores.map((s) => [s.sabor, s.produzido, s.vendido, s.demandaMediaSemanal, s.situacao, s.motivo])).toEqual([
      ["Maracujá", 45, 45, null, "SEM_CONCLUSAO", "DADOS_INSUFICIENTES"],
      ["Tradicional", 40, 90, 22.5, "PRODUCAO_ABAIXO_DA_DEMANDA", undefined],
    ]);
    expect(alertas(saida).filter((a) => a[0].startsWith("RITMO"))).toEqual([["RITMO_PRODUCAO_ABAIXO_VENDAS", "MEDIA", "Tradicional"]]); // um alerta só, sem contradição
    expect(saida.demanda.divergencias.map((d) => [d.sabor, d.saldo, d.semanasDeDemanda])).toEqual([["Tradicional", -20, 0.89]]);

    // Vendas → contexto de clientes, só para o sabor relevante
    expect(saida.clientes).toMatchObject({ fonte: "AGENTE_VENDAS", solicitada: true, disponivel: true, metodologia: { periodo: { dataInicio: "2026-08-30", dataFim: "2026-09-26" } } });
    expect(saida.clientes.sabores).toEqual([expect.objectContaining({
      saborId: tradicional.id, motivosConsulta: ["PRODUCAO_ABAIXO_DA_DEMANDA", "SALDO_HISTORICO_NEGATIVO"],
      clientesComCompraRecente: 2, clientesRecorrentes: 2, participacaoClientesRecorrentes: 100,
      texto: "Tradicional teve compras de 2 cliente(s) nas 4 semanas completas (30/08 a 26/09); 2 deles com histórico de recompra, responsáveis por 100% das unidades do sabor.",
    })]);
    expect(saida.clientes.sabores.some((s) => s.saborId === maracuja.id)).toBe(false);
    expect(saida.qualidade.exposicaoClientes).toEqual({ confiabilidade: "UTILIZAVEL", sabores: 1 });
    expect(saida.resumo.cooperacao).toEqual({ inteligencia: "RESPONDIDA", vendas: "RESPONDIDA" });

    // enriquece, não decide: nenhuma quantidade a produzir nem previsão de compra; nada escrito no domínio
    expect(JSON.stringify(saida).replace(/não indica que vão comprar de novo|não indica que eles vão comprar de novo/g, "")).not.toMatch(/produza|quantidadeSugerida|vão comprar|comprarão/i);
    expect(await Promise.all([prisma.venda.count(), prisma.producao.count(), prisma.acaoProposta.count()])).toEqual(antes);
  });

  it("auditoria: duas mensagens, duas filhas, as tools de cada especialista e o uso das respostas", async () => {
    await cenarioVendas();
    const { execucaoId } = await analisar();
    const pai = await consultas.buscarExecucao(execucaoId);
    expect(pai.mensagens.map((m) => [m.agenteOrigem, m.agenteDestino, m.tipo, m.status])).toEqual([
      ["estoque", "inteligencia", "DEMANDA_MEDIA", "RESPONDIDA"],
      ["estoque", "vendas", "EXPOSICAO_CLIENTES_POR_SABOR", "RESPONDIDA"],
    ]);
    const [, msgVendas] = pai.mensagens;
    expect(msgVendas.conteudo).toEqual({ dataReferencia: REF, janelaSemanas: 4, saborIds: [expect.any(Number)] });
    expect(EXPOSICAO_CLIENTES.resposta.safeParse(msgVendas.resposta).success).toBe(true);
    // privacidade: a mensagem auditada não leva nomes nem ids de clientes, e é pequena
    expect(JSON.stringify(msgVendas)).not.toMatch(/Mercearia|Quiosque|Padaria|Lanchonete|clienteId/);
    expect(JSON.stringify(msgVendas.resposta).length).toBeLessThan(2000);

    expect(pai.filhas.map((f) => [f.agente, f.tipoExecucao, f.status])).toEqual([["inteligencia", "DEMANDA_MEDIA", "SUCESSO"], ["vendas", "EXPOSICAO_CLIENTES_POR_SABOR", "SUCESSO"]]);
    const filhaVendas = await consultas.buscarExecucao(msgVendas.execucaoDestinoId);
    expect(filhaVendas).toMatchObject({ gatilho: "MENSAGEM", execucaoPaiId: execucaoId, metadados: { profundidade: 1 } });
    expect(filhaVendas.recebidas.map((m) => m.id)).toEqual([msgVendas.id]);
    expect(filhaVendas.chamadasTool.map((c) => [c.tool, c.ok, c.entrada])).toEqual([
      ["consultarVendasDiariasPorSabor", true, { dataInicio: "2026-08-30", dataFim: "2026-09-26" }],
      ["consultarUnidadesClienteSabor", true, { dataInicio: "2026-08-30", dataFim: "2026-09-26" }],
      ["consultarComprasClientes", true, { dataFim: REF }],
    ]);
    // o Estoque usou a resposta: os números da mensagem são os da seção de clientes
    expect(pai.saida.clientes.sabores[0]).toMatchObject(msgVendas.resposta.sabores[0]);
  });

  it("sem sabor relevante (produção alinhada, saldo zero): Vendas não é consultado", async () => {
    const c = await criarCliente();
    const s = await criarSabor({ nome: "Coco Fictício" });
    for (const d of ["2026-07-27", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]) {
      await criarProducao({ itens: [{ saborId: s.id, quantidade: 30 }], data: new Date(`${d}T08:00:00Z`) });
      await criarVenda({ clienteId: c.id, itens: [{ saborId: s.id, quantidade: 30 }], data: new Date(`${d}T12:00:00Z`) });
    }
    const { saida } = await analisar();
    expect(saida.ritmo.sabores.map((x) => x.situacao)).toEqual(["ALINHADA"]);
    expect(saida.clientes).toMatchObject({ solicitada: false, disponivel: false, motivo: "SEM_SABORES_RELEVANTES" });
    expect(saida.qualidade.exposicaoClientes).toMatchObject({ confiabilidade: "NAO_SOLICITADA" });
    expect((await prisma.mensagemAgente.findMany()).map((m) => m.tipo)).toEqual(["DEMANDA_MEDIA"]);
  });
});

describe("falhas independentes dos especialistas", () => {
  it("Vendas falha: Estoque conclui, Inteligência funciona normalmente, contexto de clientes indisponível", async () => {
    await cenarioVendas();
    const { saida, status, execucaoId } = await analisar(runtimeTeste({ substituir: [falhando("vendas")] }));
    expect(status).toBe("SUCESSO");
    expect(saida.clientes).toMatchObject({ solicitada: true, disponivel: false, motivo: "FALHA_AGENTE_VENDAS", execucaoVendasId: expect.any(Number) });
    expect(saida.ritmo.fonteDemanda).toBe("AGENTE_INTELIGENCIA");
    expect(saida.resumo).toMatchObject({ modoDegradado: true, cooperacao: { inteligencia: "RESPONDIDA", vendas: "FALHA" } });
    expect(saida.falhasDeConsulta).toContainEqual({ agente: "vendas", mensagem: "EXPOSICAO_CLIENTES_POR_SABOR", codigo: "FALHA_AGENTE_VENDAS" });
    const pai = await consultas.buscarExecucao(execucaoId);
    expect(pai.mensagens.map((m) => [m.tipo, m.status])).toEqual([["DEMANDA_MEDIA", "RESPONDIDA"], ["EXPOSICAO_CLIENTES_POR_SABOR", "FALHA"]]);
    expect(pai.filhas.map((f) => [f.agente, f.status])).toEqual([["inteligencia", "SUCESSO"], ["vendas", "FALHA"]]);
    expect(saida.recomendacoes.map((r) => r.tipo)).toEqual(["CONTAGEM_FISICA", "CADASTRAR_RECEITAS"]);
  });

  it("Inteligência falha: Vendas ainda é consultado (divergência é base local); ritmo cai para o fluxo local (BAIXA)", async () => {
    await cenarioVendas();
    const { saida } = await analisar(runtimeTeste({ substituir: [falhando("inteligencia")] }));
    expect(saida.resumo.cooperacao).toEqual({ inteligencia: "FALHA", vendas: "RESPONDIDA" });
    expect(saida.ritmo.fonteDemanda).toBe("FLUXO_LOCAL");
    expect(alertas(saida).filter((a) => a[0].startsWith("RITMO"))).toEqual([["RITMO_PRODUCAO_ABAIXO_VENDAS", "BAIXA", "Tradicional"]]);
    expect(saida.clientes.sabores.map((s) => s.motivosConsulta)).toEqual([["PRODUCAO_ABAIXO_DA_DEMANDA", "SALDO_HISTORICO_NEGATIVO"]]);
  });

  it("as duas falham: Estoque conclui só com dados locais, os dois contextos indisponíveis", async () => {
    await cenarioVendas();
    const { saida, status } = await analisar(runtimeTeste({ substituir: [falhando("inteligencia"), falhando("vendas")] }));
    expect(status).toBe("SUCESSO");
    expect(saida.resumo).toMatchObject({ modoDegradado: true, cooperacao: { inteligencia: "FALHA", vendas: "FALHA" } });
    expect(saida.qualidade).toMatchObject({ demandaMediaRecente: { confiabilidade: "INDISPONIVEL" }, exposicaoClientes: { confiabilidade: "INDISPONIVEL" } });
    expect(alertas(saida).map((a) => a[0])).toContain("SALDO_NEGATIVO");
    expect(saida.recomendacoes.map((r) => r.tipo)).toEqual(["CONTAGEM_FISICA", "CADASTRAR_RECEITAS"]);
    expect((await prisma.mensagemAgente.findMany({ orderBy: { id: "asc" } })).map((m) => m.status)).toEqual(["FALHA", "FALHA"]);
  });

  it("Vendas responde com outra janela → descartado (JANELA_DIVERGENTE): nunca compara períodos diferentes", async () => {
    await cenarioVendas();
    const outraJanela = agenteTeste("vendas", async (ctx) => ({
      dataReferencia: REF,
      metodologia: { tipo: "EXPOSICAO_HISTORICA_RECENTE", janelaSemanas: 4, semana: "DOMINGO_A_SABADO", periodo: { dataInicio: "2026-08-23", dataFim: "2026-09-19" }, semanaParcialExcluida: { dataInicio: "2026-09-27", dataFim: REF }, criterioRecorrencia: "x", observacao: "y" },
      sabores: ctx.entrada.dados.saborIds.map((saborId) => ({ saborId, sabor: "x", qualidade: "SEM_VENDAS_NA_JANELA", unidadesRecentes: 0, clientesComCompraRecente: 0, clientesRecorrentes: 0, clientesSemHistoricoSuficiente: 0, unidadesDeClientesRecorrentes: 0, participacaoClientesRecorrentes: null })),
    }));
    const { saida } = await analisar(runtimeTeste({ substituir: [outraJanela] }));
    expect(saida.clientes).toMatchObject({ disponivel: false, motivo: "JANELA_DIVERGENTE" });
    expect(saida.falhasDeConsulta).toContainEqual({ agente: "vendas", mensagem: "EXPOSICAO_CLIENTES_POR_SABOR", codigo: "JANELA_DIVERGENTE" });
  });
});

describe("pela API (autenticada)", () => {
  it("Estoque com as duas cooperações; Vendas direto: ANALISAR_VENDAS, EXPOSICAO e PROPOR_VENDA → ação PENDENTE listada", async () => {
    const { clientes, tradicional } = await cenarioVendas();
    const token = await autenticar();
    const est = await api(token).post("/api/agentes/estoque/executar").send({ tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia: REF } });
    const det = await api(token).get(`/api/agentes/execucoes/${est.body.execucaoId}`);
    expect(det.body.filhas.map((f) => [f.agente, f.status])).toEqual([["inteligencia", "SUCESSO"], ["vendas", "SUCESSO"]]);

    const av = await api(token).post("/api/agentes/vendas/executar").send({ tipo: "ANALISAR_VENDAS", dados: { dataReferencia: REF } });
    expect(av.body).toMatchObject({ agente: "vendas", status: "SUCESSO", saida: { resumo: { pendencias: 3, clientesForaDoPadrao: 1 } } });
    const ex = await api(token).post("/api/agentes/vendas/executar").send({ tipo: "EXPOSICAO_CLIENTES_POR_SABOR", dados: { dataReferencia: REF, saborIds: [tradicional.id] } });
    expect(ex.body.saida.sabores[0]).toMatchObject({ clientesRecorrentes: 2 });
    const pv = await api(token).post("/api/agentes/vendas/executar").send({ tipo: "PROPOR_VENDA", dados: { clienteId: clientes.c.id, sabores: [{ saborId: tradicional.id, quantidade: 20 }], valor: 110 } });
    const pendentes = await api(token).get("/api/agentes/acoes?status=PENDENTE");
    expect(pendentes.body.map((a) => [a.id, a.tipo, a.criadaPorAgente])).toEqual([[pv.body.saida.acao.acaoId, "REGISTRAR_VENDA", "vendas"]]);
    expect((await api().post("/api/agentes/vendas/executar").send({ tipo: "PING" })).status).toBe(401);
  });
});
