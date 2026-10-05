// Etapa 6 — verificação factual por afirmações: catálogo de fatos + validação
// determinística de cada afirmação. Puras (sem banco, sem LLM). Os "ataques"
// são as alucinações plausíveis que a trava da Etapa 5 (número existe em algum
// fato?) deixava passar.
import { describe, expect, it } from "vitest";
import { catalogoParaLLM, lerSintese, montarCatalogo, ressalvasPendentes, validarAfirmacao, verificarAfirmacoes } from "../../src/agents/conversa/afirmacoes.js";

const RESULTADOS = [
  {
    intencao: "CONSULTAR_ESTOQUE", agente: "estoque", status: "OK",
    fatos: {
      fonte: "AGENTE_ESTOQUE", dataReferencia: "2026-09-30",
      qualidade: { estoqueAcabado: "NAO_RECONCILIADO" },
      estoqueAcabado: { natureza: "SALDO_CONTABIL_HISTORICO", sabores: [{ sabor: "Tradicional", saldoContabilHistorico: -20, situacao: "NEGATIVO" }, { sabor: "Maracujá", saldoContabilHistorico: 15, situacao: "POSITIVO" }] },
      ritmo: { janela: { dataInicio: "2026-08-30", dataFim: "2026-09-26", semanas: 4 }, sabores: [{ sabor: "Tradicional", produzido: 40, vendido: 90, demandaMediaSemanal: 22.5, producaoMediaSemanal: 10 }] },
      mrp: { disponivel: false, estado: "INDISPONIVEL_POR_DADOS" },
    },
    textos: ["A divergência histórica de Tradicional (-20 un.) equivale a 0,9 semana(s) da demanda média recente."],
    limitacoes: ["Saldo calculado como produção − vendas. Não representa o estoque físico."],
  },
  {
    intencao: "CONSULTAR_TENDENCIAS", agente: "inteligencia", status: "OK",
    fatos: { fonte: "AGENTE_INTELIGENCIA", sabores: [{ sabor: "Tradicional", unidadesRecentes: 90, participacao: 66.7, variacaoPercentual: 25, tendencia: "ALTA" }, { sabor: "Maracujá", unidadesRecentes: 45, participacao: 33.3, variacaoPercentual: -10, tendencia: "QUEDA" }] },
    textos: [], limitacoes: [],
  },
  {
    intencao: "CONSULTAR_RECEBIVEIS", agente: "vendas", status: "OK",
    fatos: { fonte: "AGENTE_VENDAS", recebiveis: { quantidade: 3, valorPendente: 247.5, clientes: 3, maiorTempoEmAberto: 55, qualidadePagamento: "COM_RESSALVA" }, indicadores: { faturamentoRegistrado: 742.5, unidades: 135 } },
    textos: ["3 venda(s) pendente(s) no registro (R$ 247,50); a mais antiga está há 55 dia(s) em aberto."], limitacoes: [],
  },
];

const cat = montarCatalogo(RESULTADOS);
/** id do fato pela entidade + fim da métrica (ou pelo começo do texto). */
const id = (entidade, metrica) => cat.fatos.find((f) => f.entidade === entidade && (f.metrica.endsWith(metrica) || (f.unidade === "texto" && f.valor.startsWith(metrica)))).id;
const valida = (texto, factIds, opcoes) => validarAfirmacao({ texto, factIds }, cat, opcoes);

describe("catálogo de fatos", () => {
  it("cada fato tem id, entidade, métrica, valor e unidade; críticos marcados; nada de fonte interna", () => {
    expect(cat.fatos.find((f) => f.metrica === "ritmo.sabores.demandaMediaSemanal")).toMatchObject({ entidade: "Tradicional", valor: 22.5, unidade: "un" });
    expect(cat.fatos.find((f) => f.metrica === "sabores.participacao" && f.entidade === "Maracujá")).toMatchObject({ valor: 33.3, unidade: "%" });
    expect(cat.fatos.find((f) => f.metrica === "recebiveis.valorPendente")).toMatchObject({ entidade: null, valor: 247.5, unidade: "R$" });
    expect(cat.fatos.find((f) => f.metrica === "recebiveis.maiorTempoEmAberto")).toMatchObject({ unidade: "dias" });
    expect(cat.fatos.filter((f) => f.critico).map((f) => f.critico)).toEqual(["ESTOQUE_NAO_RECONCILIADO", "ESTOQUE_NAO_RECONCILIADO", "MRP_INDISPONIVEL", "PAGAMENTOS_COM_RESSALVA"]);
    const llm = catalogoParaLLM(cat);
    expect(llm.split("\n")[0]).toBe("F1 | CONSULTAR_ESTOQUE | geral | dataReferencia | 2026-09-30 | data");
    expect(llm).not.toMatch(/AGENTE_ESTOQUE|fonte/);
  });

  it("resultado que falhou vira fato de indisponibilidade; listas enormes são cortadas sem perder os críticos", () => {
    const grande = montarCatalogo([{ intencao: "CONSULTAR_ESTOQUE", status: "OK", fatos: { estoqueAcabado: { sabores: Array.from({ length: 200 }, (_, i) => ({ sabor: `S${i}`, saldoContabilHistorico: i })), natureza: "SALDO_CONTABIL_HISTORICO" } } }, { intencao: "CONSULTAR_VENDAS", status: "FALHA" }], 50);
    expect(grande.fatos.filter((f) => f.intencao === "CONSULTAR_ESTOQUE")).toHaveLength(50);
    expect(grande.omitidos).toEqual({ CONSULTAR_ESTOQUE: 151 });
    expect(grande.fatos.some((f) => f.critico === "ESTOQUE_NAO_RECONCILIADO")).toBe(true);
    expect(grande.fatos.at(-1)).toMatchObject({ intencao: "CONSULTAR_VENDAS", metrica: "disponibilidade", valor: "AGENTE_NAO_RESPONDEU" });
  });
});

describe("afirmações válidas passam", () => {
  it("números do sabor certo, na unidade e natureza certas (com arredondamento e formato brasileiro)", () => {
    expect(valida("Tradicional teve demanda média de 22,5 unidades por semana e produção média de 10 por semana.", [id("Tradicional", "demandaMediaSemanal"), id("Tradicional", "producaoMediaSemanal")])).toEqual({ valida: true });
    expect(valida("Tradicional representa 66,7% das unidades e cresceu 25%; Maracujá caiu 10%.", [id("Tradicional", "sabores.participacao"), id("Tradicional", "variacaoPercentual"), id("Maracujá", "variacaoPercentual")])).toEqual({ valida: true });
    expect(valida("Entre 30/08 e 26/09 o Tradicional vendeu 90 unidades (cerca de 67% do total).", [id("Tradicional", "ritmo.sabores.vendido"), id("Tradicional", "sabores.participacao")])).toEqual({ valida: true });
    expect(valida("Há 3 vendas pendentes, somando R$ 247,50; a mais antiga está há 55 dias em aberto, o que não é atraso.", [id(null, "recebiveis.quantidade"), id(null, "recebiveis.valorPendente"), id(null, "recebiveis.maiorTempoEmAberto")])).toEqual({ valida: true });
    expect(valida("O saldo contábil histórico de Tradicional é de -20 unidades e não foi reconciliado por contagem.", [id("Tradicional", "saldoContabilHistorico")])).toEqual({ valida: true });
    expect(valida("A divergência de Tradicional equivale a 0,9 semana de demanda.", [id(null, "A divergência histórica")])).toEqual({ valida: true });
    expect(valida("Você pediu 8 semanas; Tradicional vendeu 90 unidades.", [id("Tradicional", "ritmo.sabores.vendido")], { extras: ["E nas últimas 8 semanas?"] })).toEqual({ valida: true });
  });
});

describe("ataques: alucinações plausíveis são descartadas", () => {
  it("número trocado entre sabores (citando os dois fatos)", () => {
    const ids = [id("Tradicional", "unidadesRecentes"), id("Maracujá", "unidadesRecentes")];
    expect(valida("Tradicional vendeu 45 unidades e Maracujá 90.", ids)).toEqual({ valida: false, motivo: "NUMERO_ENTIDADE", detalhe: "45" });
    expect(valida("Tradicional vendeu 90 unidades e Maracujá 45.", ids)).toEqual({ valida: true });
  });

  it("percentual trocado: participação apresentada como crescimento (e vice-versa), ou de outro sabor", () => {
    const ids = [id("Tradicional", "sabores.participacao"), id("Tradicional", "variacaoPercentual"), id("Maracujá", "sabores.participacao")];
    expect(valida("Tradicional cresceu 66,7% no período.", ids)).toEqual({ valida: false, motivo: "NUMERO_NATUREZA", detalhe: "66,7" });
    expect(valida("Tradicional representa 25% das unidades.", ids)).toEqual({ valida: false, motivo: "NUMERO_NATUREZA", detalhe: "25" });
    expect(valida("Tradicional representa 33,3% das unidades.", ids)).toEqual({ valida: false, motivo: "NUMERO_ENTIDADE", detalhe: "33,3" });
  });

  it("saldo contábil histórico apresentado como estoque físico", () => {
    const saldo = [id("Tradicional", "saldoContabilHistorico")];
    expect(valida("O estoque físico de Tradicional é de -20 unidades.", saldo)).toMatchObject({ valida: false, motivo: "SEMANTICA_ESTOQUE_FISICO" });
    expect(valida("Tradicional tem -20 unidades em estoque.", saldo)).toMatchObject({ valida: false, motivo: "SEMANTICA_SALDO_COMO_ESTOQUE" });
    expect(valida("O estoque real de Maracujá é 15.", [id("Maracujá", "saldoContabilHistorico")])).toMatchObject({ valida: false, motivo: "SEMANTICA_ESTOQUE_FISICO" });
    expect(valida("O saldo contábil de Tradicional, -20, não é estoque físico.", saldo)).toEqual({ valida: true });
  });

  it("média histórica apresentada como previsão", () => {
    const media = [id("Tradicional", "demandaMediaSemanal")];
    expect(valida("Tradicional deve vender 22,5 unidades na próxima semana.", media)).toMatchObject({ valida: false, motivo: "SEMANTICA_PREVISAO" });
    expect(valida("A previsão para Tradicional é de 22,5 unidades por semana.", media)).toMatchObject({ valida: false, motivo: "SEMANTICA_PREVISAO" });
    expect(valida("A média de Tradicional, 22,5 unidades por semana, é histórica e não é previsão.", media)).toEqual({ valida: true });
    // média apresentada como total vendido
    expect(valida("Tradicional teve média de 90 unidades por semana.", [...media, id("Tradicional", "ritmo.sabores.vendido")])).toEqual({ valida: false, motivo: "NUMERO_NATUREZA", detalhe: "90" });
  });

  it("venda pendente apresentada como inadimplência/atraso", () => {
    const pend = [id(null, "recebiveis.quantidade"), id(null, "recebiveis.clientes")];
    expect(valida("Há 3 clientes inadimplentes.", pend)).toMatchObject({ valida: false, motivo: "SEMANTICA_INADIMPLENCIA" });
    expect(valida("3 vendas estão atrasadas.", pend)).toMatchObject({ valida: false, motivo: "SEMANTICA_INADIMPLENCIA" });
    expect(valida("Há 3 vendas pendentes; tempo em aberto não é atraso.", pend)).toEqual({ valida: true });
  });

  it("entidade, referência, valor, unidade e data sem lastro", () => {
    expect(valida("Maracujá vendeu 45 unidades.", [id("Tradicional", "unidadesRecentes")])).toEqual({ valida: false, motivo: "ENTIDADE_NAO_REFERENCIADA", detalhe: "Maracujá" });
    expect(valida("Tradicional vendeu 90 unidades.", ["F999"])).toEqual({ valida: false, motivo: "REFERENCIA_INEXISTENTE", detalhe: "F999" });
    expect(valida("As vendas vão bem.", [])).toEqual({ valida: false, motivo: "SEM_REFERENCIA" });
    expect(valida("Tradicional vendeu 90 unidades.", [id("Tradicional", "sabores.participacao")])).toEqual({ valida: false, motivo: "NUMERO_VALOR", detalhe: "90" });
    expect(valida("O faturamento foi de R$ 135.", [id(null, "indicadores.unidades"), id(null, "faturamentoRegistrado")])).toEqual({ valida: false, motivo: "NUMERO_UNIDADE", detalhe: "135" });
    expect(valida("Tradicional vendeu 90 unidades desde 01/07.", [id("Tradicional", "ritmo.sabores.vendido")])).toEqual({ valida: false, motivo: "DATA_NAO_SUPORTADA", detalhe: "01/07" });
  });

  it("período com unidade errada (achado da validação com o provider real): \"4 meses\" para uma janela de 4 semanas", () => {
    const vendido = [id("Tradicional", "ritmo.sabores.vendido")];
    expect(valida("Nos 4 meses de 30/08 a 26/09, Tradicional vendeu 90 unidades.", vendido)).toEqual({ valida: false, motivo: "NUMERO_UNIDADE", detalhe: "4" });
    expect(valida("Em 3 anos, Tradicional vendeu 90 unidades.", vendido)).toEqual({ valida: false, motivo: "NUMERO_VALOR", detalhe: "3" });
    // o período certo continua passando, mesmo sem citar o fato da janela (é o período da própria consulta)
    expect(valida("Nas 4 semanas de 30/08 a 26/09, Tradicional vendeu 90 unidades.", vendido)).toEqual({ valida: true });
    expect(valida("Tradicional vendeu 90 unidades em 3 semanas.", vendido)).toEqual({ valida: false, motivo: "NUMERO_VALOR", detalhe: "3" });
    expect(valida("Tradicional teve 2 clientes recorrentes.", vendido)).toEqual({ valida: true }); // contagem pequena sem período: como antes
  });

  it("percentual com base errada (achado da validação com o provider real): participação de UNIDADES dita \"de compradores\"", () => {
    const part = [id("Maracujá", "sabores.participacao")];
    expect(valida("Maracujá tem 33,3% de seus compradores.", part)).toEqual({ valida: false, motivo: "NUMERO_BASE", detalhe: "33,3" });
    expect(valida("Maracujá representa 33,3% dos clientes.", part)).toEqual({ valida: false, motivo: "NUMERO_BASE", detalhe: "33,3" });
    expect(valida("Maracujá representa 33,3% das unidades.", part)).toEqual({ valida: true });
    expect(cat.porId.get(part[0]).base).toBe("UNIDADES"); // a base vem do fato (tabela por métrica)
  });

  it("a base é a do FATO, não uma proibição global: percentual com base CLIENTES aceita \"dos clientes\"; base desconhecida não sustenta base declarada", () => {
    const fato = (id, metrica, base) => ({ id, intencao: "TESTE", entidade: "Maracujá", metrica, valor: 40, unidade: "%", ...(base !== undefined && { base }) });
    const extra = [fato("FX1", "teste.participacaoDeClientes", "CLIENTES"), fato("FX2", "teste.participacaoSemBase", null)];
    const catalogo = { ...cat, fatos: [...cat.fatos, ...extra], porId: new Map([...cat.porId, ...extra.map((f) => [f.id, f])]) };
    const v = (texto, ids) => validarAfirmacao({ texto, factIds: ids }, catalogo);
    expect(v("Maracujá tem 40% dos clientes.", ["FX1"])).toEqual({ valida: true });
    expect(v("Maracujá tem 40% das unidades.", ["FX1"])).toEqual({ valida: false, motivo: "NUMERO_BASE", detalhe: "40" });
    expect(v("Maracujá tem 40% dos clientes.", ["FX2"])).toEqual({ valida: false, motivo: "NUMERO_BASE", detalhe: "40" });
    expect(v("Maracujá tem 40%.", ["FX2"])).toEqual({ valida: true }); // sem base declarada: nada a conferir
  });

  it("referência a outra afirmação (achado da validação com o provider real): \"no mesmo período\" / \"esse saldo\" sem antecedente", () => {
    const prod = [id("Tradicional", "producaoMediaSemanal")];
    expect(valida("A produção de Tradicional no mesmo período foi de 10 unidades por semana.", prod)).toEqual({ valida: false, motivo: "SEMANTICA_REFERENCIA_EXTERNA", detalhe: "mesmo periodo" });
    expect(valida("Esse saldo contábil de Tradicional está negativo.", [id("Tradicional", "saldoContabilHistorico")])).toEqual({ valida: false, motivo: "SEMANTICA_REFERENCIA_EXTERNA", detalhe: "esse saldo" });
    // com o antecedente na própria afirmação, passa
    expect(valida("Entre 30/08 e 26/09, Tradicional teve produção média de 10 unidades por semana no mesmo período.", prod)).toEqual({ valida: true });
    expect(valida("O saldo contábil de Tradicional é -20 unidades; esse saldo não foi reconciliado.", [id("Tradicional", "saldoContabilHistorico")])).toEqual({ valida: true });
  });

  it("MRP indisponível, margem/lucro e custo por sabor", () => {
    const qualquer = [id("Tradicional", "ritmo.sabores.vendido")];
    expect(valida("Dá para produzir mais Tradicional com os insumos atuais.", qualquer)).toMatchObject({ valida: false, motivo: "SEMANTICA_MRP_DISPONIVEL" });
    expect(valida("A margem do Tradicional é a melhor.", qualquer)).toMatchObject({ valida: false, motivo: "SEMANTICA_MARGEM_LUCRO" });
    expect(valida("O custo do Tradicional subiu.", qualquer)).toMatchObject({ valida: false, motivo: "SEMANTICA_CUSTO_POR_SABOR" });
  });

  it("separa aceitas e descartadas, com o motivo", () => {
    const r = verificarAfirmacoes([
      { texto: "Tradicional vendeu 90 unidades.", factIds: [id("Tradicional", "ritmo.sabores.vendido")] },
      { texto: "Há 3 clientes inadimplentes.", factIds: [id(null, "recebiveis.clientes")] },
    ], cat);
    expect(r.aceitas.map((a) => a.texto)).toEqual(["Tradicional vendeu 90 unidades."]);
    expect(r.descartadas).toEqual([expect.objectContaining({ motivo: "SEMANTICA_INADIMPLENCIA", texto: "Há 3 clientes inadimplentes." })]);
  });
});

describe("fatos críticos e contrato da síntese", () => {
  it("ressalva determinística para cada fato crítico que nenhuma afirmação aceita citou", () => {
    expect(ressalvasPendentes(cat, []).map((r) => r.codigo)).toEqual(["ESTOQUE_NAO_RECONCILIADO", "MRP_INDISPONIVEL", "PAGAMENTOS_COM_RESSALVA"]);
    const citouNatureza = [{ texto: "x", factIds: [id(null, "estoqueAcabado.natureza")] }];
    expect(ressalvasPendentes(cat, citouNatureza).map((r) => r.codigo)).toEqual(["MRP_INDISPONIVEL", "PAGAMENTOS_COM_RESSALVA"]);
    expect(ressalvasPendentes(cat, [])[0].texto).toMatch(/não é o estoque físico/);
  });

  it("lerSintese: JSON inválido, fora do contrato e excesso de afirmações", () => {
    expect(lerSintese("não é json")).toEqual({ valida: false, erro: "JSON_INVALIDO" });
    expect(lerSintese(JSON.stringify({ texto: "livre" }))).toEqual({ valida: false, erro: "FORA_DO_CONTRATO" });
    expect(lerSintese(JSON.stringify({ afirmacoes: [{ texto: "a", factIds: ["F1"], extra: 1 }] }))).toEqual({ valida: false, erro: "FORA_DO_CONTRATO" });
    const oito = lerSintese(JSON.stringify({ afirmacoes: Array.from({ length: 8 }, (_, i) => ({ texto: `a${i}`, factIds: ["F1"] })) }));
    expect(oito).toMatchObject({ valida: true, excedentes: 2 });
    expect(oito.afirmacoes).toHaveLength(6);
  });
});
