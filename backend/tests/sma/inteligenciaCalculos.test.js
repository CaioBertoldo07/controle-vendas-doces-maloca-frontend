// Etapa 3 — cálculos puros do Agente de Inteligência (sem banco, sem tools, sem LLM).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import * as C from "../../src/agents/agentes/inteligencia/calculos.js";

const semana = (inicio) => C.delimitarSemanas(inicio, 1).semanas[0];
const linha = (dia, saborId, unidades) => ({ dia, saborId, unidades });
const semNumerosInvalidos = (v) => expect(JSON.stringify(v)).not.toMatch(/Infinity|NaN/);

describe("delimitação das semanas (domingo a sábado, Manaus)", () => {
  it("quarta-feira: a semana dela é parcial; as completas terminam no sábado anterior", () => {
    const { semanas, parcial } = C.delimitarSemanas("2026-09-30", 8);
    expect(parcial).toEqual({ inicio: "2026-09-27", fim: "2026-09-30" });
    expect(semanas).toHaveLength(8);
    expect(semanas[0]).toEqual({ inicio: "2026-08-02", fim: "2026-08-08" });
    expect(semanas.at(-1)).toEqual({ inicio: "2026-09-20", fim: "2026-09-26" });
  });

  it("sábado de referência continua parcial; domingo começa uma semana nova; virada do ano", () => {
    expect(C.delimitarSemanas("2026-09-26", 1)).toEqual({ semanas: [{ inicio: "2026-09-13", fim: "2026-09-19" }], parcial: { inicio: "2026-09-20", fim: "2026-09-26" } });
    expect(C.delimitarSemanas("2026-09-27", 1)).toEqual({ semanas: [{ inicio: "2026-09-20", fim: "2026-09-26" }], parcial: { inicio: "2026-09-27", fim: "2026-09-27" } });
    expect(C.delimitarSemanas("2026-01-02", 2).semanas).toEqual([{ inicio: "2025-12-14", fim: "2025-12-20" }, { inicio: "2025-12-21", fim: "2025-12-27" }]);
    const { anterior, recente } = C.dividirJanelas(C.delimitarSemanas("2026-09-30", 8).semanas, 4);
    expect([C.periodoDe(anterior), C.periodoDe(recente)]).toEqual([
      { dataInicio: "2026-08-02", dataFim: "2026-08-29" }, { dataInicio: "2026-08-30", dataFim: "2026-09-26" },
    ]);
  });

  it("série semanal: zeros preenchidos, por sabor e total; a semana parcial fica de fora", () => {
    const { semanas } = C.delimitarSemanas("2026-09-30", 3);
    const dias = [linha("2026-09-06", 1, 5), linha("2026-09-12", 1, 5), linha("2026-09-12", 2, 3), linha("2026-09-26", 2, 7), linha("2026-09-28", 1, 99), linha("2026-08-01", 1, 99)];
    const { total, porSabor } = C.serieSemanal(dias, semanas);
    expect(total).toEqual([13, 0, 7]);
    expect(porSabor.get(1)).toEqual([10, 0, 0]);
    expect(porSabor.get(2)).toEqual([3, 0, 7]);
    expect(C.somarJanelas([1, 2, 3, 4, 5, 6, 7, 8], 4)).toEqual({ anterior: 10, recente: 26 });
  });
});

describe("média móvel de 4 semanas (suavização descritiva)", () => {
  it.each([
    ["constante", [10, 10, 10, 10, 10], [null, null, null, 10, 10]],
    ["crescente", [10, 20, 30, 40, 50, 60], [null, null, null, 25, 35, 45]],
    ["decrescente", [60, 50, 40, 30, 20], [null, null, null, 45, 35]],
    ["com semanas zero", [0, 8, 0, 0, 4], [null, null, null, 2, 3]],
    ["menos de 4 semanas", [5, 6, 7], [null, null, null]],
    ["exatamente 4 semanas", [1, 2, 3, 5], [null, null, null, 2.75]],
    ["série vazia", [], []],
  ])("%s", (_, serie, esperado) => {
    expect(C.mediaMovel(serie)).toEqual(esperado);
  });
});

describe("variação entre janelas: nunca Infinity, NaN nem percentual enganoso", () => {
  it.each([
    [100, 120, { estado: "CALCULADA", diferenca: 20, percentual: 20 }],
    [80, 120, { estado: "CALCULADA", diferenca: 40, percentual: 50 }],
    [100, 80, { estado: "CALCULADA", diferenca: -20, percentual: -20 }],
    [3, 1, { estado: "CALCULADA", percentual: -66.7 }],
    [0, 15, { estado: "BASE_ZERO", diferenca: 15, percentual: null }],
    [0, 0, { estado: "AMBOS_ZERO", percentual: null }],
    [null, 10, { estado: "INDISPONIVEL", percentual: null }],
    [NaN, 10, { estado: "INDISPONIVEL", percentual: null }],
  ])("%s → %s", (anterior, recente, esperado) => {
    const v = C.variacao(anterior, recente);
    expect(v).toMatchObject(esperado);
    semNumerosInvalidos(v);
  });
});

describe("tendência recente (comparação entre janelas, não previsão)", () => {
  const t = (a, r, opcoes) => C.classificarTendencia(C.variacao(a, r), opcoes);
  it.each([
    [100, 115, "ALTA", undefined],        // exatamente +15%
    [100, 114, "ESTAVEL", undefined],
    [100, 86, "ESTAVEL", undefined],
    [100, 85, "QUEDA", undefined],        // exatamente −15%
    [80, 120, "ALTA", undefined],
    [100, 80, "QUEDA", undefined],
    [100, 100, "ESTAVEL", undefined],
    [5, 10, "INDETERMINADA", "VOLUME_BAIXO"], // 15 un. nas duas janelas < 20
    [10, 10, "ESTAVEL", undefined],        // 20 un.: exatamente o volume mínimo
    [0, 30, "INDETERMINADA", "BASE_ZERO"],
    [0, 0, "INDETERMINADA", "AMBOS_ZERO"],
  ])("%s → %s: %s", (a, r, tendencia, motivo) => {
    const res = t(a, r);
    expect(res.tendencia).toBe(tendencia);
    expect(res.motivo).toBe(motivo);
  });

  it("sem as duas janelas observadas → INDETERMINADA por DADOS_INSUFICIENTES, mesmo com variação grande", () => {
    expect(t(10, 100, { suficiente: false })).toEqual({ tendencia: "INDETERMINADA", motivo: "DADOS_INSUFICIENTES" });
    expect(C.PARAMETROS).toMatchObject({ LIMIAR_TENDENCIA_PERCENTUAL: 15, VOLUME_MINIMO_TENDENCIA: 20, JANELA_SEMANAS: 4, SEMANAS_PERFIL: 8 });
  });
});

describe("dados insuficientes e demanda média recente", () => {
  const { semanas } = C.delimitarSemanas("2026-09-30", 4); // 30/08 a 26/09

  it.each([
    ["primeira venda bem antes da janela", "2026-03-01", 4, "SUFICIENTE"],
    ["primeira venda no domingo que abre a janela", "2026-08-30", 4, "SUFICIENTE"],
    ["primeira venda na segunda da 1ª semana", "2026-08-31", 3, "DADOS_INSUFICIENTES"],
    ["sabor de poucos dias (lançado há 1 semana)", "2026-09-21", 0, "DADOS_INSUFICIENTES"],
    ["nenhuma venda até o fim da janela", null, 0, "SEM_HISTORICO"],
  ])("%s → %s semanas observadas, %s", (_, primeiraVenda, observadas, qualidade) => {
    expect(C.semanasObservadas(semanas, primeiraVenda)).toBe(observadas);
    expect(C.qualidadeAmostra(semanas, primeiraVenda)).toBe(qualidade);
  });

  it("média semanal e diária só com amostra suficiente; sem extrapolação", () => {
    const dias = [linha("2026-08-31", 1, 40), linha("2026-09-08", 1, 30), linha("2026-09-15", 1, 30), linha("2026-09-22", 1, 20), linha("2026-09-28", 1, 500), linha("2026-09-22", 2, 9)];
    expect(C.demandaMediaSabor({ saborId: 1, sabor: "Coco", primeiraVenda: "2026-03-01" }, semanas, dias)).toEqual({
      saborId: 1, sabor: "Coco", qualidade: "SUFICIENTE", primeiraVenda: "2026-03-01", semanasObservadas: 4,
      unidadesVendidas: 120, diasComVenda: 4, mediaSemanal: 30, mediaDiaria: 4.29,
    });
    expect(C.demandaMediaSabor({ saborId: 2, sabor: "Novo", primeiraVenda: "2026-09-22" }, semanas, dias)).toMatchObject({
      qualidade: "DADOS_INSUFICIENTES", unidadesVendidas: 9, mediaSemanal: null, mediaDiaria: null,
    });
    expect(C.demandaMediaSabor({ saborId: 3, sabor: "Parado", primeiraVenda: "2026-01-10" }, semanas, dias)).toMatchObject({
      qualidade: "SUFICIENTE", unidadesVendidas: 0, mediaSemanal: 0, mediaDiaria: 0,
    });
  });
});

describe("perfil por dia da semana (descritivo)", () => {
  const { semanas } = C.delimitarSemanas("2026-09-30", 2); // 13/09 a 26/09
  const dias = [
    linha("2026-09-14", 1, 10), linha("2026-09-14", 2, 10), linha("2026-09-18", 1, 30), // seg 20, sex 30
    linha("2026-09-21", 1, 20), linha("2026-09-25", 1, 10), linha("2026-09-26", 2, 10), // seg 20, sex 10, sáb 10
    linha("2026-09-28", 1, 999), // semana parcial: fora
  ];

  it("unidades, média por ocorrência, dias com venda e participação; dia de maior venda", () => {
    const p = C.perfilDiaSemana(dias, semanas);
    expect(p).toMatchObject({ semanas: 2, periodo: { dataInicio: "2026-09-13", dataFim: "2026-09-26" }, unidades: 90 });
    expect(p.dias.map((d) => [d.nome, d.unidades, d.diasComVenda, d.mediaPorOcorrencia, d.participacao])).toEqual([
      ["domingo", 0, 0, 0, 0], ["segunda", 40, 2, 20, 44.4], ["terça", 0, 0, 0, 0], ["quarta", 0, 0, 0, 0],
      ["quinta", 0, 0, 0, 0], ["sexta", 40, 2, 20, 44.4], ["sábado", 10, 1, 5, 11.1],
    ]);
    expect(C.diasDeMaiorVenda(p).map((d) => d.nome)).toEqual(["segunda", "sexta"]); // empate mantido
  });

  it("por sabor; sem venda nenhuma → participação null e nenhum dia de maior venda", () => {
    expect(C.perfilDiaSemana(dias, semanas, { saborId: 2 }).dias.filter((d) => d.unidades > 0).map((d) => d.nome)).toEqual(["segunda", "sábado"]);
    const vazio = C.perfilDiaSemana([], semanas);
    expect(vazio.dias.every((d) => d.participacao === null)).toBe(true);
    expect(C.diasDeMaiorVenda(vazio)).toEqual([]);
  });
});

describe("indicadores gerais e custos agregados", () => {
  const vendas = (dataInicio, extra = {}) => ({
    periodo: { dataInicio, dataFim: "2026-09-26" }, totalVendas: 4, vendasPagas: 3, vendasPendentes: 1,
    unidades: 100, valorTotal: 550, valorPago: 412.5, valorPendente: 137.5, ...extra,
  });

  it("ticket médio e unidades por venda; pagamento com ressalva antes de 14/08/2026; pendente não é inadimplência", () => {
    const depois = C.indicadoresVendas(vendas("2026-08-30"));
    expect(depois).toMatchObject({ quantidadeVendas: 4, unidades: 100, faturamentoRegistrado: 550, ticketMedio: 137.5, unidadesPorVenda: 25 });
    expect(depois.pagamentos).toMatchObject({ vendasPendentes: 1, valorPendente: 137.5, confiabilidade: "SITUACAO_ATUAL_DO_REGISTRO" });
    expect(depois.pagamentos.observacao).toMatch(/não é inadimplência/);
    expect(C.indicadoresVendas(vendas("2026-08-13")).pagamentos.confiabilidade).toBe("COM_RESSALVA");
    expect(C.indicadoresVendas(vendas("2026-08-14")).pagamentos.confiabilidade).toBe("SITUACAO_ATUAL_DO_REGISTRO");
    expect(C.indicadoresVendas(vendas("2026-08-30", { totalVendas: 0, unidades: 0, valorTotal: 0 }))).toMatchObject({ ticketMedio: null, unidadesPorVenda: null });
  });

  it("custo AGREGADO por unidade e sobre o faturamento; nunca por sabor; sem vendas → null", () => {
    const custos = { periodo: { dataInicio: "2026-08-30", dataFim: "2026-09-26" }, quantidade: 2, valorTotal: 152, porCategoria: [{ categoria: "Matéria Prima", quantidade: 2, valorTotal: 152 }] };
    const c = C.indicadoresCustos(custos, C.indicadoresVendas(vendas("2026-08-30")));
    expect(c).toMatchObject({ natureza: "AGREGADO", custoRegistrado: 152, custoAgregadoPorUnidadeVendida: 1.52, custoSobreFaturamentoPercentual: 27.6 });
    expect(c.observacao).toMatch(/Não existe custo nem margem por sabor/);
    expect(C.indicadoresCustos(custos, null)).toMatchObject({ custoAgregadoPorUnidadeVendida: null, custoSobreFaturamentoPercentual: null });
  });
});

describe("sabores e insights determinísticos", () => {
  const { semanas } = C.delimitarSemanas("2026-09-30", 8);
  const janelas = C.dividirJanelas(semanas, 4);
  // Tradicional: 20/semana → 30/semana; Maracujá: 25 → 20; Novo: só nas 2 últimas semanas
  const dias = semanas.flatMap((s, i) => [
    linha(s.inicio, 1, i < 4 ? 20 : 30), linha(s.inicio, 2, i < 4 ? 25 : 20), ...(i >= 6 ? [linha(s.inicio, 3, 10)] : []),
  ]);
  const sabores = [
    { saborId: 1, sabor: "Tradicional", ativo: true, primeiraVenda: semanas[0].inicio },
    { saborId: 2, sabor: "Maracujá", ativo: true, primeiraVenda: semanas[0].inicio },
    { saborId: 3, sabor: "Novo", ativo: true, primeiraVenda: semanas[6].inicio },
    { saborId: 4, sabor: "Antigo inativo", ativo: false, primeiraVenda: "2026-03-01" },
  ];
  const { total, porSabor } = C.serieSemanal(dias, semanas);
  const analisados = C.analisarSabores({ sabores, dias, janelas, porSabor, semanasSerie: semanas });

  it("participação, média, variação e tendência por sabor; inativo sem venda some; sabor novo é INDETERMINADA", () => {
    expect(analisados.map((s) => [s.sabor, s.unidadesRecentes, s.participacao, s.mediaSemanal, s.variacao.percentual, s.tendencia, s.motivo])).toEqual([
      ["Tradicional", 120, 54.5, 30, 50, "ALTA", undefined],
      ["Maracujá", 80, 36.4, 20, -20, "QUEDA", undefined],
      ["Novo", 20, 9.1, null, null, "INDETERMINADA", "DADOS_INSUFICIENTES"],
    ]);
    expect(analisados[0].serieSemanal).toEqual([20, 20, 20, 20, 30, 30, 30, 30]);
  });

  it("frases geradas dos números (sem LLM)", () => {
    const v = C.variacao(...Object.values(C.somarJanelas(total, 4)));
    const tendenciaTotal = { variacao: v, ...C.classificarTendencia(v) };
    const insights = C.gerarInsights({ tendenciaTotal, janelas, sabores: analisados, perfil: C.perfilDiaSemana(dias, semanas) });
    expect(insights.map((i) => i.tipo)).toEqual(["VARIACAO_VENDAS", "CONCENTRACAO_MIX", "DIA_DE_MAIOR_VENDA", "SABORES_EM_ALTA", "SABORES_EM_QUEDA", "HISTORICO_INSUFICIENTE"]);
    expect(insights.map((i) => i.texto)).toEqual([
      "As vendas das últimas 4 semanas completas (30/08 a 26/09) ficaram 22,2% acima das 4 semanas anteriores (180 → 220 unidades): tendência recente de alta.",
      "Tradicional (54,5%) e Maracujá (36,4%) somam 90,9% das unidades das últimas 4 semanas.",
      "Domingo tem a maior média observada: 50 unidades por domingo nas últimas 8 semanas completas.",
      "Em alta nas últimas 4 semanas, em relação às 4 anteriores: Tradicional (+50%).",
      "Em queda nas últimas 4 semanas, em relação às 4 anteriores: Maracujá (-20%).",
      "Sem 8 semanas completas de histórico para medir tendência: Novo.",
    ]);
  });
});

describe("independência do fuso do processo", () => {
  it("os mesmos cálculos dão o mesmo resultado com TZ=UTC, America/Manaus e Asia/Tokyo", () => {
    const url = pathToFileURL(path.resolve("src/agents/agentes/inteligencia/calculos.js")).href;
    const codigo = `
      const C = await import(${JSON.stringify(url)});
      const { semanas, parcial } = C.delimitarSemanas("2026-03-01", 8);
      const dias = semanas.map((s, i) => ({ dia: s.inicio, saborId: 1, unidades: 10 + i }));
      console.log(JSON.stringify([semanas, parcial, C.serieSemanal(dias, semanas).total, C.perfilDiaSemana(dias, semanas),
        C.demandaMediaSabor({ saborId: 1, sabor: "x", primeiraVenda: "2026-01-01" }, semanas.slice(-4), dias)]));`;
    const rodar = (TZ) => {
      const r = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], { env: { ...process.env, TZ }, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    };
    const utc = rodar("UTC");
    expect(rodar("America/Manaus")).toBe(utc);
    expect(rodar("Asia/Tokyo")).toBe(utc);
  });
});
