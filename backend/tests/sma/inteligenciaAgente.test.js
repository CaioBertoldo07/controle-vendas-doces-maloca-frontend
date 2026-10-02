// Etapa 3 — Agente de Inteligência de ponta a ponta (runtime + tools + services
// + banco de teste), sem LLM. Dados 100% fictícios.
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { CATALOGO } from "../../src/agents/index.js";
import { DEMANDA_MEDIA } from "../../src/agents/contratos/demandaMedia.js";
import { definirTool } from "../../src/agents/tools/definirTool.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { criarCliente, criarSabor, criarVenda } from "../caracterizacao/helpers/fixtures.js";
import { REF, cenarioMultiagente, contagemDominio } from "./cenarioInteligencia.js";
import { capturar, runtimeTeste } from "./helpers.js";

const executar = (tipo, dados = { dataReferencia: REF }, rt = runtimeTeste()) => rt.executarAgente("inteligencia", { tipo, dados }, { gatilho: "HTTP" });
const quebrada = (nome) => definirTool({ nome, descricao: "falha simulada", entrada: z.object({}).passthrough(), executar: async () => { throw new Error("banco fora"); } });
const comToolQuebrada = (nome) => runtimeTeste({ catalogo: new Map([...CATALOGO, [nome, quebrada(nome)]]) });
const chaves = (v, acc = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => chaves(x, acc));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { acc.add(k.toLowerCase()); chaves(x, acc); }
  return acc;
};

describe("ANALISAR_INTELIGENCIA: resumo gerencial do cenário acadêmico", () => {
  it("indicadores, variação, custo agregado, série com MM4, sabores, tendências, perfil e insights", async () => {
    await cenarioMultiagente();
    await prisma.custo.create({ data: { nome: "Açúcar Fictício", quantidade: 10, unidade: "kg", valorTotal: 304, data: new Date("2026-09-10T12:00:00Z") } });
    const antes = await contagemDominio();
    const { saida, status } = await executar("ANALISAR_INTELIGENCIA");
    expect(status).toBe("SUCESSO");

    expect(saida.periodo).toMatchObject({
      semanaParcial: { dataInicio: "2026-09-27", dataFim: REF },
      recente: { dataInicio: "2026-08-30", dataFim: "2026-09-26", semanas: 4 },
      anterior: { dataInicio: "2026-08-02", dataFim: "2026-08-29", semanas: 4 },
      perfil: { dataInicio: "2026-08-02", dataFim: "2026-09-26", semanas: 8 },
    });
    expect(saida.indicadores.recente).toMatchObject({ quantidadeVendas: 12, unidades: 200, faturamentoRegistrado: 1100, ticketMedio: 91.67, unidadesPorVenda: 16.67 });
    expect(saida.indicadores.recente.pagamentos).toMatchObject({ vendasPendentes: 2, valorPendente: 165, confiabilidade: "SITUACAO_ATUAL_DO_REGISTRO" });
    expect(saida.indicadores.anterior.pagamentos.confiabilidade).toBe("COM_RESSALVA"); // começa antes de 14/08
    expect(saida.indicadores.variacao.unidades).toMatchObject({ estado: "CALCULADA", anterior: 180, recente: 200, percentual: 11.1 });
    expect(saida.indicadores.custos).toMatchObject({ natureza: "AGREGADO", custoRegistrado: 304, custoAgregadoPorUnidadeVendida: 1.52, custoSobreFaturamentoPercentual: 27.6 });

    expect(saida.serieSemanal.semanas.slice(-8).map((s) => s.unidades)).toEqual([45, 45, 45, 45, 50, 50, 50, 50]);
    expect(saida.serieSemanal.semanas.slice(-5).map((s) => s.mediaMovel4)).toEqual([45, 46.25, 47.5, 48.75, 50]);
    expect(saida.serieSemanal.semanaParcial).toMatchObject({ inicio: "2026-09-27", fim: REF, unidades: 50 });

    expect(saida.sabores.map((s) => [s.sabor, s.unidadesRecentes, s.participacao, s.mediaSemanal, s.variacao.percentual, s.tendencia])).toEqual([
      ["Tradicional", 120, 60, 30, 50, "ALTA"],
      ["Maracujá", 80, 40, 20, -20, "QUEDA"],
    ]);
    expect(saida.tendencias).toMatchObject({
      natureza: "COMPARACAO_ENTRE_JANELAS_HISTORICAS",
      total: { tendencia: "ESTAVEL", variacao: { percentual: 11.1 } },
      sabores: { ALTA: ["Tradicional"], QUEDA: ["Maracujá"], ESTAVEL: [], INDETERMINADA: [] },
    });
    expect(saida.tendencias.observacao).toBe("A tendência representa apenas a comparação recente entre janelas históricas e não constitui previsão futura.");

    const dias = Object.fromEntries(saida.perfilDiaSemana.total.dias.map((d) => [d.nome, [d.unidades, d.mediaPorOcorrencia, d.participacao]]));
    expect(dias).toMatchObject({ segunda: [100, 12.5, 26.3], terça: [180, 22.5, 47.4], sexta: [100, 12.5, 26.3], sábado: [0, 0, 0] });
    expect(saida.perfilDiaSemana.qualidade).toBe("SUFICIENTE");

    expect(saida.insights.map((i) => i.texto)).toEqual([
      "As vendas das últimas 4 semanas completas (30/08 a 26/09) ficaram 11,1% acima das 4 semanas anteriores (180 → 200 unidades): variação dentro da faixa considerada estável.",
      "Tradicional (60%) e Maracujá (40%) somam 100% das unidades das últimas 4 semanas.",
      "Terça-feira tem a maior média observada: 22,5 unidades por terça-feira nas últimas 8 semanas completas.",
      "Em alta nas últimas 4 semanas, em relação às 4 anteriores: Tradicional (+50%).",
      "Em queda nas últimas 4 semanas, em relação às 4 anteriores: Maracujá (-20%).",
    ]);
    expect(saida.qualidadeDados).toMatchObject({ historicoVendas: { confiabilidade: "SUFICIENTE", primeiraVenda: "2026-07-15", semanasObservadas: 10, semanasComVenda: 8, semanasSemVenda: 2 }, custoPorSabor: "INDISPONIVEL_SEM_RECEITAS" });
    expect(saida.limitacoes.join(" ")).toMatch(/Nenhum número é previsão/);
    expect(saida.resumo).toEqual({ insights: 5, sabores: 2, tendenciaTotal: "ESTAVEL", modoDegradado: false });

    // nada de previsão, margem/custo por sabor ou dado de cliente; nada escrito
    expect([...chaves(saida)].filter((k) => /previs|forecast|margem|cliente|projec/.test(k))).toEqual([]);
    expect(JSON.stringify(saida)).not.toMatch(/Mercearia|Padaria|Infinity|NaN/);
    expect(await contagemDominio()).toEqual(antes);
    expect(await prisma.recomendacao.count()).toBe(0);
  });

  it("perfil por sabor quando solicitado; janela de 8 semanas aceita", async () => {
    await cenarioMultiagente();
    const { saida } = await executar("ANALISAR_INTELIGENCIA", { dataReferencia: REF, perfilPorSabor: true, janelaSemanas: 8 });
    const maracuja = saida.perfilDiaSemana.porSabor.find((s) => s.sabor === "Maracujá");
    expect(maracuja.dias.filter((d) => d.unidades > 0).map((d) => [d.nome, d.participacao])).toEqual([["terça", 100]]);
    expect(saida.periodo.recente).toMatchObject({ semanas: 8, dataInicio: "2026-08-02" });
  });

  it("auditoria: 4 tools com resumo; a de vendas não guarda nomes de clientes", async () => {
    await cenarioMultiagente();
    const { execucaoId } = await executar("ANALISAR_INTELIGENCIA");
    const chamadas = await prisma.chamadaTool.findMany({ where: { execucaoId }, orderBy: { id: "asc" } });
    expect(chamadas.map((c) => [c.tool, c.ok])).toEqual([
      ["consultarVendasDiariasPorSabor", true], ["consultarVendasPeriodo", true], ["consultarVendasPeriodo", true], ["consultarCustosPeriodo", true],
    ]);
    expect(chamadas[0].saida).toMatchObject({ periodo: { dataInicio: "2026-07-05", dataFim: REF }, sabores: 2 });
    expect(chamadas[1].saida).toMatchObject({ totalVendas: 12, unidades: 200, clientes: 2 });
    expect(JSON.stringify(chamadas.map((c) => c.saida))).not.toMatch(/Mercearia|Padaria/);
  });
});

describe("DEMANDA_MEDIA (contrato)", () => {
  it("vários sabores: média semanal e diária das 4 semanas completas; a semana parcial fica de fora", async () => {
    const { tradicional, maracuja } = await cenarioMultiagente();
    const { saida } = await executar("DEMANDA_MEDIA", { dataReferencia: REF, saborIds: [tradicional.id, maracuja.id] });
    expect(DEMANDA_MEDIA.resposta.safeParse(saida).success).toBe(true);
    expect(saida.metodologia).toMatchObject({
      tipo: "MEDIA_HISTORICA_RECENTE", janelaSemanas: 4, periodo: { dataInicio: "2026-08-30", dataFim: "2026-09-26" },
      semanaParcialExcluida: { dataInicio: "2026-09-27", dataFim: REF },
    });
    expect(saida.sabores.map((s) => [s.sabor, s.qualidade, s.unidadesVendidas, s.diasComVenda, s.mediaSemanal, s.mediaDiaria])).toEqual([
      ["Tradicional", "SUFICIENTE", 120, 8, 30, 4.29],
      ["Maracujá", "SUFICIENTE", 80, 4, 20, 2.86],
    ]);
  });

  it("sem saborIds: sabores ativos; sabor curto → DADOS_INSUFICIENTES; sem venda → SEM_HISTORICO; janela de 8", async () => {
    const { cliente } = await cenarioMultiagente();
    const novo = await criarSabor({ nome: "Cupuaçu Fictício" });
    const semVenda = await criarSabor({ nome: "Pistache Fictício" });
    await criarSabor({ nome: "Inativo Fictício", ativo: false });
    await criarVenda({ clienteId: cliente.id, itens: [{ saborId: novo.id, quantidade: 40 }], data: new Date("2026-09-15T12:00:00Z") });
    const { saida } = await executar("DEMANDA_MEDIA", { dataReferencia: REF, janelaSemanas: 8 });
    expect(saida.sabores.map((s) => [s.sabor, s.qualidade, s.semanasObservadas, s.unidadesVendidas, s.mediaSemanal])).toEqual([
      ["Cupuaçu Fictício", "DADOS_INSUFICIENTES", 1, 40, null],
      ["Maracujá", "SUFICIENTE", 8, 180, 22.5],
      ["Pistache Fictício", "SEM_HISTORICO", 0, 0, null],
      ["Tradicional", "SUFICIENTE", 8, 200, 25],
    ]);
    expect(semVenda.id).toBeGreaterThan(0);
  });

  it("venda com data implausível (antes de 2020, como a do ano 0206 da Etapa 0.2) não conta como primeira venda", async () => {
    const c = await criarCliente();
    const novo = await criarSabor({ nome: "Sabor Novo Fictício" });
    await criarVenda({ clienteId: c.id, itens: [{ saborId: novo.id, quantidade: 5 }], data: new Date("1999-03-05T12:00:00Z") });
    await criarVenda({ clienteId: c.id, itens: [{ saborId: novo.id, quantidade: 30 }], data: new Date("2026-09-21T12:00:00Z") });
    const { saida } = await executar("DEMANDA_MEDIA", { dataReferencia: REF, saborIds: [novo.id] });
    expect(saida.sabores[0]).toMatchObject({ primeiraVenda: "2026-09-21", qualidade: "DADOS_INSUFICIENTES", mediaSemanal: null }); // sem o piso: "1999-03-05" e SUFICIENTE
    const analise = await executar("ANALISAR_INTELIGENCIA");
    expect(analise.saida.qualidadeDados.historicoVendas).toMatchObject({ primeiraVenda: "2026-09-21", vendasComDataImplausivel: 1 });
  });

  it.each([
    [{ dataReferencia: REF, janelaSemanas: 3 }, /janelaSemanas/],
    [{ dataReferencia: REF, janelaSemanas: 13 }, /janelaSemanas/],
    [{ dataReferencia: "2026-02-30" }, /dia inexistente/],
    [{ dataReferencia: REF, saborIds: [999999] }, /Sabor\(es\) inexistente\(s\): 999999/],
    [{ dataReferencia: REF, outro: 1 }, /Parâmetros inválidos/],
  ])("pedido inválido %o → execução FALHA controlada", async (dados, mensagem) => {
    const e = await capturar(executar("DEMANDA_MEDIA", dados));
    expect((await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } })).erro).toMatch(mensagem);
  });

  it("tool de vendas falhando → FALHA explícita (sem média inventada)", async () => {
    await cenarioMultiagente();
    const e = await capturar(executar("DEMANDA_MEDIA", { dataReferencia: REF }, comToolQuebrada("consultarVendasDiariasPorSabor")));
    expect((await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } })).erro).toBe("Dados de vendas indisponíveis para a demanda média (ERRO_INTERNO)");
  });
});

describe("modo degradado e casos-limite", () => {
  it("série diária falhando: indicadores continuam; série, tendência, perfil e insights ficam indisponíveis", async () => {
    await cenarioMultiagente();
    const { saida, status } = await executar("ANALISAR_INTELIGENCIA", { dataReferencia: REF }, comToolQuebrada("consultarVendasDiariasPorSabor"));
    expect(status).toBe("SUCESSO");
    expect(saida.resumo).toMatchObject({ modoDegradado: true, tendenciaTotal: "INDETERMINADA", insights: 0 });
    expect(saida.indicadores.recente.unidades).toBe(200);
    expect(saida.serieSemanal).toEqual({ disponivel: false, motivo: "FALHA_CONSULTA_SERIE" });
    expect(saida.perfilDiaSemana.disponivel).toBe(false);
    expect(saida.falhasDeConsulta.map((f) => f.tool)).toEqual(["consultarVendasDiariasPorSabor"]);
  });

  it("vendas e custos falhando: série e tendências continuam; indicadores indisponíveis", async () => {
    await cenarioMultiagente();
    const rt = runtimeTeste({ catalogo: new Map([...CATALOGO, ["consultarVendasPeriodo", quebrada("consultarVendasPeriodo")], ["consultarCustosPeriodo", quebrada("consultarCustosPeriodo")]]) });
    const { saida } = await executar("ANALISAR_INTELIGENCIA", { dataReferencia: REF }, rt);
    expect(saida.indicadores).toMatchObject({ disponivel: false, motivo: "FALHA_CONSULTA_VENDAS", custos: { disponivel: false } });
    expect(saida.tendencias.sabores.ALTA).toEqual(["Tradicional"]);
    expect(saida.resumo.modoDegradado).toBe(true);
  });

  it("banco vazio: SUCESSO, zeros e INDETERMINADA, sem Infinity/NaN nem insight inventado", async () => {
    const { saida } = await executar("ANALISAR_INTELIGENCIA");
    expect(saida.indicadores.recente).toMatchObject({ quantidadeVendas: 0, ticketMedio: null });
    expect(saida.tendencias.total).toMatchObject({ tendencia: "INDETERMINADA", motivo: "DADOS_INSUFICIENTES" });
    expect(saida.qualidadeDados.historicoVendas).toMatchObject({ confiabilidade: "DADOS_INSUFICIENTES", primeiraVenda: null });
    expect(saida.insights).toEqual([]);
    expect(JSON.stringify(saida)).not.toMatch(/Infinity|NaN/);
  });

  it("histórico curto (3 semanas): tendência INDETERMINADA e perfil marcado DADOS_INSUFICIENTES", async () => {
    const c = await criarCliente();
    const s = await criarSabor({ nome: "Coco Fictício" });
    for (const d of ["2026-09-07", "2026-09-14", "2026-09-21"]) await criarVenda({ clienteId: c.id, itens: [{ saborId: s.id, quantidade: 30 }], data: new Date(`${d}T12:00:00Z`) });
    const { saida } = await executar("ANALISAR_INTELIGENCIA");
    expect(saida.sabores[0]).toMatchObject({ tendencia: "INDETERMINADA", motivo: "DADOS_INSUFICIENTES", mediaSemanal: null, qualidade: "DADOS_INSUFICIENTES" });
    expect(saida.perfilDiaSemana.qualidade).toBe("DADOS_INSUFICIENTES");
    expect(saida.insights.map((i) => i.tipo)).toEqual(["CONCENTRACAO_MIX", "HISTORICO_INSUFICIENTE"]); // sem 8 semanas, nada de "dia de maior venda"
  });

  it("parâmetros inválidos, DIAGNOSTICO (usado pelo Coordenador) e PING", async () => {
    const e = await capturar(executar("ANALISAR_INTELIGENCIA", { dataReferencia: "30/09/2026" }));
    expect((await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } })).erro).toMatch(/^Parâmetros inválidos: dataReferencia/);
    expect((await executar("DIAGNOSTICO", {})).saida).toEqual({ agente: "inteligencia", toolsOk: true, tools: { consultarVendasDiariasPorSabor: "ok" } });
    expect((await executar("PING", {})).saida).toEqual({ agente: "inteligencia", pong: true });
  });
});
