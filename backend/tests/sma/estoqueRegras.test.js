// Etapa 2 — regras puras do Agente de Estoque (sem banco, sem tools, sem LLM).
import { describe, expect, it } from "vitest";
import * as R from "../../src/agents/agentes/estoque/regras.js";
import { DEMANDA_MEDIA } from "../../src/agents/contratos/demandaMedia.js";
import { semanasCompletas } from "../../src/lib/periodos.js";

const item = (saborId, sabor, produzido, vendido) => ({ saborId, sabor, produzido, vendido, saldo: produzido - vendido });
const estoque = (...itens) =>
  R.diagnosticarEstoqueAcabado({
    itens,
    totalProduzido: itens.reduce((s, i) => s + i.produzido, 0),
    totalVendido: itens.reduce((s, i) => s + i.vendido, 0),
    totalSaldo: itens.reduce((s, i) => s + i.saldo, 0),
  });
const tipos = (alertas) => alertas.map((a) => [a.tipo, a.subtipo ?? null, a.prioridade, a.entidade.nome ?? null]);
// Etapa 4: ritmo numa janela canônica só (4 semanas completas), com a demanda da Inteligência quando disponível.
const JANELA = { dataInicio: "2026-08-30", dataFim: "2026-09-26", semanas: 4, semanaParcialExcluida: { dataInicio: "2026-09-27", dataFim: "2026-09-30" } };
const ritmoDe = (sabores, demanda = { disponivel: false }) => R.diagnosticarRitmo({ janela: JANELA, fluxos: { sabores }, demanda });
const demandaDe = (...sabores) => ({ disponivel: true, sabores: sabores.map(([saborId, qualidade, mediaSemanal]) => ({ saborId, qualidade, mediaSemanal })) });
const fluxo = (saborId, sabor, produzido, vendido) => ({ saborId, sabor, produzido, vendido });

describe("estoque acabado: saldo contábil histórico, nunca estoque físico", () => {
  it("classifica positivo, zerado e negativo; vários sabores; natureza explícita", () => {
    const d = estoque(item(1, "Coco", 50, 30), item(2, "Limão", 20, 20), item(3, "Tradicional", 80, 100));
    expect(d).toMatchObject({ disponivel: true, natureza: "SALDO_CONTABIL_HISTORICO", contagem: { sabores: 3, positivos: 1, zerados: 1, negativos: 1 } });
    expect(d.sabores.map((s) => s.situacao)).toEqual(["POSITIVO", "ZERADO", "NEGATIVO"]);
    expect(d.aviso).toMatch(/Não representa o estoque físico/);
    expect(R.diagnosticarEstoqueAcabado(null)).toMatchObject({ disponivel: false, motivo: "FALHA_CONSULTA_ESTOQUE" });
  });

  it("saldo negativo → SALDO_NEGATIVO (MEDIA) falando em divergência, não em estoque físico", () => {
    const [a, sistema] = R.alertasEstoqueAcabado(estoque(item(3, "Tradicional", 80, 100)));
    expect(a).toMatchObject({ tipo: "SALDO_NEGATIVO", prioridade: "MEDIA", entidade: { tipo: "SABOR", id: 3, nome: "Tradicional" }, dados: { saldo: -20, divergenciaSobreVendas: 0.2 } });
    expect(a.mensagem).toBe("Há divergência histórica de estoque para Tradicional: o saldo calculado está negativo em 20 unidade(s). É necessária reconciliação física antes de usar esse valor operacionalmente.");
    expect(sistema).toMatchObject({ tipo: "DADOS_ESTOQUE_NAO_RECONCILIADOS", prioridade: "MEDIA" });
  });

  it("venda sem nenhuma produção → DIVERGENCIA_ESTOQUE/VENDA_SEM_PRODUCAO (e não também SALDO_NEGATIVO)", () => {
    const alertas = R.alertasEstoqueAcabado(estoque(item(4, "Pistache", 0, 12)));
    expect(tipos(alertas)).toEqual([["DIVERGENCIA_ESTOQUE", "VENDA_SEM_PRODUCAO", "MEDIA", "Pistache"], ["DADOS_ESTOQUE_NAO_RECONCILIADOS", null, "MEDIA", null]]);
  });

  it.each([
    ["49 un (abaixo do absoluto)", 245, 196, false],
    ["50 un e 20% do produzido", 250, 200, true],
    ["50 un mas 19,9% do produzido", 251, 201, false],
  ])("saldo acumulado alto: %s", (_, produzido, vendido, alerta) => {
    const alertas = R.alertasEstoqueAcabado(estoque(item(5, "Coco", produzido, vendido)));
    expect(alertas.some((a) => a.subtipo === "SALDO_ACUMULADO_ALTO")).toBe(alerta);
  });

  it("tudo positivo e sem divergência: só o aviso de não reconciliado (BAIXA); sem sabores: nenhum alerta", () => {
    expect(tipos(R.alertasEstoqueAcabado(estoque(item(1, "Coco", 50, 40))))).toEqual([["DADOS_ESTOQUE_NAO_RECONCILIADOS", null, "BAIXA", null]]);
    expect(R.alertasEstoqueAcabado(estoque())).toEqual([]);
  });
});

describe("matéria-prima: só o que os dados permitem", () => {
  const mp = (materiaPrimaId, nome, saldo, movimentacoes, saldoBaixoLegado = false) =>
    ({ materiaPrimaId, nome, unidadeBase: "g", saldo, movimentacoes, saldoBaixoLegado, ultimaMovimentacao: null, saldoNegativo: saldo < 0 });

  it("negativa → ALTA; sem movimento → BAIXA; saldo 'baixo' legado (< 200) é ignorado", () => {
    const d = R.diagnosticarMateriasPrimas([mp(1, "Açúcar", -300, 4), mp(2, "Coco", 0, 0), mp(3, "Leite", 150, 2, true)]);
    expect(d.confiabilidade).toBe("PARCIAL");
    expect(d.itens.map((i) => i.situacao)).toEqual(["NEGATIVO", "SEM_MOVIMENTO", "COM_SALDO_CALCULADO"]);
    expect(tipos(R.alertasMateriasPrimas(d))).toEqual([["MATERIA_PRIMA_NEGATIVA", null, "ALTA", "Açúcar"], ["MATERIA_PRIMA_SEM_MOVIMENTO", null, "BAIXA", "Coco"]]);
  });

  it("modo degradado: nenhuma matéria-prima ou consulta que falhou → INDISPONIVEL, sem alertas", () => {
    expect(R.diagnosticarMateriasPrimas([])).toMatchObject({ disponivel: true, confiabilidade: "INDISPONIVEL", motivo: "SEM_MATERIAS_PRIMAS_CADASTRADAS" });
    expect(R.diagnosticarMateriasPrimas(null)).toMatchObject({ disponivel: false, motivo: "FALHA_CONSULTA_MATERIAS_PRIMAS" });
    expect(R.alertasMateriasPrimas(R.diagnosticarMateriasPrimas([]))).toEqual([]);
    expect(R.diagnosticarMateriasPrimas([mp(1, "Açúcar", 900, 3)]).confiabilidade).toBe("UTILIZAVEL_COM_RESSALVAS");
  });
});

describe("receitas e MRP: ausência de receita = informação ausente, não consumo zero", () => {
  const rec = (saborId, sabor, utilizavel) => ({ saborId, sabor, utilizavel });

  it("nenhuma receita → MRP INDISPONIVEL_POR_DADOS, RECEITA_AUSENTE por sabor e MRP_INDISPONIVEL", () => {
    const d = R.diagnosticarReceitas([rec(1, "Coco", false), rec(2, "Limão", false)]);
    expect(d).toMatchObject({ confiabilidade: "INDISPONIVEL", mrp: { disponivel: false, estado: "INDISPONIVEL_POR_DADOS", motivo: "RECEITAS_NAO_CADASTRADAS" } });
    expect(tipos(R.alertasReceitas(d))).toEqual([
      ["RECEITA_AUSENTE", null, "MEDIA", "Coco"], ["RECEITA_AUSENTE", null, "MEDIA", "Limão"], ["MRP_INDISPONIVEL", null, "MEDIA", null],
    ]);
    expect(R.alertasReceitas(d)[0].mensagem).toMatch(/desconhecido, não zero/);
  });

  it("parcial → MRP PARCIAL (disponível só para quem tem receita); completa → DISPONIVEL; sem sabores; falha", () => {
    expect(R.diagnosticarReceitas([rec(1, "Coco", true), rec(2, "Limão", false)])).toMatchObject({ confiabilidade: "PARCIAL", mrp: { disponivel: true, estado: "PARCIAL" } });
    expect(R.alertasReceitas(R.diagnosticarReceitas([rec(1, "Coco", true), rec(2, "Limão", false)])).map((a) => a.tipo)).toEqual(["RECEITA_AUSENTE"]);
    expect(R.diagnosticarReceitas([rec(1, "Coco", true)])).toMatchObject({ confiabilidade: "COMPLETA", mrp: { disponivel: true, estado: "DISPONIVEL" } });
    expect(R.diagnosticarReceitas([]).mrp).toMatchObject({ disponivel: false, motivo: "SEM_SABORES_ATIVOS" });
    expect(R.diagnosticarReceitas(null).mrp).toMatchObject({ disponivel: false, estado: "INDISPONIVEL_POR_FALHA" });
  });

  it("simulação de MRP só com receita e com volume vendido na janela canônica (não é previsão)", () => {
    const ritmo = ritmoDe([fluxo(1, "Coco", 40, 30), fluxo(2, "Limão", 10, 25)]);
    expect(R.pedidoSimulacaoMRP(R.diagnosticarReceitas([rec(1, "Coco", false)]), ritmo)).toEqual({ executar: false, motivo: "RECEITAS_NAO_CADASTRADAS" });
    expect(R.pedidoSimulacaoMRP(R.diagnosticarReceitas([rec(1, "Coco", true), rec(2, "Limão", false)]), ritmo))
      .toEqual({ executar: true, sabores: [{ saborId: 1, quantidade: 30 }], base: "VOLUME_VENDIDO_NA_JANELA_CANONICA" });
    expect(R.pedidoSimulacaoMRP(R.diagnosticarReceitas([rec(3, "Pistache", true)]), ritmo)).toEqual({ executar: false, motivo: "SEM_VOLUME_DE_REFERENCIA" });
  });
});

// Etapa 4: as janelas de 7 e 30 dias deram lugar à janela canônica de 4 semanas completas (a mesma da
// Inteligência). Mesmas fronteiras de antes; a confirmação MEDIA agora vem da demanda SUFICIENTE da Inteligência.
describe("ritmo canônico produção × vendas (4 semanas completas)", () => {
  const coco = (produzido, vendido) => [fluxo(1, "Coco", produzido, vendido)];
  it.each([
    ["vendas abaixo do mínimo (19)", coco(10, 19), undefined, []],
    ["razão exatamente 0,9 → alinhada", coco(18, 20), undefined, []],
    ["razão 0,8 só com fluxo local → BAIXA", coco(80, 100), undefined, [["RITMO_PRODUCAO_ABAIXO_VENDAS", null, "BAIXA", "Coco"]]],
    ["razão 0,8 com demanda SUFICIENTE da Inteligência → MEDIA", coco(80, 100), demandaDe([1, "SUFICIENTE", 25]), [["RITMO_PRODUCAO_ABAIXO_VENDAS", null, "MEDIA", "Coco"]]],
    ["razão 0,8 mas sabor com DADOS_INSUFICIENTES → sem conclusão", coco(80, 100), demandaDe([1, "DADOS_INSUFICIENTES", null]), []],
    ["razão exatamente 1,5", coco(30, 20), undefined, []],
    ["razão 1,55 → acima (BAIXA)", coco(31, 20), undefined, [["RITMO_PRODUCAO_ACIMA_VENDAS", null, "BAIXA", "Coco"]]],
    ["produziu 20 e não vendeu → acima", coco(20, 0), undefined, [["RITMO_PRODUCAO_ACIMA_VENDAS", null, "BAIXA", "Coco"]]],
    ["produziu 19 e não vendeu → sem alerta", coco(19, 0), undefined, []],
  ])("%s", (_, fluxos, demanda, esperado) => {
    expect(tipos(R.alertasRitmo(ritmoDe(fluxos, demanda)))).toEqual(esperado);
  });

  it("uma visão só: situação, texto e fonte por sabor; janela canônica na virada do ano; falha → indisponível", () => {
    const r = ritmoDe([fluxo(1, "Coco", 80, 120), fluxo(2, "Limão", 10, 5)], demandaDe([1, "SUFICIENTE", 30], [2, "SEM_HISTORICO", null]));
    expect(r).toMatchObject({ disponivel: true, fonteDemanda: "AGENTE_INTELIGENCIA", produzido: 90, vendido: 125 });
    expect(r.sabores.map((s) => [s.sabor, s.situacao, s.motivo, s.razaoProducaoVendas, s.producaoMediaSemanal, s.demandaMediaSemanal])).toEqual([
      ["Coco", "PRODUCAO_ABAIXO_DA_DEMANDA", undefined, 0.667, 20, 30], ["Limão", "SEM_CONCLUSAO", "SEM_HISTORICO", 2, 2.5, null],
    ]);
    expect(r.sabores[0].texto).toBe("A demanda média recente de Coco é 30 un./semana (4 semanas completas, 30/08 a 26/09). A produção no mesmo período foi de 20 un./semana, abaixo desse ritmo.");
    expect(ritmoDe(coco(80, 100)).sabores[0].texto).toBe("Nas 4 semanas completas, 30/08 a 26/09, Coco teve 25 un./semana vendidas e 20 un./semana produzidas: produção abaixo do ritmo de vendas.");
    expect(semanasCompletas("2026-01-03", 4)).toEqual({
      semanas: [{ inicio: "2025-11-30", fim: "2025-12-06" }, { inicio: "2025-12-07", fim: "2025-12-13" }, { inicio: "2025-12-14", fim: "2025-12-20" }, { inicio: "2025-12-21", fim: "2025-12-27" }],
      parcial: { inicio: "2025-12-28", fim: "2026-01-03" },
    });
    expect(R.diagnosticarRitmo({ janela: JANELA, fluxos: null, demanda: { disponivel: false } })).toMatchObject({ disponivel: false, motivo: "FALHA_CONSULTA_FLUXOS" });
    expect(R.saboresComMovimento({ sabores: [fluxo(3, "A", 0, 0), fluxo(2, "B", 1, 0), fluxo(1, "C", 0, 4)] })).toEqual([1, 2]);
  });

  // Etapa 4: regra de consulta ao Vendas (calibrada na cópia real: sem o filtro de movimento, 7 sabores eram
  // consultados, 2 deles parados na janela, com exposição zero)
  it("sabores para exposição: abaixo da demanda OU divergência, sempre com movimento na janela; sem fluxos, só a divergência", () => {
    const ritmo = ritmoDe([fluxo(1, "Coco", 10, 30), fluxo(2, "Limão", 20, 20), fluxo(3, "Uva", 0, 0)]);
    const neg = (id, nome) => ({ tipo: "SALDO_NEGATIVO", entidade: { tipo: "SABOR", id, nome }, dados: { saldo: -5 } });
    const semProducao = { tipo: "DIVERGENCIA_ESTOQUE", subtipo: "VENDA_SEM_PRODUCAO", entidade: { tipo: "SABOR", id: 2, nome: "Limão" }, dados: { saldo: -3 } };
    expect(R.saboresParaExposicao({ ritmo, alertas: [neg(1, "Coco"), semProducao, neg(9, "Parado")] })).toEqual([
      { saborId: 1, motivos: ["PRODUCAO_ABAIXO_DA_DEMANDA", "SALDO_HISTORICO_NEGATIVO"] },
      { saborId: 2, motivos: ["VENDA_SEM_PRODUCAO"] },
    ]);
    expect(R.saboresParaExposicao({ ritmo: { disponivel: false }, alertas: [neg(9, "Parado")] })).toEqual([{ saborId: 9, motivos: ["SALDO_HISTORICO_NEGATIVO"] }]);
    expect(R.saboresParaExposicao({ ritmo: ritmoDe([fluxo(2, "Limão", 20, 20)]), alertas: [] })).toEqual([]);
  });
});

describe("recomendações por regra", () => {
  it("contagem física: MEDIA com metade dos sabores divergente; ALTA com mais da metade; chave estável", () => {
    const metade = estoque(item(1, "Tradicional", 80, 100), item(2, "Maracujá", 100, 80));
    const [rec] = R.gerarRecomendacoes({ estoque: metade, alertas: R.alertasEstoqueAcabado(metade) });
    expect(rec).toMatchObject({ tipo: "CONTAGEM_FISICA", chave: "estoque-acabado", prioridade: "MEDIA", titulo: "Realizar contagem física do estoque acabado" });
    expect(rec.dados).toEqual({ sabores: [{ saborId: 1, sabor: "Tradicional", saldo: -20 }], proporcaoDivergente: 0.5 });
    const maioria = estoque(item(1, "A", 1, 5), item(2, "B", 1, 5), item(3, "C", 9, 1));
    expect(R.gerarRecomendacoes({ estoque: maioria, alertas: R.alertasEstoqueAcabado(maioria) })[0].prioridade).toBe("ALTA");
  });

  it("revisar registros por sabor vendido sem produção; receitas numa recomendação só; matéria-prima negativa ALTA", () => {
    const e = estoque(item(4, "Pistache", 0, 12));
    const alertas = [
      ...R.alertasEstoqueAcabado(e),
      ...R.alertasReceitas(R.diagnosticarReceitas([{ saborId: 4, sabor: "Pistache", utilizavel: false }, { saborId: 5, sabor: "Coco", utilizavel: false }])),
      ...R.alertasMateriasPrimas(R.diagnosticarMateriasPrimas([{ materiaPrimaId: 9, nome: "Açúcar", unidadeBase: "g", saldo: -1, movimentacoes: 2 }])),
    ];
    const recs = R.gerarRecomendacoes({ estoque: e, alertas });
    expect(recs.map((r) => [r.tipo, r.chave, r.prioridade])).toEqual([
      ["CONTAGEM_FISICA", "estoque-acabado", "ALTA"],
      ["REVISAR_REGISTROS_SABOR", "sabor:4", "MEDIA"],
      ["CADASTRAR_RECEITAS", "receitas", "MEDIA"],
      ["REVISAR_MOVIMENTACOES_MATERIA_PRIMA", "materia-prima:9", "ALTA"],
    ]);
    expect(recs[1].descricao).toBe("Revise o registro de produção e vendas do sabor Pistache: há 12 unidade(s) vendida(s) e nenhuma produção registrada.");
    expect(recs[2].descricao).toMatch(/^Cadastre a receita \(rendimento e matérias-primas\) de: Pistache, Coco\. .*não consumo zero\.$/);
  });

  it("sem divergência, receitas completas e MP sem problema: nenhuma recomendação; ritmo nunca vira recomendação", () => {
    const e = estoque(item(1, "Coco", 50, 40));
    const alertas = [...R.alertasEstoqueAcabado(e), ...R.alertasRitmo(ritmoDe([fluxo(1, "Coco", 50, 100)]))];
    expect(alertas.map((a) => a.tipo)).toContain("RITMO_PRODUCAO_ABAIXO_VENDAS");
    expect(R.gerarRecomendacoes({ estoque: e, alertas })).toEqual([]);
  });

  it("só avalia (e pode resolver) os tipos cujos dados estavam disponíveis; CONTAGEM_FISICA nunca se resolve sozinha", () => {
    const ok = { disponivel: true };
    expect(R.tiposAvaliados({ estoque: ok, materias: ok, receitas: ok })).toEqual(["REVISAR_REGISTROS_SABOR", "CADASTRAR_RECEITAS", "REVISAR_MOVIMENTACOES_MATERIA_PRIMA"]);
    expect(R.tiposAvaliados({ estoque: ok, materias: { disponivel: false }, receitas: { disponivel: false } })).toEqual(["REVISAR_REGISTROS_SABOR"]);
  });
});

// Etapa 3: o contrato preparado na Etapa 2 foi formalizado (janela em semanas completas, metodologia explícita).
describe("contrato DEMANDA_MEDIA (Estoque → Inteligência)", () => {
  const sabor = { saborId: 1, sabor: "Coco", qualidade: "SUFICIENTE", primeiraVenda: "2026-03-01", semanasObservadas: 4, unidadesVendidas: 120, diasComVenda: 12, mediaSemanal: 30, mediaDiaria: 4.29 };
  const resposta = {
    dataReferencia: "2026-09-30",
    metodologia: {
      tipo: "MEDIA_HISTORICA_RECENTE", janelaSemanas: 4, unidade: "UNIDADES_POR_SEMANA", semana: "DOMINGO_A_SABADO",
      periodo: { dataInicio: "2026-08-30", dataFim: "2026-09-26" }, semanaParcialExcluida: { dataInicio: "2026-09-27", dataFim: "2026-09-30" },
      criterioSuficiencia: "x", observacao: "y",
    },
    sabores: [sabor],
  };

  it("pedido: janela de 4 a 12 semanas, dia existente, sabores opcionais; resposta: método de média histórica, não previsão", () => {
    expect(DEMANDA_MEDIA).toMatchObject({ tipo: "DEMANDA_MEDIA", de: "estoque", para: "inteligencia" });
    expect(DEMANDA_MEDIA.pedido.safeParse({}).success).toBe(true);
    expect(DEMANDA_MEDIA.pedido.safeParse({ dataReferencia: "2026-09-30", janelaSemanas: 4, saborIds: [1, 2] }).success).toBe(true);
    for (const invalido of [{ janelaSemanas: 3 }, { janelaSemanas: 13 }, { janelaSemanas: 4.5 }, { dataReferencia: "2026-02-30" }, { dataReferencia: "30/09/2026" }, { saborIds: [] }, { extra: 1 }]) {
      expect(DEMANDA_MEDIA.pedido.safeParse(invalido).success, JSON.stringify(invalido)).toBe(false);
    }
    expect(DEMANDA_MEDIA.resposta.safeParse(resposta).success).toBe(true);
    expect(DEMANDA_MEDIA.resposta.safeParse({ ...resposta, metodologia: { ...resposta.metodologia, tipo: "PREVISAO" } }).success).toBe(false);
    // sem amostra suficiente não pode haver média (nem o contrário)
    expect(DEMANDA_MEDIA.resposta.safeParse({ ...resposta, sabores: [{ ...sabor, qualidade: "DADOS_INSUFICIENTES" }] }).success).toBe(false);
    expect(DEMANDA_MEDIA.resposta.safeParse({ ...resposta, sabores: [{ ...sabor, mediaSemanal: null, mediaDiaria: null }] }).success).toBe(false);
  });
});
