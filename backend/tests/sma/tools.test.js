// Etapa 1 — tools de leitura: schema, chamada aos services, retorno padronizado
// e auditoria (ChamadaTool). Inclui verificações estáticas da arquitetura.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { CATALOGO } from "../../src/agents/index.js";
import { definirTool, executarTool } from "../../src/agents/tools/definirTool.js";
import * as estoqueService from "../../src/services/estoqueService.js";
import * as vendasService from "../../src/services/vendasService.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { cenarioReceitaBasica, criarCliente, criarProducao, criarSabor, criarVenda } from "../caracterizacao/helpers/fixtures.js";
import { agenteTeste, runtimeTeste } from "./helpers.js";

const chamar = async (nome, entrada) => (await executarTool(CATALOGO.get(nome), entrada, { agente: "teste", execucaoId: null })).resultado;

async function cenarioVendas() {
  const alfa = await criarCliente("Cliente Fictício Alfa");
  const beta = await criarCliente("Cliente Fictício Beta");
  const coco = await criarSabor({ nome: "Coco Fictício" });
  await criarVenda({ clienteId: alfa.id, itens: [{ saborId: coco.id, quantidade: 10 }], valor: 55, data: new Date("2026-03-02T10:00:00Z"), pago: true });
  await criarVenda({ clienteId: beta.id, itens: [{ saborId: coco.id, quantidade: 4 }], valor: 22, data: new Date("2026-03-20T09:00:00Z") });
  await criarVenda({ clienteId: alfa.id, itens: [{ saborId: coco.id, quantidade: 2 }], valor: 11, data: new Date("2026-04-01T00:30:00Z") });
  return { alfa, beta, coco };
}

describe("catálogo", () => {
  // Etapa 2: +consultarReceitas e +consultarProducaoVendasPeriodo (Agente de Estoque).
  // Etapa 3: +consultarVendasDiariasPorSabor e +consultarCustosPeriodo (Agente de Inteligência).
  // Etapa 4: +consultarComprasClientes e +consultarUnidadesClienteSabor (Agente de Vendas).
  // Etapa 5: +resolverEntidades e +consultarNomesClientes (Agente de Atendimento; só leitura).
  it("17 tools; só proporAcao escreve; todas com JSON Schema estrito para o LLM", () => {
    expect([...CATALOGO.keys()]).toEqual([
      "consultarVendasPeriodo", "consultarRankingSabores", "consultarRecebiveis", "consultarEstoqueAcabado",
      "consultarSaldoMateriasPrimas", "consultarResumoProducao", "calcularNecessidadesProducao",
      "consultarEstatisticasCliente", "consultarReceitas", "consultarProducaoVendasPeriodo",
      "consultarVendasDiariasPorSabor", "consultarCustosPeriodo", "consultarComprasClientes", "consultarUnidadesClienteSabor",
      "resolverEntidades", "consultarNomesClientes", "proporAcao",
    ]);
    expect([...CATALOGO.values()].filter((t) => t.escrita).map((t) => t.nome)).toEqual(["proporAcao"]);
    for (const t of CATALOGO.values()) {
      expect(t.parametros).toMatchObject({ type: "object", additionalProperties: false });
      expect(JSON.parse(JSON.stringify(t.parametros))).toEqual(t.parametros); // só dados
    }
  });
});

describe("tools de vendas", () => {
  it("consultarVendasPeriodo: mesmos totais do service, em números, por cliente e por dia (calendário de Manaus)", async () => {
    await cenarioVendas();
    const r = await chamar("consultarVendasPeriodo", { dataInicio: "2026-03-01", dataFim: "2026-03-31" });
    expect(r.ok).toBe(true);
    const servico = await vendasService.resumoVendasPeriodo({ dataInicio: "2026-03-01", dataFim: "2026-03-31" });
    expect(r.dados).toMatchObject({
      totalVendas: servico.totalVendas, unidades: servico.totalGeral, valorTotal: 77, valorPago: 55, valorPendente: 22,
      vendasPagas: 1, vendasPendentes: 1, mediaUnidadesPorVenda: 7,
    });
    expect(r.dados.porCliente).toEqual([{ cliente: "Cliente Fictício Alfa", unidades: 10 }, { cliente: "Cliente Fictício Beta", unidades: 4 }]);
    expect(r.dados.porDia).toEqual([{ dia: "02/03/2026", unidades: 10 }, { dia: "20/03/2026", unidades: 4 }]);
  });

  it.each([
    ["data em formato errado", { dataInicio: "01/03/2026", dataFim: "2026-03-31" }, "dataInicio"],
    ["início depois do fim", { dataInicio: "2026-04-01", dataFim: "2026-03-01" }, "dataFim"],
    ["campo desconhecido", { dataInicio: "2026-03-01", dataFim: "2026-03-31", sql: "DROP" }, "(raiz)"],
    ["clienteId não inteiro", { dataInicio: "2026-03-01", dataFim: "2026-03-31", clienteId: "1" }, "clienteId"],
  ])("consultarVendasPeriodo com %s → ENTRADA_INVALIDA com o campo", async (_, entrada, campo) => {
    const r = await chamar("consultarVendasPeriodo", entrada);
    expect(r).toMatchObject({ ok: false, erro: { codigo: "ENTRADA_INVALIDA" } });
    expect(r.erro.detalhes.map((d) => d.campo)).toContain(campo);
  });

  it("consultarRecebiveis: só pendentes, da mais antiga para a mais recente, com total e limite", async () => {
    const { beta, alfa } = await cenarioVendas();
    const r = await chamar("consultarRecebiveis", { limite: 1 });
    expect(r.dados).toMatchObject({ quantidade: 2, valorPendente: 33, truncado: true });
    expect(r.dados.vendas).toEqual([
      { vendaId: expect.any(Number), cliente: { id: beta.id, nome: beta.nome }, data: "2026-03-20T09:00:00.000-04:00", unidades: 4, valor: 22 },
    ]);
    expect((await chamar("consultarRecebiveis", {})).dados.vendas.map((v) => v.cliente.id)).toEqual([beta.id, alfa.id]);
  });

  it("consultarRankingSabores: ranking do service, com limite e percentual numérico", async () => {
    await cenarioVendas();
    const r = await chamar("consultarRankingSabores", { limite: 1 });
    expect(r.dados).toEqual({
      totalClientes: 2,
      clientes: [{ cliente: "Cliente Fictício Alfa", unidades: 12, saborFavorito: "Coco Fictício", sabores: [{ sabor: "Coco Fictício", unidades: 12, percentual: 100 }] }],
    });
  });

  it("consultarEstatisticasCliente: existente e inexistente (NAO_ENCONTRADO)", async () => {
    const { alfa } = await cenarioVendas();
    const r = await chamar("consultarEstatisticasCliente", { clienteId: alfa.id });
    expect(r.dados).toMatchObject({ cliente: { id: alfa.id }, totalVendas: 2, unidades: 12 });
    expect(r.dados.ultimasVendas[0]).toMatchObject({ data: "2026-04-01T00:30:00.000-04:00", valor: 11, pago: false });
    expect(await chamar("consultarEstatisticasCliente", { clienteId: 999999 })).toEqual({ ok: false, erro: { codigo: "NAO_ENCONTRADO", mensagem: "Cliente não encontrado" } });
  });
});

describe("tools de estoque e produção", () => {
  it("consultarEstoqueAcabado e consultarSaldoMateriasPrimas refletem os services", async () => {
    const { sabor, acucar } = await cenarioReceitaBasica({ estoqueAcucar: 1500, estoqueCoco: 0 });
    await criarProducao({ itens: [{ saborId: sabor.id, quantidade: 30 }] });
    const e = await chamar("consultarEstoqueAcabado", {});
    expect(e.dados.itens).toEqual([{ saborId: sabor.id, sabor: sabor.nome, produzido: 30, vendido: 0, saldo: 30 }]);
    expect(e.dados.totalSaldo).toBe((await estoqueService.obterEstoqueAcabado()).totalSaldo);
    // Etapa 2: + movimentações e última data; o limiar fixo antigo sai como "saldoBaixoLegado" (não é estoque mínimo)
    const mp = await chamar("consultarSaldoMateriasPrimas", {});
    expect(mp.dados.find((m) => m.materiaPrimaId === acucar.id)).toEqual({
      materiaPrimaId: acucar.id, nome: "Açúcar Fictício", unidadeBase: "g", saldo: 1500, saldoNegativo: false,
      saldoBaixoLegado: false, movimentacoes: 1, ultimaMovimentacao: "2026-03-01T12:00:00.000-04:00",
    });
  });

  it("consultarResumoProducao: mês informado; mes sem ano é recusado", async () => {
    const { sabor } = await cenarioReceitaBasica();
    await criarProducao({ itens: [{ saborId: sabor.id, quantidade: 40 }], data: new Date("2026-03-05T12:00:00Z") });
    const r = await chamar("consultarResumoProducao", { mes: 3, ano: 2026 });
    expect(r.dados).toMatchObject({ totalMes: 40, porSabor: [{ sabor: sabor.nome, produzido: 40, vendido: 0, saldo: 40 }] });
    expect(r.dados.meses[2]).toEqual({ mes: 3, nomeMes: "março", produzido: 40 });
    expect((await chamar("consultarResumoProducao", { mes: 3 })).erro.codigo).toBe("ENTRADA_INVALIDA");
  });

  it("calcularNecessidadesProducao simula sem gravar: necessidades, faltantes, sabores sem receita", async () => {
    const { sabor, acucar } = await cenarioReceitaBasica({ estoqueAcucar: 300 });
    const semReceita = await criarSabor({ nome: "Sem Receita Fictício" });
    const antes = [await prisma.producao.count(), await prisma.movimentacaoMateriaPrima.count()];
    const r = await chamar("calcularNecessidadesProducao", { sabores: [{ saborId: sabor.id, quantidade: 50 }, { saborId: semReceita.id, quantidade: 5 }] });
    expect(r.dados.necessidades.find((n) => n.materiaPrimaId === acucar.id)).toEqual({ materiaPrimaId: acucar.id, nome: "Açúcar Fictício", unidadeBase: "g", quantidade: 500 });
    expect(r.dados).toMatchObject({ podeProduzir: false, saboresSemReceita: [semReceita.id] });
    expect(r.dados.faltantes).toEqual(["Açúcar Fictício: necessário 500.0g, disponível 300.0g (falta 200.0g)"]);
    expect([await prisma.producao.count(), await prisma.movimentacaoMateriaPrima.count()]).toEqual(antes);
    expect((await chamar("calcularNecessidadesProducao", { sabores: [{ saborId: 999999, quantidade: 1 }] })).erro.codigo).toBe("NAO_ENCONTRADO");
    expect((await chamar("calcularNecessidadesProducao", { sabores: [{ saborId: sabor.id, quantidade: 0 }] })).erro.codigo).toBe("ENTRADA_INVALIDA");
  });
});

describe("tools pelo contexto do agente: allowlist e auditoria", () => {
  it("cada chamada vira ChamadaTool; tool não permitida e inexistente são recusadas e registradas", async () => {
    const usa = agenteTeste("usa", async (ctx) => [
      await ctx.usarTool("consultarEstoqueAcabado", {}),
      await ctx.usarTool("consultarRecebiveis", {}), // fora da allowlist
      await ctx.usarTool("apagarTudo", {}),
    ], ["consultarEstoqueAcabado"]);
    const r = await runtimeTeste({ extras: [usa] }).executarAgente("usa", { tipo: "TESTE" });
    expect(r.saida.map((x) => x.ok)).toEqual([true, false, false]);
    expect(r.saida[1].erro.codigo).toBe("TOOL_NAO_PERMITIDA");
    expect(r.saida[2].erro.codigo).toBe("TOOL_INEXISTENTE");
    const chamadas = await prisma.chamadaTool.findMany({ orderBy: { id: "asc" } });
    expect(chamadas.map((c) => [c.tool, c.origem, c.ok, c.execucaoId])).toEqual([
      ["consultarEstoqueAcabado", "AGENTE", true, r.execucaoId],
      ["consultarRecebiveis", "AGENTE", false, r.execucaoId],
      ["apagarTudo", "AGENTE", false, r.execucaoId],
    ]);
    expect(chamadas[0].saida).toMatchObject({ totalSaldo: 0 });
    expect(chamadas.every((c) => c.duracaoMs >= 0)).toBe(true);
  });

  it("erro interno da tool: mensagem genérica para o agente/LLM; detalhe só na auditoria", async () => {
    const quebrada = definirTool({ nome: "toolQuebrada", descricao: "teste", entrada: z.object({}).strict(), executar: async () => { throw new Error("SELECT * FROM segredo"); } });
    const catalogo = new Map([...CATALOGO, ["toolQuebrada", quebrada]]);
    const usa = agenteTeste("usa", async (ctx) => ctx.usarTool("toolQuebrada", {}), ["toolQuebrada"]);
    const r = await runtimeTeste({ extras: [usa], catalogo }).executarAgente("usa", { tipo: "TESTE" });
    expect(r.saida).toEqual({ ok: false, erro: { codigo: "ERRO_INTERNO", mensagem: "Erro interno ao executar a tool toolQuebrada" } });
    expect((await prisma.chamadaTool.findFirst()).erro).toBe("SELECT * FROM segredo");
  });
});

describe("arquitetura (verificação estática do código)", () => {
  // Recursivo desde a Etapa 2 (agentes/estoque/ é uma subpasta).
  const ler = (dir) => fs.readdirSync(path.resolve(dir), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => [f, fs.readFileSync(path.resolve(dir, f), "utf8")]);
  const importacoes = (src) => [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);

  it("tools importam services, nunca controllers nem o Prisma", () => {
    for (const [arq, src] of ler("src/agents/tools")) {
      const imps = importacoes(src);
      expect(imps.filter((i) => /controllers|lib\/prisma|@prisma/.test(i)), arq).toEqual([]);
    }
    expect(importacoes(fs.readFileSync(path.resolve("src/agents/tools/vendas.js"), "utf8"))).toContain("../../services/vendasService.js");
  });

  // Etapa 4: + Vendas. Nenhum agente especializado importa outro.
  it("Estoque, Inteligência e Vendas não se importam: a cooperação passa só pelo runtime (Etapas 3 e 4)", () => {
    for (const [dir, proibido] of [
      ["src/agents/agentes/estoque", /inteligencia|vendas/],
      ["src/agents/agentes/inteligencia", /estoque|vendas/], // "comum/indicadoresVendas" tem V maiúsculo: não é o agente
      ["src/agents/agentes/vendas", /estoque|inteligencia/],
      // Etapa 5: o Atendimento também só fala pelo runtime (Coordenador)
      ["src/agents/agentes/atendimento", /(estoque|inteligencia|vendas)\/index/],
    ]) {
      for (const [arq, src] of ler(dir)) {
        expect(importacoes(src).filter((i) => proibido.test(i)), `${dir}/${arq}`).toEqual([]);
      }
    }
  });

  it("agentes e LLM não importam Prisma, services nem controllers (só falam pelo contexto)", () => {
    for (const dir of ["src/agents/agentes", "src/agents/llm", "src/agents/contratos", "src/agents/comum", "src/agents/conversa"]) {
      for (const [arq, src] of ler(dir)) {
        expect(importacoes(src).filter((i) => /prisma|services|controllers|acoes\/servicoAcoes/.test(i)), `${dir}/${arq}`).toEqual([]);
      }
    }
  });
});
