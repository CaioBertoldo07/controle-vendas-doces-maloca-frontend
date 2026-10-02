// Etapa 4 — Agente de Vendas de ponta a ponta (runtime + tools + services +
// banco de teste), sem LLM. Dados 100% fictícios.
import { z } from "zod";
import { describe, expect, it } from "vitest";
import * as servicoAcoes from "../../src/agents/acoes/servicoAcoes.js";
import { CATALOGO } from "../../src/agents/index.js";
import { EXPOSICAO_CLIENTES } from "../../src/agents/contratos/exposicaoClientes.js";
import { definirTool } from "../../src/agents/tools/definirTool.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { criarSabor } from "../caracterizacao/helpers/fixtures.js";
import { REF, cenarioVendas } from "./cenarioVendas.js";
import { capturar, runtimeTeste } from "./helpers.js";

const executar = (tipo, dados = { dataReferencia: REF }, rt = runtimeTeste()) => rt.executarAgente("vendas", { tipo, dados }, { gatilho: "HTTP" });
const quebrada = (nome) => definirTool({ nome, descricao: "falha simulada", entrada: z.object({}).passthrough(), executar: async () => { throw new Error("banco fora"); } });
const comToolsQuebradas = (...nomes) => runtimeTeste({ catalogo: new Map([...CATALOGO, ...nomes.map((n) => [n, quebrada(n)])]) });
const erroDe = async (promessa) => (await prisma.execucaoAgente.findUnique({ where: { id: (await capturar(promessa)).execucaoId } })).erro;
const dominio = () => Promise.all([prisma.venda.count(), prisma.venda.count({ where: { pago: true } }), prisma.producao.count(), prisma.cliente.count()]);
const PREDITIVO = /inadimpl|atrasad|vencid|vai comprar|deveria|abandonou|previs/i;

describe("ANALISAR_VENDAS: diagnóstico do cenário acadêmico", () => {
  it("indicadores, mix com exposição, recebíveis por tempo em aberto, recorrência e recomendações agregadas", async () => {
    const { clientes, tradicional, maracuja, pendentes } = await cenarioVendas();
    const antes = await dominio();
    const { saida, status } = await executar("ANALISAR_VENDAS");
    expect(status).toBe("SUCESSO");

    expect(saida.periodo).toMatchObject({ dataInicio: "2026-08-30", dataFim: "2026-09-26", semanas: 4, semanaParcialExcluida: { dataInicio: "2026-09-27", dataFim: REF } });
    expect(saida.indicadores).toMatchObject({
      disponivel: true, quantidadeVendas: 9, unidades: 135, faturamentoRegistrado: 742.5, ticketMedio: 82.5, sabores: 2, clientesCompradores: 4,
      pagamentos: { vendasPagas: 7, vendasPendentes: 2, valorPendente: 192.5, historicoPagamento: { classificacao: "OPERACIONAL" } },
    });
    expect(saida.mix.sabores.map((s) => [s.sabor, s.unidades, s.participacao, s.clientesComCompraRecente, s.clientesRecorrentes, s.participacaoClientesRecorrentes])).toEqual([
      ["Tradicional", 90, 66.7, 2, 2, 100],
      ["Maracujá", 45, 33.3, 3, 1, 11.1],
    ]);

    expect(saida.recebiveis).toMatchObject({ quantidade: 3, valorPendente: 247.5, clientes: 3, maiorTempoEmAberto: 55, historicoPagamento: { classificacao: "COM_RESSALVA" } });
    expect(saida.recebiveis.vendas.map((v) => [v.vendaId, v.clienteId, v.diasEmAberto, v.faixa])).toEqual([
      [pendentes.a.id, clientes.a.id, 55, "31+"], [pendentes.b.id, clientes.b.id, 22, "16-30"], [pendentes.c.id, clientes.c.id, 9, "8-15"],
    ]);

    const porCliente = Object.fromEntries(saida.recorrencia.clientes.map((c) => [c.clienteId, [c.compras, c.medianaIntervalo, c.diasDesdeUltimaCompra, c.classificacao]]));
    expect(porCliente).toEqual({
      [clientes.a.id]: [4, 10, 25, "FORA_DO_PADRAO_HISTORICO"],
      [clientes.b.id]: [2, 14, 8, "DADOS_INSUFICIENTES"],
      [clientes.c.id]: [8, 7, 9, "DENTRO_DO_PADRAO"], // 14/09 tem 2 vendas: uma ocasião só
      [clientes.d.id]: [1, null, 15, "DADOS_INSUFICIENTES"],
    });
    expect(saida.recorrencia.resumo).toMatchObject({ clientes: 4, elegiveis: 2, foraDoPadraoHistorico: 1, dentroDoPadrao: 1, comRecompra: 3 });

    expect(saida.recomendacoes.map((r) => [r.tipo, r.prioridade, r.operacao])).toEqual([
      ["REVISAR_RECEBIVEIS_PENDENTES", "MEDIA", "CRIADA"], ["REVISAR_CLIENTES_FORA_PADRAO", "BAIXA", "CRIADA"],
    ]);
    const fora = await prisma.recomendacao.findFirst({ where: { tipo: "REVISAR_CLIENTES_FORA_PADRAO" } });
    expect(fora).toMatchObject({ agente: "vendas", status: "ABERTA", dados: { clientes: [{ clienteId: clientes.a.id, diasDesdeUltimaCompra: 25 }] } });
    expect(saida.insights.map((i) => i.tipo)).toEqual(["MIX_SABORES", "RECORRENCIA", "RECEBIVEIS"]);
    expect(saida.resumo).toEqual({ vendas: 9, pendencias: 3, clientesForaDoPadrao: 1, recomendacoes: 2, modoDegradado: false });

    // só fatos: sem nomes de clientes, sem linguagem preditiva/de cobrança; nada de domínio alterado; nenhuma ação
    const texto = JSON.stringify({ ...saida, limitacoes: [], recebiveis: { ...saida.recebiveis, historicoPagamento: null } });
    expect(texto).not.toMatch(/Mercearia|Quiosque|Padaria|Lanchonete/);
    // as únicas menções permitidas são as negações explícitas
    expect(texto.replace(/não é atraso|não é inadimplência|não indica atraso|não uma previsão|não é previsão de compra nem de abandono|não é previsão/g, "")).not.toMatch(PREDITIVO);
    expect(await dominio()).toEqual(antes);
    expect(await prisma.acaoProposta.count()).toBe(0);
    expect([tradicional.id, maracuja.id].every(Number.isInteger)).toBe(true);
  });

  it("repetir não duplica recomendações; quitar as pendências resolve a de recebíveis automaticamente", async () => {
    await cenarioVendas();
    await executar("ANALISAR_VENDAS");
    const r2 = await executar("ANALISAR_VENDAS");
    expect(r2.saida.recomendacoes.map((r) => r.operacao)).toEqual(["ATUALIZADA", "ATUALIZADA"]);
    expect(await prisma.recomendacao.count()).toBe(2);
    await prisma.venda.updateMany({ where: { pago: false }, data: { pago: true } }); // o gestor marcou tudo (fora do agente)
    const r3 = await executar("ANALISAR_VENDAS");
    expect((await prisma.recomendacao.findFirst({ where: { tipo: "REVISAR_RECEBIVEIS_PENDENTES" } })).status).toBe("RESOLVIDA");
    expect(r3.saida.resolvidasAutomaticamente).toHaveLength(1);
  });

  it("auditoria: 5 tools com resumo e sem nomes de clientes", async () => {
    await cenarioVendas();
    const { execucaoId } = await executar("ANALISAR_VENDAS");
    const chamadas = await prisma.chamadaTool.findMany({ where: { execucaoId }, orderBy: { id: "asc" } });
    expect(chamadas.map((c) => [c.tool, c.ok])).toEqual([
      ["consultarVendasPeriodo", true], ["consultarVendasDiariasPorSabor", true], ["consultarRecebiveis", true],
      ["consultarComprasClientes", true], ["consultarUnidadesClienteSabor", true],
    ]);
    expect(chamadas[2].saida).toEqual({ quantidade: 3, valorPendente: 247.5, listadas: 3, truncado: false });
    expect(chamadas[3].saida).toEqual({ dataFim: REF, clientes: 4, ocasioes: 15 });
    expect(JSON.stringify(chamadas.map((c) => c.saida))).not.toMatch(/Mercearia|Quiosque|Padaria|Lanchonete/);
  });
});

describe("modo degradado", () => {
  it("recebíveis indisponíveis; recorrência e mix continuam; nenhuma recomendação de recebíveis resolvida por engano", async () => {
    await cenarioVendas();
    await executar("ANALISAR_VENDAS");
    const { saida, status } = await executar("ANALISAR_VENDAS", { dataReferencia: REF }, comToolsQuebradas("consultarRecebiveis"));
    expect(status).toBe("SUCESSO");
    expect(saida.recebiveis).toEqual({ disponivel: false, motivo: "FALHA_CONSULTA_RECEBIVEIS" });
    expect(saida.recorrencia.disponivel).toBe(true);
    expect(saida.mix.disponivel).toBe(true);
    expect(saida.resumo.modoDegradado).toBe(true);
    expect(saida.falhasDeConsulta.map((f) => f.tool)).toEqual(["consultarRecebiveis"]);
    expect((await prisma.recomendacao.findFirst({ where: { tipo: "REVISAR_RECEBIVEIS_PENDENTES" } })).status).toBe("ABERTA");
  });

  it("compras e série indisponíveis; recebíveis e indicadores continuam", async () => {
    await cenarioVendas();
    const { saida } = await executar("ANALISAR_VENDAS", { dataReferencia: REF }, comToolsQuebradas("consultarComprasClientes", "consultarVendasDiariasPorSabor"));
    expect(saida.recorrencia).toEqual({ disponivel: false, motivo: "FALHA_CONSULTA_COMPRAS" });
    expect(saida.mix).toEqual({ disponivel: false, motivo: "FALHA_CONSULTA_SERIE" });
    expect(saida.recebiveis.quantidade).toBe(3);
    expect(saida.indicadores).toMatchObject({ disponivel: true, quantidadeVendas: 9, sabores: null });
  });

  it("banco vazio: SUCESSO, zeros, sem recomendações nem Infinity/NaN", async () => {
    const { saida } = await executar("ANALISAR_VENDAS");
    expect(saida.resumo).toMatchObject({ vendas: 0, pendencias: 0, clientesForaDoPadrao: 0, recomendacoes: 0 });
    expect(saida.mix).toMatchObject({ disponivel: true, vazio: true });
    expect(JSON.stringify(saida)).not.toMatch(/Infinity|NaN/);
  });
});

describe("EXPOSICAO_CLIENTES_POR_SABOR (contrato)", () => {
  it("Tradicional com alta exposição a recorrentes; Maracujá baixa; sabor sem venda na janela; só agregados", async () => {
    const { tradicional, maracuja } = await cenarioVendas();
    const pistache = await criarSabor({ nome: "Pistache Fictício" });
    const { saida } = await executar("EXPOSICAO_CLIENTES_POR_SABOR", { dataReferencia: REF, saborIds: [tradicional.id, maracuja.id, pistache.id] });
    expect(EXPOSICAO_CLIENTES.resposta.safeParse(saida).success).toBe(true);
    expect(saida.metodologia).toMatchObject({ tipo: "EXPOSICAO_HISTORICA_RECENTE", periodo: { dataInicio: "2026-08-30", dataFim: "2026-09-26" } });
    expect(saida.metodologia.observacao).toMatch(/não indica que eles vão comprar de novo/);
    expect(saida.sabores.map((s) => [s.sabor, s.clientesComCompraRecente, s.clientesRecorrentes, s.participacaoClientesRecorrentes, s.qualidade])).toEqual([
      ["Tradicional", 2, 2, 100, "COM_VENDAS_NA_JANELA"], ["Maracujá", 3, 1, 11.1, "COM_VENDAS_NA_JANELA"], ["Pistache Fictício", 0, 0, null, "SEM_VENDAS_NA_JANELA"],
    ]);
  });

  it.each([
    [{ dataReferencia: REF }, /saborIds/],
    [{ dataReferencia: REF, saborIds: [999999] }, /Sabor\(es\) inexistente\(s\): 999999/],
    [{ dataReferencia: REF, saborIds: [1], janelaSemanas: 20 }, /janelaSemanas/],
  ])("pedido inválido %o → FALHA controlada", async (dados, mensagem) => {
    expect(await erroDe(executar("EXPOSICAO_CLIENTES_POR_SABOR", dados))).toMatch(mensagem);
  });

  it("sem dados de compras → FALHA explícita (o solicitante entra em modo degradado)", async () => {
    const { tradicional } = await cenarioVendas();
    expect(await erroDe(executar("EXPOSICAO_CLIENTES_POR_SABOR", { dataReferencia: REF, saborIds: [tradicional.id] }, comToolsQuebradas("consultarComprasClientes"))))
      .toBe("Dados indisponíveis para a exposição de clientes (consultarComprasClientes: ERRO_INTERNO)");
  });
});

describe("propostas: só AcaoProposta PENDENTE, nunca execução", () => {
  it("PROPOR_VENDA válida → REGISTRAR_VENDA PENDENTE com valor informado; nenhuma venda criada; reenvio idêntico reaproveita", async () => {
    const { clientes, tradicional } = await cenarioVendas();
    const antes = await dominio();
    const dados = { clienteId: clientes.d.id, sabores: [{ saborId: tradicional.id, quantidade: 12 }], valor: 66 };
    const r = await executar("PROPOR_VENDA", dados);
    expect(r.saida).toMatchObject({ agente: "vendas", tipo: "PROPOSTA", acao: { tipo: "REGISTRAR_VENDA", status: "PENDENTE", reaproveitada: false } });
    const acao = await prisma.acaoProposta.findUnique({ where: { id: r.saida.acao.acaoId } });
    expect(acao).toMatchObject({ status: "PENDENTE", criadaPorAgente: "vendas", execucaoId: r.execucaoId, payload: dados, aprovadaEm: null, executadaEm: null });
    expect(acao.descricao).toBe(`Registrar venda para o cliente ${clientes.d.id}: 12 unidade(s), valor informado 66.`);
    expect(await dominio()).toEqual(antes);

    const de_novo = await executar("PROPOR_VENDA", dados);
    expect(de_novo.saida.acao).toMatchObject({ acaoId: acao.id, reaproveitada: true });
    expect(await prisma.acaoProposta.count()).toBe(1);
    // depois de decidida (rejeitada), a mesma intenção volta a ser uma proposta nova
    await servicoAcoes.rejeitarAcao(acao.id, "teste");
    expect((await executar("PROPOR_VENDA", dados)).saida.acao.reaproveitada).toBe(false);
    expect(await prisma.acaoProposta.count()).toBe(2);
  });

  it.each([
    ["sem valor (o valor é informado, não calculado)", (c, s) => ({ clienteId: c, sabores: [{ saborId: s, quantidade: 1 }] }), /valor/],
    ["quantidade zero", (c, s) => ({ clienteId: c, sabores: [{ saborId: s, quantidade: 0 }], valor: 5 }), /sabores/],
    ["nome em vez de id (sem resolução de texto)", (c) => ({ cliente: "Mercearia", sabores: [{ sabor: "Tradicional", quantidade: 1 }], valor: 5, clienteId: c }), /Payload inválido/],
    ["cliente inexistente", (c, s) => ({ clienteId: 999999, sabores: [{ saborId: s, quantidade: 1 }], valor: 5 }), /Cliente não encontrado/],
  ])("PROPOR_VENDA inválida: %s → FALHA controlada, nenhuma ação", async (_, montar, mensagem) => {
    const { clientes, tradicional } = await cenarioVendas();
    expect(await erroDe(executar("PROPOR_VENDA", montar(clientes.a.id, tradicional.id)))).toMatch(mensagem);
    expect(await prisma.acaoProposta.count()).toBe(0);
  });

  it("PROPOR_MARCAR_VENDA_PAGA só com vendaId explícito → PENDENTE; a venda continua pendente; inexistente 404; já paga 409", async () => {
    const { pendentes } = await cenarioVendas();
    const r = await executar("PROPOR_MARCAR_VENDA_PAGA", { vendaId: pendentes.b.id });
    expect(r.saida.acao).toMatchObject({ tipo: "MARCAR_VENDA_PAGA", status: "PENDENTE" });
    expect((await prisma.venda.findUnique({ where: { id: pendentes.b.id } })).pago).toBe(false); // nunca marca sozinho
    expect(await erroDe(executar("PROPOR_MARCAR_VENDA_PAGA", { vendaId: 999999 }))).toMatch(/Venda não encontrada/);
    const paga = await prisma.venda.findFirst({ where: { pago: true } });
    expect(await erroDe(executar("PROPOR_MARCAR_VENDA_PAGA", { vendaId: paga.id }))).toBe(`Venda ${paga.id} já está paga`);
  });

  it("a análise de recebíveis nunca propõe pagamento; DIAGNOSTICO (Coordenador) e PING", async () => {
    await cenarioVendas();
    await executar("ANALISAR_VENDAS");
    expect(await prisma.acaoProposta.count()).toBe(0);
    expect((await executar("DIAGNOSTICO", {})).saida).toEqual({ agente: "vendas", toolsOk: true, tools: { consultarRecebiveis: "ok", consultarComprasClientes: "ok" } });
    expect((await executar("PING", {})).saida).toEqual({ agente: "vendas", pong: true });
  });
});
