// Etapa 0.5: política temporal pela API. O fuso do negócio é America/Manaus,
// e os resultados têm de ser os mesmos com o servidor em TZ=UTC ou
// TZ=America/Manaus (a suíte roda nos dois: MALOCA_TZ_TESTE).
// Datas enviadas sem fuso ("2026-03-31T23:30:00") são o relógio civil de
// Manaus, que é o formato do frontend. Ver docs/tcc/etapa-0-5-politica-temporal.md.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./helpers/db.js";
import { api } from "./helpers/http.js";
import { autenticar, criarCliente, criarSabor } from "./helpers/fixtures.js";

let token, cliente, sabor;
beforeEach(async () => {
  token = await autenticar();
  cliente = await criarCliente("Mercearia Fictícia Aurora");
  sabor = await criarSabor({ nome: "Coco Fictício" });
});

const vender = (data, quantidade = 1) =>
  api(token).post("/api/vendas").send({ clienteId: cliente.id, quantidade, valor: 5.5 * quantidade, data, sabores: [{ saborId: sabor.id, quantidade }] });
const produzir = (data, quantidade = 1) =>
  api(token).post("/api/producao").send({ data, sabores: [{ saborId: sabor.id, quantidade }] });
const custo = (data, valorTotal = 10) =>
  api(token).post("/api/custos").send({ nome: "Compra fictícia", categoria: "Outros", quantidade: 1, unidade: "un", valorTotal, data });
const datasVendas = async (q) => (await api(token).get(`/api/vendas?${q}`)).body.map((v) => v.data);

/** "AAAA-MM-DD" de hoje em Manaus, calculado pelo próprio teste. */
const hojeEmManaus = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Manaus" }).format(new Date());

describe("vendas nos limites do mês (Manaus)", () => {
  it("último milissegundo do último dia pertence ao mês; 00:00 do dia 1º pertence ao seguinte", async () => {
    await vender("2026-03-31T23:59:59.999");
    await vender("2026-04-01T00:00:00");
    expect(await datasVendas("mes=3&ano=2026")).toEqual(["2026-03-31T23:59:59.999-04:00"]);
    expect(await datasVendas("mes=4&ano=2026")).toEqual(["2026-04-01T00:00:00.000-04:00"]);
    const totais = (await api(token).get("/api/vendas/totais?mes=3&ano=2026")).body;
    expect(totais).toMatchObject({ totalVendas: 1, porDia: { "31/03/2026": 1 } });
  });

  it("virada de ano: 31/12 23:59:59 é dezembro; 01/01 00:00 é janeiro do ano seguinte", async () => {
    await vender("2026-12-31T23:59:59", 2);
    await vender("2027-01-01T00:00:00", 3);
    expect(await datasVendas("mes=12&ano=2026")).toEqual(["2026-12-31T23:59:59.000-04:00"]);
    expect(await datasVendas("mes=1&ano=2027")).toEqual(["2027-01-01T00:00:00.000-04:00"]);
    const r2026 = (await api(token).get("/api/vendas/relatorio-mensal?ano=2026")).body;
    const r2027 = (await api(token).get("/api/vendas/relatorio-mensal?ano=2027")).body;
    expect(r2026.meses[11]).toMatchObject({ mes: 12, nomeMes: "dezembro", totalQuantidade: 2 });
    expect(r2027.meses[0]).toMatchObject({ mes: 1, nomeMes: "janeiro", totalQuantidade: 3 });
  });

  it("agrupamentos por dia e por mês usam o dia civil de Manaus (01/04 00:30 é abril)", async () => {
    await vender("2026-03-31T23:30:00", 2);
    await vender("2026-04-01T00:30:00", 5);
    const abril = (await api(token).get("/api/vendas/totais?mes=4&ano=2026")).body;
    expect(abril.porDia).toEqual({ "01/04/2026": 5 });
    const est = (await api(token).get(`/api/clientes/${cliente.id}/estatisticas`)).body;
    expect(est.vendasPorMes).toEqual({ "abril de 2026": 5, "março de 2026": 2 });
  });
});

describe("formatos de entrada: um mesmo momento, uma mesma venda", () => {
  it("civil sem fuso, com -04:00 e em UTC (Z) gravam o mesmo relógio de Manaus", async () => {
    for (const data of ["2026-03-31T23:30:00", "2026-03-31T23:30:00-04:00", "2026-04-01T03:30:00.000Z"]) {
      const res = await vender(data);
      expect(res.status).toBe(201);
      expect(res.body.data).toBe("2026-03-31T23:30:00.000-04:00");
    }
    const gravadas = await prisma.venda.findMany();
    expect(gravadas.map((v) => v.data.toISOString())).toEqual(Array(3).fill("2026-03-31T23:30:00.000Z"));
    expect(await datasVendas("mes=3&ano=2026")).toHaveLength(3);
  });

  it("só a data (como Custos e Produção enviam) é o dia civil, sem migrar de dia", async () => {
    const res = await vender("2026-03-01");
    expect(res.body.data).toBe("2026-03-01T00:00:00.000-04:00");
    expect(await datasVendas("mes=3&ano=2026")).toHaveLength(1);
    expect(await datasVendas("mes=2&ano=2026")).toHaveLength(0);
  });

  it("data fora do contrato continua sendo rejeitada (500, como antes)", async () => {
    expect((await vender("31/03/2026")).status).toBe(500);
    expect(await prisma.venda.count()).toBe(0);
  });
});

describe("filtros dataInicio/dataFim e mes/ano", () => {
  beforeEach(async () => {
    for (const d of ["2026-03-30T23:59:59.999", "2026-03-31T00:00:00", "2026-04-01T23:59:59.999", "2026-04-02T00:00:00"]) await vender(d);
  });

  it("dataInicio/dataFim: dias civis inteiros, bordas incluídas e excluídas no milissegundo", async () => {
    expect(await datasVendas("dataInicio=2026-03-31&dataFim=2026-04-01")).toEqual([
      "2026-04-01T23:59:59.999-04:00",
      "2026-03-31T00:00:00.000-04:00",
    ]);
    expect(await datasVendas("dataInicio=2026-04-02&dataFim=2026-04-02")).toEqual(["2026-04-02T00:00:00.000-04:00"]);
  });

  it("mes/ano: março tem as duas primeiras, abril as duas últimas", async () => {
    expect(await datasVendas("mes=3&ano=2026")).toHaveLength(2);
    expect(await datasVendas("mes=4&ano=2026")).toHaveLength(2);
  });
});

describe("produção e custos nos limites (Manaus)", () => {
  it("produção: fevereiro (28 dias) termina em 28/02 23:59:59,999; 01/03 é março", async () => {
    await produzir("2026-02-28T23:59:59.999", 4);
    await produzir("2026-03-01", 6);
    const fev = (await api(token).get("/api/producao?mes=2&ano=2026")).body;
    expect(fev.map((p) => p.data)).toEqual(["2026-02-28T23:59:59.999-04:00"]);
    const resumo = (await api(token).get("/api/producao/resumo?mes=3&ano=2026")).body;
    expect(resumo.totalMes).toBe(6);
    expect(resumo.meses[1]).toMatchObject({ mes: 2, nomeMes: "fevereiro", total: 4 });
    expect(resumo.meses[2]).toMatchObject({ mes: 3, nomeMes: "março", total: 6 });
  });

  it("custos: mês de 30 dias; o custo lançado com a data 01/05 é de maio", async () => {
    await custo("2026-04-30T23:59:59.999", 30);
    await custo("2026-05-01", 51);
    const abr = (await api(token).get("/api/custos/resumo?mes=4&ano=2026")).body;
    expect(abr).toMatchObject({ totalGeral: "30.00", totalItens: 1 });
    expect(abr.meses[4]).toMatchObject({ mes: 5, nomeMes: "maio", total: "51.00", quantidade: 1 });
    const mai = (await api(token).get("/api/custos?mes=5&ano=2026")).body;
    expect(mai.map((c) => c.data)).toEqual(["2026-05-01T00:00:00.000-04:00"]);
  });

  it("produção sem data é registrada agora em Manaus e entra em 'hoje' e 'semana' do resumo", async () => {
    const antes = Date.now();
    const res = await produzir(undefined, 7);
    expect(res.body.data.startsWith(hojeEmManaus())).toBe(true);
    expect(res.body.data.endsWith("-04:00")).toBe(true);
    expect(new Date(res.body.data).getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(new Date(res.body.data).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const resumo = (await api(token).get("/api/producao/resumo")).body;
    expect(resumo).toMatchObject({ totalHoje: 7, totalSemana: 7, totalMes: 7 });
  });
});

describe("pagamento: momento da ação no relógio de Manaus", () => {
  let venda;
  beforeEach(async () => {
    venda = (await vender("2026-03-20T10:00:00")).body;
  });

  it("marcar como paga grava o momento atual em Manaus (dia de hoje em Manaus, instante correto)", async () => {
    const antes = Date.now();
    const res = await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: true });
    const depois = Date.now();
    expect(res.body.dataPagamento.startsWith(hojeEmManaus())).toBe(true);
    expect(res.body.dataPagamento.endsWith("-04:00")).toBe(true);
    const instante = new Date(res.body.dataPagamento).getTime();
    expect(instante).toBeGreaterThanOrEqual(antes - 1000);
    expect(instante).toBeLessThanOrEqual(depois + 1000);
  });

  it("pagamento às 22:30 de Manaus fica no dia 20, venha como horário civil, com offset ou em UTC", async () => {
    for (const dataPagamento of ["2026-03-20T22:30:00", "2026-03-20T22:30:00-04:00", "2026-03-21T02:30:00Z"]) {
      await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: false });
      const res = await api(token).patch(`/api/vendas/${venda.id}/pagamento`).send({ pago: true, dataPagamento });
      expect(res.body.dataPagamento).toBe("2026-03-20T22:30:00.000-04:00");
    }
  });

  it("venda criada já paga e venda sem data usam o relógio de Manaus", async () => {
    const res = await api(token).post("/api/vendas").send({ clienteId: cliente.id, quantidade: 1, valor: 5.5, pago: true, sabores: [{ saborId: sabor.id, quantidade: 1 }] });
    expect(res.body.data.startsWith(hojeEmManaus())).toBe(true);
    expect(res.body.dataPagamento.startsWith(hojeEmManaus())).toBe(true);
  });
});
