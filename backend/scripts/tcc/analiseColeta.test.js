// Testes da análise da coleta. Executar com: npm run test:guardas
import { test } from "node:test";
import assert from "node:assert/strict";
import { analisar, estatisticas, normalizarNome, simularCorte } from "./analiseColeta.js";

const ev = (pares) => new Map(pares.map(([d, p, v]) => [d, { p, v }]));

test("simularCorte: saldo e inventário mínimo sem corte", () => {
  // vende 10 antes de produzir 30, depois vende 15
  const e = ev([["2026-01-10", 0, 10], ["2026-03-05", 30, 0], ["2026-03-06", 0, 15]]);
  assert.deepEqual(simularCorte(e, null), { produzido: 30, vendido: 25, saldo: 5, inventario_minimo: 10 });
});

test("simularCorte: data de corte descarta movimentos anteriores", () => {
  const e = ev([["2026-01-10", 0, 10], ["2026-03-05", 30, 0], ["2026-03-06", 0, 15]]);
  assert.deepEqual(simularCorte(e, "2026-03-03"), { produzido: 30, vendido: 15, saldo: 15, inventario_minimo: 0 });
});

test("simularCorte: produção do dia conta antes da venda do dia", () => {
  const e = ev([["2026-03-05", 10, 10]]);
  assert.equal(simularCorte(e, null).inventario_minimo, 0);
});

test("estatisticas: mediana, quartis e coeficiente de variação", () => {
  const s = estatisticas([1, 2, 3, 4, 100]);
  assert.equal(s.n, 5);
  assert.equal(s.mediana, 3);
  assert.equal(s.p25, 2);
  assert.equal(s.max, 100);
  assert.ok(s.coef_variacao > 1);
  assert.deepEqual(estatisticas([]), { n: 0 });
});

test("normalizarNome segue a regra do resolverNomes", () => {
  assert.equal(normalizarNome("Doce de Leite"), "docedeleite");
  assert.equal(normalizarNome("Frutaria Shangrilá!"), "frutariashangrila");
});

test("analisar: agrega sem expor nomes de clientes", () => {
  const r = {
    vendas_resumo: [{ total_vendas: 3, primeira_venda: "2026-01-01T00:00:00.000Z", ultima_venda: "2026-03-10T00:00:00.000Z", unidades_vendidas: 30, dias_com_venda: 3 }],
    vendas_valores: [
      { valor: 10, quantidade: 5, data: "2026-01-01T10:00:00.000Z" },
      { valor: 20, quantidade: 10, data: "2026-03-05T10:00:00.000Z" },
      { valor: 30, quantidade: 15, data: "2026-03-10T10:00:00.000Z" },
    ],
    clientes_resumo: [{ clientes: 3, clientes_com_venda: 2, clientes_ativos_90_dias: 2 }],
    clientes_nomes: [
      { id: 1, nome: "Restaurante Coqueiro Verde P10" },
      { id: 2, nome: "Restaurante Coqueiro Verde PCA14" },
      { id: 3, nome: "Coqueiro Verde" },
    ],
    vendas_por_cliente: [
      { cliente: 1, vendas: 2, unidades: 15, meses_com_compra: 2, primeira: "2026-01-01", ultima: "2026-03-05" },
      { cliente: 2, vendas: 1, unidades: 15, meses_com_compra: 1, primeira: "2026-03-10", ultima: "2026-03-10" },
    ],
    vendas_diarias: [
      { dia: "2026-01-01T00:00:00.000Z", vendas: 1, unidades: 5 },
      { dia: "2026-03-05T00:00:00.000Z", vendas: 1, unidades: 10 },
    ],
    sabores_produzido_vendido: [{ id: 1, nome: "Tradicional", ativo: 1, produzido: 30, vendido: 30, primeira_producao: "2026-03-04T00:00:00.000Z", itens_receita: 0 }],
    vendas_sabor_dia: [
      { sabor_id: 1, dia: "2026-01-01T00:00:00.000Z", unidades: 5 },
      { sabor_id: 1, dia: "2026-03-05T00:00:00.000Z", unidades: 25 },
    ],
    producao_sabor_dia: [{ sabor_id: 1, dia: "2026-03-04T00:00:00.000Z", unidades: 30 }],
  };
  const a = analisar(r);
  const json = JSON.stringify(a);
  assert.ok(!json.includes("Coqueiro"), "nome de cliente vazou na análise");
  assert.equal(a.vendas.valor_por_venda.mediana, 20);
  assert.equal(a.vendas.vendas_antes_de_03_03, 1);
  assert.equal(a.clientes.clientes_sem_venda, 1);
  assert.equal(a.clientes.ambiguidade_resolucao_textual.pares_em_que_um_nome_contem_o_outro, 2);
  const corte = a.estoque_acabado.simulacoes_de_corte.find((s) => s.corte === "2026-03-03");
  assert.equal(corte.sabores_com_saldo_negativo, 0);
  assert.equal(a.estoque_acabado.por_sabor[0].vendido_antes_de_03_03, 5);
  assert.equal(a.estoque_acabado.por_sabor[0].saldo_desde_03_03, 5);
});

test("datas implausíveis (ex.: ano 0206) não distorcem períodos e séries", () => {
  const a = analisar({
    vendas_resumo: [{ total_vendas: 2, primeira_venda: "0206-03-05T00:00:00.000Z", ultima_venda: "2026-03-10T00:00:00.000Z" }],
    vendas_valores: [
      { valor: 10, quantidade: 20, data: "0206-03-05T00:00:00.000Z" },
      { valor: 10, quantidade: 5, data: "2026-03-10T00:00:00.000Z" },
    ],
    vendas_diarias: [
      { dia: "0206-03-05T00:00:00.000Z", vendas: 1, unidades: 20 },
      { dia: "2026-03-10T00:00:00.000Z", vendas: 1, unidades: 5 },
    ],
    producao_sabor_dia: [
      { sabor_id: 1, dia: "0202-09-23T00:00:00.000Z", unidades: 100 },
      { sabor_id: 1, dia: "2026-03-03T00:00:00.000Z", unidades: 10 },
    ],
  });
  assert.equal(a.vendas.vendas_com_data_implausivel, 1);
  assert.equal(a.vendas.primeira_venda, "2026-03-10");
  assert.equal(a.series_de_vendas.meses_no_periodo, 1);
  assert.equal(a.producao.primeira, "2026-03-03");
  assert.equal(a.producao.unidades_com_data_implausivel, 100);
  assert.equal(a.estoque_acabado.primeira_producao_registrada, "2026-03-03");
});
