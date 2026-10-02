// Etapa 4 — regras puras do Agente de Vendas (sem banco, sem tools, sem LLM).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import * as R from "../../src/agents/agentes/vendas/regras.js";
import { EXPOSICAO_CLIENTES } from "../../src/agents/contratos/exposicaoClientes.js";

const REF = "2026-09-30";
const pendente = (vendaId, clienteId, dia, valor = 55, unidades = 10) => ({ vendaId, cliente: { id: clienteId, nome: `Cliente ${clienteId}` }, data: `${dia}T12:00:00.000-04:00`, unidades, valor });
const recebiveis = (...vendas) => ({ quantidade: vendas.length, valorPendente: vendas.reduce((s, v) => s + v.valor, 0), vendas, truncado: false });
const compras = (clienteId, ...dias) => dias.map((dia) => ({ clienteId, dia }));
const PROIBIDAS = /inadimpl|atrasad|vencid|vai comprar|deveria|abandon|previs/i;

describe("recebíveis: tempo em aberto, nunca atraso", () => {
  it("nenhuma pendência: zero, faixas vazias, sem recomendação", () => {
    const r = R.analisarRecebiveis(recebiveis(), REF);
    expect(r).toMatchObject({ disponivel: true, natureza: "PENDENTE_NO_REGISTRO", quantidade: 0, valorPendente: 0, maiorTempoEmAberto: null });
    expect(r.faixas.every((f) => f.quantidade === 0)).toBe(true);
    expect(R.gerarRecomendacoes({ recebiveis: r, recorrencia: { disponivel: false } })).toEqual([]);
  });

  it.each([
    [0, "0-7"], [7, "0-7"], [8, "8-15"], [15, "8-15"], [16, "16-30"], [30, "16-30"], [31, "31+"], [400, "31+"],
  ])("%s dias em aberto → faixa %s", (dias, faixa) => {
    expect(R.faixaTempoEmAberto(dias)).toBe(faixa);
  });

  it("várias: dias em aberto, faixas com quantidade e valor, total, mais antiga primeiro, só ids de cliente", () => {
    const r = R.analisarRecebiveis(recebiveis(pendente(1, 7, "2026-09-28", 30), pendente(2, 8, "2026-09-15", 82.5), pendente(3, 7, "2026-08-20", 110)), REF);
    expect(r).toMatchObject({ quantidade: 3, valorPendente: 222.5, clientes: 2, maiorTempoEmAberto: 41 });
    expect(r.vendas.map((v) => [v.vendaId, v.clienteId, v.dataVenda, v.diasEmAberto, v.faixa])).toEqual([
      [3, 7, "2026-08-20", 41, "31+"], [2, 8, "2026-09-15", 15, "8-15"], [1, 7, "2026-09-28", 2, "0-7"],
    ]);
    expect(r.faixas).toEqual([
      { faixa: "0-7", quantidade: 1, valor: 30 }, { faixa: "8-15", quantidade: 1, valor: 82.5 }, { faixa: "16-30", quantidade: 0, valor: 0 }, { faixa: "31+", quantidade: 1, valor: 110 },
    ]);
    expect(JSON.stringify(r)).not.toContain("Cliente 7"); // nome do cliente não sai
    const { observacao, ...qualidade } = r.historicoPagamento;
    expect(qualidade).toEqual({ confiavelDesde: "2026-08-14", classificacao: "OPERACIONAL" });
    expect(observacao).toMatch(/não é atraso nem inadimplência/); // a única menção é a negação explícita
    expect(JSON.stringify({ ...r, historicoPagamento: qualidade })).not.toMatch(/inadimpl|atrasad|vencid/i);
  });

  it("pendência anterior a 14/08 → COM_RESSALVA; venda posterior à referência fica fora; falha → indisponível", () => {
    expect(R.analisarRecebiveis(recebiveis(pendente(1, 1, "2026-08-13")), REF).historicoPagamento.classificacao).toBe("COM_RESSALVA");
    expect(R.analisarRecebiveis(recebiveis(pendente(1, 1, "2026-08-14")), REF).historicoPagamento.classificacao).toBe("OPERACIONAL");
    const r = R.analisarRecebiveis(recebiveis(pendente(1, 1, "2026-09-01"), pendente(2, 1, "2026-10-05")), REF);
    expect(r).toMatchObject({ quantidade: 1, posterioresAReferencia: 1 });
    expect(R.analisarRecebiveis(null, REF)).toEqual({ disponivel: false, motivo: "FALHA_CONSULTA_RECEBIVEIS" });
  });

  it("recomendação agregada: BAIXA; MEDIA com alguma pendência de 31+ dias; dados com ids e faixas", () => {
    const baixa = R.gerarRecomendacoes({ recebiveis: R.analisarRecebiveis(recebiveis(pendente(1, 1, "2026-09-01")), REF), recorrencia: { disponivel: false } });
    expect(baixa.map((x) => [x.tipo, x.chave, x.prioridade])).toEqual([["REVISAR_RECEBIVEIS_PENDENTES", "recebiveis-pendentes", "BAIXA"]]);
    const [media] = R.gerarRecomendacoes({ recebiveis: R.analisarRecebiveis(recebiveis(pendente(1, 1, "2026-08-30"), pendente(2, 2, "2026-09-25")), REF), recorrencia: { disponivel: false } });
    expect(media).toMatchObject({ prioridade: "MEDIA", dados: { quantidade: 2, valorPendente: 110, vendaIds: [1, 2] } });
    expect(media.descricao).toMatch(/não indica atraso/);
    expect(media.descricao.replace("não indica atraso", "")).not.toMatch(PROIBIDAS);
  });
});

describe("recorrência: fatos do próprio cliente, mediana, amostra mínima", () => {
  it("intervalos regulares: mediana, maior intervalo, dias desde a última, DENTRO_DO_PADRAO", () => {
    const [c] = R.recorrenciaClientes(compras(1, "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"), REF);
    expect(c).toEqual({
      clienteId: 1, compras: 4, primeiraCompra: "2026-08-31", ultimaCompra: "2026-09-21", intervalos: [7, 7, 7],
      medianaIntervalo: 7, maiorIntervalo: 7, diasDesdeUltimaCompra: 9, limiteForaDoPadrao: 14, classificacao: "DENTRO_DO_PADRAO",
    });
  });

  it.each([
    ["exatamente 2 × mediana (20) → dentro", "2026-09-30", "DENTRO_DO_PADRAO"],
    ["21 dias > 2 × 10 → fora", "2026-10-01", "FORA_DO_PADRAO_HISTORICO"],
    ["25 dias (cenário acadêmico) → fora", "2026-10-05", "FORA_DO_PADRAO_HISTORICO"],
  ])("fronteira: %s", (_, ref, classificacao) => {
    const [c] = R.recorrenciaClientes(compras(1, "2026-08-11", "2026-08-21", "2026-08-31", "2026-09-10"), ref);
    expect(c.classificacao).toBe(classificacao);
  });

  it("intervalos irregulares: a mediana resiste a uma pausa longa isolada", () => {
    const [c] = R.recorrenciaClientes(compras(1, "2026-06-01", "2026-06-08", "2026-08-07", "2026-08-14", "2026-08-21"), "2026-09-05");
    expect(c).toMatchObject({ intervalos: [7, 60, 7, 7], medianaIntervalo: 7, maiorIntervalo: 60, diasDesdeUltimaCompra: 15, classificacao: "FORA_DO_PADRAO_HISTORICO" });
  });

  it("amostra mínima: 2 e 3 compras → DADOS_INSUFICIENTES (sem limite); 1 compra sem intervalo", () => {
    const r = R.recorrenciaClientes([...compras(1, "2026-09-01", "2026-09-10"), ...compras(2, "2026-09-01", "2026-09-05", "2026-09-09"), ...compras(3, "2026-09-20")], REF);
    expect(r.map((c) => [c.clienteId, c.compras, c.classificacao, c.limiteForaDoPadrao, c.medianaIntervalo])).toEqual([
      [1, 2, "DADOS_INSUFICIENTES", null, 9], [2, 3, "DADOS_INSUFICIENTES", null, 4], [3, 1, "DADOS_INSUFICIENTES", null, null],
    ]);
    expect(R.PARAMETROS).toMatchObject({ MIN_COMPRAS_RECORRENCIA: 4, MULTIPLICADOR_FORA_DO_PADRAO: 2 });
  });

  it("mesmo dia conta uma vez; compras depois da referência ficam fora", () => {
    const [c] = R.recorrenciaClientes(compras(1, "2026-09-01", "2026-09-01", "2026-09-08", "2026-09-08", "2026-09-15", "2026-09-22", "2026-10-10"), REF);
    expect(c).toMatchObject({ compras: 4, intervalos: [7, 7, 7], ultimaCompra: "2026-09-22" });
  });

  it("resumo: elegíveis, dentro/fora, com recompra, mediana das medianas; textos sem linguagem preditiva", () => {
    const clientes = R.recorrenciaClientes([
      ...compras(1, "2026-08-06", "2026-08-16", "2026-08-26", "2026-09-05"), // fora
      ...compras(2, "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"), // dentro
      ...compras(3, "2026-09-08", "2026-09-22"),
    ], REF);
    const resumo = R.resumirRecorrencia(clientes);
    expect(resumo).toEqual({ clientes: 3, elegiveis: 2, dadosInsuficientes: 1, dentroDoPadrao: 1, foraDoPadraoHistorico: 1, comRecompra: 3, medianaDasMedianas: 8.5, medianaGeralIntervalos: 10 });
    const [rec] = R.gerarRecomendacoes({ recebiveis: { disponivel: false }, recorrencia: { disponivel: true, clientes } });
    expect(rec).toMatchObject({ tipo: "REVISAR_CLIENTES_FORA_PADRAO", chave: "clientes-fora-padrao", prioridade: "BAIXA", dados: { clientes: [{ clienteId: 1, diasDesdeUltimaCompra: 25, medianaIntervalo: 10 }] } });
    expect(rec.descricao).toMatch(/não uma previsão/);
    expect(rec.descricao.replace("não uma previsão", "")).not.toMatch(PROIBIDAS);
    expect(R.mediana([])).toBeNull();
    expect(R.mediana([3, 1, 2, 10])).toBe(2.5);
  });
});

describe("mix de sabores (insight, não alerta)", () => {
  const PERIODO = { dataInicio: "2026-08-30", dataFim: "2026-09-26" };
  const sabores = [{ saborId: 1, sabor: "Tradicional" }, { saborId: 2, sabor: "Doce de Leite" }, { saborId: 3, sabor: "Maracujá" }];
  const linha = (dia, saborId, unidades) => ({ dia, saborId, unidades });

  it("ranking, participação somando 100%, concentração; dias fora da janela ignorados", () => {
    const m = R.mixSabores([linha("2026-09-01", 1, 335), linha("2026-09-02", 2, 311), linha("2026-09-03", 3, 133), linha("2026-09-10", 1, 0), linha("2026-09-28", 3, 999)], sabores, PERIODO);
    expect(m.sabores.map((s) => [s.posicao, s.sabor, s.unidades, s.participacao])).toEqual([[1, "Tradicional", 335, 43], [2, "Doce de Leite", 311, 39.9], [3, "Maracujá", 133, 17.1]]);
    expect(m.sabores.reduce((t, s) => t + s.participacao, 0)).toBeCloseTo(100, 0);
    expect(m.concentracao).toMatchObject({ maiorParticipacao: 43, duasMaiores: 82.9, indiceHerfindahl: 0.373 });
    expect(m.concentracao.observacao).toMatch(/não é problema/);
    expect(R.gerarInsights({ mix: m })[0].texto).toBe("Tradicional representa 43% das unidades da janela; com Doce de Leite (39,9%), as duas maiores somam 82,9%.");
  });

  it("período vazio: sem participação, sem concentração, sem insight de mix", () => {
    const m = R.mixSabores([], sabores, PERIODO);
    expect(m).toMatchObject({ unidades: 0, vazio: true, sabores: [], concentracao: null });
    expect(R.gerarInsights({ mix: m })).toEqual([]);
  });
});

describe("exposição de clientes por sabor (só agregados)", () => {
  const recorrencia = R.recorrenciaClientes([
    ...compras(1, "2026-08-06", "2026-08-16", "2026-08-26", "2026-09-05"),
    ...compras(3, "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"),
    ...compras(2, "2026-09-08", "2026-09-22"),
    ...compras(4, "2026-09-15"),
  ], REF);
  const linhas = [
    { clienteId: 1, saborId: 1, unidades: 10 }, { clienteId: 3, saborId: 1, unidades: 80 },
    { clienteId: 2, saborId: 2, unidades: 30 }, { clienteId: 4, saborId: 2, unidades: 10 }, { clienteId: 3, saborId: 2, unidades: 5 },
  ];

  it("recorrentes × não recorrentes; sabor sem venda; vários sabores; cumpre o contrato", () => {
    const e = R.exposicaoPorSabor({ linhas, recorrencia, sabores: [{ saborId: 1, sabor: "Tradicional" }, { saborId: 2, sabor: "Maracujá" }, { saborId: 9, sabor: "Pistache" }] });
    expect(e.map((s) => [s.sabor, s.qualidade, s.unidadesRecentes, s.clientesComCompraRecente, s.clientesRecorrentes, s.clientesSemHistoricoSuficiente, s.unidadesDeClientesRecorrentes, s.participacaoClientesRecorrentes])).toEqual([
      ["Tradicional", "COM_VENDAS_NA_JANELA", 90, 2, 2, 0, 90, 100],
      ["Maracujá", "COM_VENDAS_NA_JANELA", 45, 3, 1, 2, 5, 11.1],
      ["Pistache", "SEM_VENDAS_NA_JANELA", 0, 0, 0, 0, 0, null],
    ]);
    const resposta = {
      dataReferencia: REF,
      metodologia: { tipo: "EXPOSICAO_HISTORICA_RECENTE", janelaSemanas: 4, semana: "DOMINGO_A_SABADO", periodo: { dataInicio: "a", dataFim: "b" }, semanaParcialExcluida: { dataInicio: "c", dataFim: "d" }, criterioRecorrencia: "x", observacao: "y" },
      sabores: e,
    };
    expect(EXPOSICAO_CLIENTES.resposta.safeParse(resposta).success).toBe(true);
    expect(EXPOSICAO_CLIENTES.resposta.safeParse({ ...resposta, sabores: [{ ...e[0], clienteIds: [1, 3] }] }).success).toBe(false); // sem ids/nomes de clientes
  });

  it("contrato do pedido: saborIds obrigatório, janela 4–12, dia existente", () => {
    expect(EXPOSICAO_CLIENTES).toMatchObject({ tipo: "EXPOSICAO_CLIENTES_POR_SABOR", de: "estoque", para: "vendas" });
    expect(EXPOSICAO_CLIENTES.pedido.safeParse({ saborIds: [1] }).success).toBe(true);
    for (const invalido of [{}, { saborIds: [] }, { saborIds: [1], janelaSemanas: 3 }, { saborIds: [1], dataReferencia: "2026-02-30" }, { saborIds: [1], clienteId: 2 }]) {
      expect(EXPOSICAO_CLIENTES.pedido.safeParse(invalido).success, JSON.stringify(invalido)).toBe(false);
    }
  });
});

describe("independência do fuso do processo", () => {
  it("recebíveis, recorrência e mix dão o mesmo resultado com TZ=UTC, America/Manaus e Asia/Tokyo", () => {
    const url = pathToFileURL(path.resolve("src/agents/agentes/vendas/regras.js")).href;
    const codigo = `
      const R = await import(${JSON.stringify(url)});
      const rec = { quantidade: 1, valorPendente: 10, truncado: false, vendas: [{ vendaId: 1, cliente: { id: 1 }, data: "2026-02-28T23:30:00.000-04:00", unidades: 1, valor: 10 }] };
      const compras = ["2026-02-28", "2026-03-01", "2026-03-08", "2026-03-31"].map((dia) => ({ clienteId: 1, dia }));
      console.log(JSON.stringify([R.analisarRecebiveis(rec, "2026-03-31"), R.recorrenciaClientes(compras, "2026-04-30"),
        R.mixSabores([{ dia: "2026-03-01", saborId: 1, unidades: 3 }], [{ saborId: 1, sabor: "x" }], { dataInicio: "2026-03-01", dataFim: "2026-03-28" })]));`;
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
