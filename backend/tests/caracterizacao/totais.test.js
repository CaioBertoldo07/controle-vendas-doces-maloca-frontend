// Caracterização: totais e relatórios (vendasController.obterTotais,
// relatorioMensal; producaoController.resumoProducao).
// Dataset pequeno e previsível. As datas são gravadas direto no banco com o
// relógio civil de Manaus nos componentes (política temporal da 0.5).
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./helpers/http.js";
import { autenticar, criarCliente, criarProducao, criarSabor, criarVenda } from "./helpers/fixtures.js";

let token, alfa, beta, coco, limao;

/*
 * Dataset (data-hora civil de Manaus):
 *   V1 Alfa 02/03 10:00  coco 10         R$ 55,00  paga
 *   V2 Alfa 02/03 15:00  limão 5         R$ 27,50  pendente
 *   V3 Beta 20/03 09:00  coco 12 limão 8 R$ 100,00 paga (desconto 10 já abatido do valor)
 *   V4 Alfa 31/03 23:30  coco 3          R$ 16,50  pendente
 *   V5 Beta 01/04 00:30  limão 7         R$ 38,50  pendente
 * Março: 38 un., R$ 199,00 (pago 155,00; pendente 44,00), 4 vendas.
 */
beforeEach(async () => {
  token = await autenticar();
  alfa = await criarCliente("Cliente Fictício Alfa");
  beta = await criarCliente("Cliente Fictício Beta");
  coco = await criarSabor({ nome: "Coco Fictício" });
  limao = await criarSabor({ nome: "Limão Fictício" });
  const v = (clienteId, iso, itens, valor, pago, desconto = 0) =>
    criarVenda({ clienteId, data: new Date(iso), itens, valor, pago, desconto });
  await v(alfa.id, "2026-03-02T10:00:00.000Z", [{ saborId: coco.id, quantidade: 10 }], 55, true);
  await v(alfa.id, "2026-03-02T15:00:00.000Z", [{ saborId: limao.id, quantidade: 5 }], 27.5, false);
  await v(beta.id, "2026-03-20T09:00:00.000Z", [{ saborId: coco.id, quantidade: 12 }, { saborId: limao.id, quantidade: 8 }], 100, true, 10);
  await v(alfa.id, "2026-03-31T23:30:00.000Z", [{ saborId: coco.id, quantidade: 3 }], 16.5, false);
  await v(beta.id, "2026-04-01T00:30:00.000Z", [{ saborId: limao.id, quantidade: 7 }], 38.5, false);
});

describe("GET /api/vendas/totais", () => {
  it("mês/ano: quantidades, valores (strings com 2 casas), pagas × pendentes, por cliente, por dia e média", async () => {
    const res = await api(token).get("/api/vendas/totais?mes=3&ano=2026");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalGeral: 38,
      valorTotal: "199.00",
      valorPago: "155.00",
      valorPendente: "44.00",
      totalVendas: 4,
      totalVendasPagas: 2,
      totalVendasPendentes: 2,
      porCliente: { "Cliente Fictício Alfa": 18, "Cliente Fictício Beta": 20 },
      porDia: { "02/03/2026": 15, "20/03/2026": 20, "31/03/2026": 3 },
      media: 9.5,
    });
  });

  it("valor usado é o líquido gravado em 'valor' (o desconto não é abatido de novo)", async () => {
    const res = await api(token).get(`/api/vendas/totais?mes=3&ano=2026&clienteId=${beta.id}`);
    expect(res.body).toMatchObject({ totalGeral: 20, valorTotal: "100.00", valorPago: "100.00" });
  });

  it("sem filtro: todo o histórico", async () => {
    const res = await api(token).get("/api/vendas/totais");
    expect(res.body).toMatchObject({ totalGeral: 45, valorTotal: "237.50", totalVendas: 5, valorPendente: "82.50" });
  });

  it("por cliente (sem mês): agrega só as vendas do cliente", async () => {
    const res = await api(token).get(`/api/vendas/totais?clienteId=${beta.id}`);
    expect(res.body).toMatchObject({ totalGeral: 27, totalVendas: 2, porCliente: { "Cliente Fictício Beta": 27 } });
  });

  it("período sem vendas → zeros e média 0", async () => {
    const res = await api(token).get("/api/vendas/totais?mes=1&ano=2026");
    expect(res.body).toMatchObject({ totalGeral: 0, valorTotal: "0.00", totalVendas: 0, media: 0, porCliente: {}, porDia: {} });
  });
});

describe("GET /api/vendas/relatorio-mensal", () => {
  it("12 meses do ano com totais, pago e pendente por mês", async () => {
    const res = await api(token).get("/api/vendas/relatorio-mensal?ano=2026");
    expect(res.status).toBe(200);
    expect(res.body.ano).toBe(2026);
    expect(res.body.meses).toHaveLength(12);
    expect(res.body.meses[2]).toEqual({
      mes: 3,
      nomeMes: "março",
      totalVendas: 4,
      totalQuantidade: 38,
      valorTotal: "199.00",
      valorPago: "155.00",
      valorPendente: "44.00",
    });
    expect(res.body.meses[3]).toMatchObject({ mes: 4, nomeMes: "abril", totalVendas: 1, totalQuantidade: 7, valorPendente: "38.50" });
    expect(res.body.meses[0]).toMatchObject({ totalVendas: 0, valorTotal: "0.00" });
  });

  it("outro ano → tudo zerado", async () => {
    const res = await api(token).get("/api/vendas/relatorio-mensal?ano=2025");
    expect(res.body.meses.every((m) => m.totalVendas === 0)).toBe(true);
  });
});

describe("GET /api/producao/resumo (mês/ano informados)", () => {
  it("produção do mês, vendido no mês, saldos do mês e acumulados", async () => {
    await criarProducao({ data: new Date("2026-03-01T08:00:00.000Z"), itens: [{ saborId: coco.id, quantidade: 30 }, { saborId: limao.id, quantidade: 10 }] });
    await criarProducao({ data: new Date("2026-04-02T08:00:00.000Z"), itens: [{ saborId: limao.id, quantidade: 20 }] });

    const res = await api(token).get("/api/producao/resumo?mes=3&ano=2026");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalMes: 40,
      totalVendidoMes: 38,
      saldoEstoque: 2,
      porSabor: { "Coco Fictício": 30, "Limão Fictício": 10 },
      vendidoPorSabor: { "Coco Fictício": 25, "Limão Fictício": 13 },
      saldoPorSabor: {
        "Coco Fictício": { produzido: 30, vendido: 25, saldo: 5 },
        "Limão Fictício": { produzido: 10, vendido: 13, saldo: -3 },
      },
      // Acumulado até o fim de março (a produção de abril não entra)
      saldoPorSaborCumulativo: {
        "Coco Fictício": { produzido: 30, vendido: 25, saldo: 5 },
        "Limão Fictício": { produzido: 10, vendido: 13, saldo: -3 },
      },
      saldoEstoqueCumulativo: 2,
    });
    expect(res.body.registros).toHaveLength(1);
    expect(res.body.meses).toHaveLength(12);
    expect(res.body.meses[2]).toMatchObject({ mes: 3, total: 40 });
    expect(res.body.meses[3]).toMatchObject({ mes: 4, total: 20 });
  });
});
