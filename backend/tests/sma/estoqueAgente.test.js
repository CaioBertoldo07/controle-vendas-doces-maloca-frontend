// Etapa 2 — Agente de Estoque de ponta a ponta (runtime + tools + services +
// banco de teste), sem LLM. Dados 100% fictícios.
import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import * as consultas from "../../src/agents/consultas.js";
import { alterarStatus } from "../../src/agents/runtime/recomendacoes.js";
import { CATALOGO } from "../../src/agents/index.js";
import { definirTool } from "../../src/agents/tools/definirTool.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import {
  cenarioReceitaBasica, criarCliente, criarMateriaPrima, criarProducao, criarSabor, criarVenda, movimentar,
} from "../caracterizacao/helpers/fixtures.js";
import { capturar, runtimeTeste } from "./helpers.js";

const REF = "2026-09-30"; // data de referência fixa dos cenários
const dia = (d, h = 12) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00.000Z`); // horário civil de Manaus
let cliente;
beforeEach(async () => {
  cliente = await criarCliente("Mercearia Fictícia Aurora");
});

const analisar = (rt = runtimeTeste(), dados = { dataReferencia: REF }) => rt.executarAgente("estoque", { tipo: "ANALISAR_ESTOQUE", dados }, { gatilho: "HTTP" });
const vender = (saborId, quantidade, d) => criarVenda({ clienteId: cliente.id, itens: [{ saborId, quantidade }], data: dia(d) });
const produzir = (saborId, quantidade, d) => criarProducao({ itens: [{ saborId, quantidade }], data: dia(d) });
const alertas = (saida) => saida.alertas.map((a) => [a.tipo, a.subtipo ?? null, a.prioridade, a.entidade.nome ?? null]);
// Etapa 3: mensagens saíram desta contagem (o Estoque passou a pedir DEMANDA_MEDIA à Inteligência; ver as asserções da cooperação).
const contagemDominio = async () => Promise.all([prisma.venda.count(), prisma.producao.count(), prisma.movimentacaoMateriaPrima.count(), prisma.custo.count(), prisma.acaoProposta.count()]);

/** Cenário acadêmico controlado (docs/tcc/etapa-2-agente-estoque.md §16). */
async function cenarioAcademico() {
  const tradicional = await criarSabor({ nome: "Tradicional" });
  const maracuja = await criarSabor({ nome: "Maracujá" });
  await produzir(tradicional.id, 80, "2026-09-25");
  await vender(tradicional.id, 60, "2026-09-26");
  await vender(tradicional.id, 40, "2026-09-28");
  await produzir(maracuja.id, 100, "2026-09-24");
  await vender(maracuja.id, 80, "2026-09-27");
  return { tradicional, maracuja };
}

describe("modo degradado", () => {
  it("banco sem nenhum dado: SUCESSO, tudo marcado como indisponível/sem dados e nada inventado", async () => {
    const r = await analisar();
    expect(r.status).toBe("SUCESSO");
    expect(r.saida.resumo).toMatchObject({ alertas: 0, recomendacoes: 0, modoDegradado: true });
    expect(r.saida.qualidade).toMatchObject({
      estoqueAcabado: { confiabilidade: "NAO_RECONCILIADO", sabores: 0 },
      materiasPrimas: { confiabilidade: "INDISPONIVEL", motivo: "SEM_MATERIAS_PRIMAS_CADASTRADAS" },
      receitas: { confiabilidade: "INDISPONIVEL" },
      mrp: { disponivel: false, estado: "INDISPONIVEL_POR_DADOS", motivo: "SEM_SABORES_ATIVOS" },
      fluxosProducaoVendas: { confiabilidade: "SEM_DADOS_NO_PERIODO" },
    });
    expect(await prisma.recomendacao.count()).toBe(0);
  });

  it("nunca inventa estoque mínimo, cobertura, lead time, fornecedor, lista de compras ou previsão (nenhum campo assim)", async () => {
    await cenarioAcademico();
    const r = await analisar();
    const chaves = new Set();
    const coletar = (v) => {
      if (Array.isArray(v)) v.forEach(coletar);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { chaves.add(k.toLowerCase()); coletar(x); }
    };
    coletar(r.saida);
    expect([...chaves].filter((k) => /minim|cobertura|leadtime|prazo|fornecedor|compra|previs|forecast|tendencia/.test(k))).toEqual([]);
    expect(JSON.stringify(r.saida)).not.toContain("estoque físico atual");
  });

  it("tool que falha: a análise continua, a seção fica indisponível e não resolve recomendações por engano", async () => {
    await cenarioAcademico(); // gera CADASTRAR_RECEITAS
    await analisar();
    const quebrada = definirTool({ nome: "consultarReceitas", descricao: "falha simulada", entrada: z.object({}).strict(), executar: async () => { throw new Error("banco fora"); } });
    const rt = runtimeTeste({ catalogo: new Map([...CATALOGO, ["consultarReceitas", quebrada]]) });
    const r = await analisar(rt);
    expect(r.status).toBe("SUCESSO");
    expect(r.saida.mrp).toMatchObject({ disponivel: false, estado: "INDISPONIVEL_POR_FALHA" });
    expect(r.saida.falhasDeConsulta).toEqual([{ tool: "consultarReceitas", codigo: "ERRO_INTERNO", mensagem: "Erro interno ao executar a tool consultarReceitas" }]);
    expect(r.saida.resumo.modoDegradado).toBe(true);
    expect(await prisma.chamadaTool.findFirst({ where: { execucaoId: r.execucaoId, tool: "consultarReceitas" } })).toMatchObject({ ok: false, erro: "banco fora" });
    expect((await prisma.recomendacao.findFirst({ where: { tipo: "CADASTRAR_RECEITAS" } })).status).toBe("ABERTA"); // não "resolvida" por falta de dado
  });

  it("dataReferencia inválida → execução FALHA controlada", async () => {
    const e = await capturar(analisar(runtimeTeste(), { dataReferencia: "30/09/2026" }));
    expect((await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } })).erro).toBe("dataReferencia deve estar no formato AAAA-MM-DD (dia civil de Manaus)");
  });
});

describe("cenário acadêmico controlado (Tradicional × Maracujá, sem receitas)", () => {
  it("divergência e ritmo abaixo para Tradicional; nada crítico para Maracujá; MRP indisponível", async () => {
    const { tradicional, maracuja } = await cenarioAcademico();
    const antes = await contagemDominio();
    const { saida } = await analisar();

    expect(saida.estoqueAcabado.sabores.map((s) => [s.sabor, s.saldo, s.situacao])).toEqual([["Maracujá", 20, "POSITIVO"], ["Tradicional", -20, "NEGATIVO"]]);
    expect(saida.estoqueAcabado.natureza).toBe("SALDO_CONTABIL_HISTORICO");
    expect(alertas(saida)).toEqual([
      ["SALDO_NEGATIVO", null, "MEDIA", "Tradicional"],
      ["DADOS_ESTOQUE_NAO_RECONCILIADOS", null, "MEDIA", null],
      ["RECEITA_AUSENTE", null, "MEDIA", "Maracujá"],
      ["RECEITA_AUSENTE", null, "MEDIA", "Tradicional"],
      ["MRP_INDISPONIVEL", null, "MEDIA", null],
      ["RITMO_PRODUCAO_ABAIXO_VENDAS", null, "MEDIA", "Tradicional"],
    ]);
    expect(saida.alertas.filter((a) => a.entidade.id === maracuja.id).map((a) => a.tipo)).toEqual(["RECEITA_AUSENTE"]);
    expect(saida.mrp).toMatchObject({ disponivel: false, estado: "INDISPONIVEL_POR_DADOS", motivo: "RECEITAS_NAO_CADASTRADAS", simulacao: { executada: false } });
    expect(saida.ritmo.janelas.map((j) => [j.dias, j.dataInicio, j.dataFim, j.produzido, j.vendido])).toEqual([[7, "2026-09-24", REF, 180, 180], [30, "2026-09-01", REF, 180, 180]]);
    expect(saida.ritmo.janelas[0].sabores.find((s) => s.saborId === tradicional.id)).toMatchObject({ produzido: 80, vendido: 100, diferenca: -20, razaoProduzidoVendido: 0.8 });

    expect(saida.recomendacoes.map((r) => [r.tipo, r.prioridade, r.operacao])).toEqual([["CONTAGEM_FISICA", "MEDIA", "CRIADA"], ["CADASTRAR_RECEITAS", "MEDIA", "CRIADA"]]);
    const contagem = await prisma.recomendacao.findFirst({ where: { tipo: "CONTAGEM_FISICA" } });
    expect(contagem).toMatchObject({ agente: "estoque", status: "ABERTA", titulo: "Realizar contagem física do estoque acabado" });
    expect(contagem.dados).toMatchObject({ sabores: [{ saborId: tradicional.id, sabor: "Tradicional", saldo: -20 }], controle: { chave: "CONTAGEM_FISICA|estoque-acabado", ocorrencias: 1 } });

    expect(await contagemDominio()).toEqual(antes); // nenhuma escrita de domínio, nenhuma ação
    // Etapa 3: histórico de 1 semana → a Inteligência responde sem média (DADOS_INSUFICIENTES / SEM_HISTORICO) e o Estoque não conclui nada com ela
    expect(saida.demanda).toMatchObject({ solicitada: true, disponivel: true });
    expect(saida.demanda.sabores.map((s) => [s.sabor, s.qualidade, s.situacao, s.mediaSemanal])).toEqual([
      ["Tradicional", "DADOS_INSUFICIENTES", "SEM_CONCLUSAO", null], ["Maracujá", "SEM_HISTORICO", "SEM_CONCLUSAO", null],
    ]);
    expect(saida.demanda.divergencias).toEqual([]);
    expect(saida.qualidade.demandaMediaRecente).toMatchObject({ confiabilidade: "DADOS_INSUFICIENTES", saboresComMedia: 0 });
    expect(await prisma.chamadaTool.count({ where: { tool: "calcularNecessidadesProducao" } })).toBe(0); // sem receita, sem MRP
  });
});

describe("MRP com receita SINTÉTICA (prova técnica; não é o estado real do negócio)", () => {
  it("receita completa → MRP DISPONIVEL; simula a reposição dos 30 dias e aponta insumo insuficiente", async () => {
    const { sabor, acucar } = await cenarioReceitaBasica({ estoqueAcucar: 1000 });
    await produzir(sabor.id, 160, "2026-09-10");
    await vender(sabor.id, 90, "2026-09-15");
    await vender(sabor.id, 60, "2026-09-29");
    const { saida, execucaoId } = await analisar();

    expect(saida.mrp).toMatchObject({ disponivel: true, estado: "DISPONIVEL" });
    expect(saida.mrp.simulacao).toMatchObject({ executada: true, natureza: "SIMULACAO_TECNICA", base: "VOLUME_VENDIDO_ULTIMOS_30_DIAS", sabores: [{ saborId: sabor.id, quantidade: 150 }], podeProduzir: false });
    expect(saida.mrp.simulacao.necessidades.find((n) => n.materiaPrimaId === acucar.id).quantidade).toBe(1500);
    expect(saida.mrp.simulacao.aviso).toMatch(/Não é lista de compras/);
    expect(alertas(saida)).toContainEqual(["MATERIA_PRIMA_INSUFICIENTE", null, "MEDIA", null]);
    expect(saida.qualidade.receitas).toMatchObject({ confiabilidade: "COMPLETA", comReceita: 1, semReceita: 0 });
    expect(await prisma.chamadaTool.findFirst({ where: { execucaoId, tool: "calcularNecessidadesProducao" } })).toMatchObject({ ok: true });
    expect(await prisma.producao.count()).toBe(1); // a simulação não grava produção
  });

  it("receitas parciais → MRP PARCIAL: simula só quem tem receita e pede o cadastro das demais", async () => {
    const { sabor } = await cenarioReceitaBasica();
    const semReceita = await criarSabor({ nome: "Limão Fictício" });
    await vender(sabor.id, 30, "2026-09-20");
    await vender(semReceita.id, 30, "2026-09-20");
    const { saida } = await analisar();
    expect(saida.mrp).toMatchObject({ disponivel: true, estado: "PARCIAL", saboresSemReceita: [{ saborId: semReceita.id }] });
    expect(saida.mrp.simulacao.sabores).toEqual([{ saborId: sabor.id, quantidade: 30 }]);
    expect(saida.recomendacoes.map((r) => r.tipo)).toContain("CADASTRAR_RECEITAS");
    expect(alertas(saida)).not.toContainEqual(["MRP_INDISPONIVEL", null, "MEDIA", null]);
  });
});

describe("matéria-prima", () => {
  it("negativa → ALTA e recomendação; sem movimento → BAIXA sem recomendação; 'saldo baixo' legado ignorado", async () => {
    const acucar = await criarMateriaPrima({ nome: "Açúcar Fictício" });
    const coco = await criarMateriaPrima({ nome: "Coco Fictício" });
    const leite = await criarMateriaPrima({ nome: "Leite Fictício" });
    await movimentar(acucar.id, { quantidade: 100 });
    await movimentar(acucar.id, { tipo: "SAIDA", origem: "PRODUCAO", quantidade: 400 });
    await movimentar(leite.id, { quantidade: 150 }); // < 200: "saldo baixo" do legado
    const { saida } = await analisar();
    expect(saida.materiasPrimas.confiabilidade).toBe("PARCIAL");
    expect(alertas(saida).filter((a) => a[0].startsWith("MATERIA_PRIMA"))).toEqual([
      ["MATERIA_PRIMA_NEGATIVA", null, "ALTA", "Açúcar Fictício"],
      ["MATERIA_PRIMA_SEM_MOVIMENTO", null, "BAIXA", "Coco Fictício"],
    ]);
    expect(saida.alertas.some((a) => a.entidade.id === leite.id)).toBe(false);
    expect(saida.recomendacoes.map((r) => [r.tipo, r.prioridade])).toEqual([["REVISAR_MOVIMENTACOES_MATERIA_PRIMA", "ALTA"]]);
    expect(coco.id).toBeGreaterThan(0);
  });
});

describe("deduplicação e ciclo de vida das recomendações", () => {
  it("rodar duas vezes não duplica: a segunda atualiza (ocorrências 2, execução mais recente)", async () => {
    await cenarioAcademico();
    const r1 = await analisar();
    const r2 = await analisar();
    expect(await prisma.recomendacao.count()).toBe(2);
    expect(r2.saida.recomendacoes.map((r) => r.operacao)).toEqual(["ATUALIZADA", "ATUALIZADA"]);
    expect(r2.saida.resumo).toMatchObject({ recomendacoesCriadas: 0, recomendacoesAtualizadas: 2 });
    const c = await prisma.recomendacao.findFirst({ where: { tipo: "CONTAGEM_FISICA" } });
    expect(c.execucaoId).toBe(r2.execucaoId);
    expect(c.dados.controle).toMatchObject({ ocorrencias: 2, primeiraExecucaoId: r1.execucaoId, ultimaExecucaoId: r2.execucaoId });
  });

  it("condição corrigida nos registros → resolvida automaticamente; CONTAGEM_FISICA continua ABERTA (saldo positivo não é contagem)", async () => {
    const { tradicional } = await cenarioAcademico();
    const acucar = await criarMateriaPrima({ nome: "Açúcar Fictício" });
    await movimentar(acucar.id, { tipo: "SAIDA", origem: "PRODUCAO", quantidade: 400 });
    await analisar();
    await movimentar(acucar.id, { quantidade: 1000 }); // a compra esquecida foi registrada: saldo +600
    await produzir(tradicional.id, 30, "2026-09-29"); // saldo histórico volta a +10, mas ninguém contou o estoque
    const r = await analisar();

    const mp = await prisma.recomendacao.findFirst({ where: { tipo: "REVISAR_MOVIMENTACOES_MATERIA_PRIMA" } });
    expect(mp.status).toBe("RESOLVIDA");
    expect(mp.resolvidaEm).not.toBeNull();
    expect(mp.dados.controle.resolucao).toEqual({ modo: "AUTOMATICA", execucaoId: r.execucaoId, motivo: "Condição não detectada nesta análise" });
    expect(r.saida.resolvidasAutomaticamente).toEqual([mp.id]);

    const contagem = await prisma.recomendacao.findFirst({ where: { tipo: "CONTAGEM_FISICA" } });
    expect(contagem).toMatchObject({ status: "ABERTA", resolvidaEm: null });
    expect(contagem.dados.controle.ocorrencias).toBe(1); // não foi redetectada, só não foi encerrada
    expect((await prisma.recomendacao.findFirst({ where: { tipo: "CADASTRAR_RECEITAS" } })).status).toBe("ABERTA"); // ainda sem receita
  });

  it("IGNORADA pelo gestor não é recriada (SUPRIMIDA); RESOLVIDA pelo gestor reaparece se o problema continuar", async () => {
    await cenarioAcademico();
    await analisar();
    const receitas = await prisma.recomendacao.findFirst({ where: { tipo: "CADASTRAR_RECEITAS" } });
    const contagem = await prisma.recomendacao.findFirst({ where: { tipo: "CONTAGEM_FISICA" } });
    await alterarStatus(receitas.id, "IGNORADA");
    await alterarStatus(contagem.id, "RESOLVIDA");
    const r = await analisar();
    expect(r.saida.recomendacoes.map((x) => [x.tipo, x.operacao])).toEqual([["CONTAGEM_FISICA", "CRIADA"], ["CADASTRAR_RECEITAS", "SUPRIMIDA"]]);
    expect(await prisma.recomendacao.count({ where: { tipo: "CADASTRAR_RECEITAS" } })).toBe(1);
    expect(await prisma.recomendacao.findMany({ where: { tipo: "CONTAGEM_FISICA" }, orderBy: { id: "asc" }, select: { status: true } })).toEqual([{ status: "RESOLVIDA" }, { status: "ABERTA" }]);
    expect((await capturar(alterarStatus(receitas.id, "RESOLVIDA"))).status).toBe(409); // só ABERTA muda de status
  });
});

describe("auditoria da análise", () => {
  it("execução reconstruível: tools (com resumo, não dataset), recomendações, duração; DIAGNOSTICO e PING continuam", async () => {
    await cenarioAcademico();
    const { execucaoId } = await analisar();
    const ex = await consultas.buscarExecucao(execucaoId);
    expect(ex).toMatchObject({ agente: "estoque", tipoExecucao: "ANALISAR_ESTOQUE", gatilho: "HTTP", status: "SUCESSO" });
    expect(ex.duracaoMs).toBeGreaterThanOrEqual(0);
    expect(ex.chamadasTool.map((c) => [c.tool, c.ok])).toEqual([
      ["consultarEstoqueAcabado", true], ["consultarSaldoMateriasPrimas", true], ["consultarReceitas", true],
      ["consultarProducaoVendasPeriodo", true], ["consultarProducaoVendasPeriodo", true],
    ]);
    expect(ex.chamadasTool[0].saida).toEqual({ sabores: 2, negativos: 1, totalProduzido: 180, totalVendido: 180, totalSaldo: 0 });
    expect(ex.chamadasTool[3].entrada).toEqual({ dataInicio: "2026-09-24", dataFim: REF });
    expect(ex.recomendacoes.map((r) => r.tipo)).toEqual(["CONTAGEM_FISICA", "CADASTRAR_RECEITAS"]);
    expect(ex.saida.resumo).toMatchObject({ alertas: 6, recomendacoes: 2 });
    // Etapa 3: cooperação real com a Inteligência (antes: nenhuma mensagem)
    expect(ex.mensagens.map((m) => [m.agenteDestino, m.tipo, m.status])).toEqual([["inteligencia", "DEMANDA_MEDIA", "RESPONDIDA"]]);
    expect(ex.filhas.map((f) => [f.agente, f.tipoExecucao, f.status])).toEqual([["inteligencia", "DEMANDA_MEDIA", "SUCESSO"]]);

    const rt = runtimeTeste();
    expect((await rt.executarAgente("estoque", { tipo: "DIAGNOSTICO" })).saida.toolsOk).toBe(true);
    expect((await rt.executarAgente("estoque", { tipo: "PING" })).saida).toEqual({ agente: "estoque", pong: true });
  });
});
