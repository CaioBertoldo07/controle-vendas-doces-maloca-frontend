// Etapa 1 — registry e runtime de agentes (nível A, sem HTTP, banco de teste).
import { describe, expect, it } from "vitest";
import { criarRegistro, criarRegistroPadrao } from "../../src/agents/index.js";
import { criarBarramento } from "../../src/agents/runtime/barramento.js";
import { ErroExecucaoAgente } from "../../src/agents/runtime/util.js";
import { ErroDominio } from "../../src/lib/erros.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { agenteTeste, capturar, runtimeTeste } from "./helpers.js";

describe("registro de agentes", () => {
  it("registra e lista os agentes do sistema (coordenador + 4 especializados)", () => {
    const nomes = criarRegistroPadrao().listar().map((a) => a.nome);
    expect(nomes).toEqual(["coordenador", "estoque", "vendas", "inteligencia", "atendimento"]);
  });

  it("localiza por nome; a listagem não expõe a função executar", () => {
    const r = criarRegistro().registrar(agenteTeste("eco", async () => "ok", ["consultarEstoqueAcabado"]));
    expect(r.obter("eco").nome).toBe("eco");
    expect(r.listar()).toEqual([{ nome: "eco", descricao: "agente de teste eco", tools: ["consultarEstoqueAcabado"] }]);
  });

  it("nome duplicado é recusado", () => {
    const r = criarRegistro().registrar(agenteTeste("eco", async () => 1));
    expect(() => r.registrar(agenteTeste("eco", async () => 2))).toThrow('Agente já registrado: "eco"');
  });

  it("agente inexistente → ErroDominio 404", () => {
    const e = (() => { try { criarRegistro().obter("fantasma"); } catch (x) { return x; } })();
    expect(e).toBeInstanceOf(ErroDominio);
    expect(e.status).toBe(404);
  });

  it.each([
    ["sem executar", { nome: "x1", descricao: "d", tools: [] }],
    ["nome inválido", { nome: "Com Espaço", descricao: "d", tools: [], executar: () => 1 }],
    ["sem descrição", { nome: "x2", descricao: " ", tools: [], executar: () => 1 }],
    ["tools que não é lista de nomes", { nome: "x3", descricao: "d", tools: [1], executar: () => 1 }],
  ])("contrato inválido (%s) é recusado", (_, agente) => {
    expect(() => criarRegistro().registrar(agente)).toThrow();
  });
});

describe("runtime: execução e auditoria", () => {
  it("sucesso: devolve a saída e persiste SUCESSO, entrada, saída, gatilho, tipo e duração", async () => {
    const rt = runtimeTeste({ extras: [agenteTeste("eco", async (ctx) => ({ recebi: ctx.entrada.dados }))] });
    const r = await rt.executarAgente("eco", { tipo: "TESTE", dados: { x: 1 } }, { gatilho: "HTTP" });
    expect(r).toMatchObject({ agente: "eco", status: "SUCESSO", saida: { recebi: { x: 1 } } });
    const ex = await prisma.execucaoAgente.findUnique({ where: { id: r.execucaoId } });
    expect(ex).toMatchObject({ agente: "eco", tipoExecucao: "TESTE", gatilho: "HTTP", status: "SUCESSO", erro: null });
    expect(ex.entrada).toEqual({ tipo: "TESTE", dados: { x: 1 } });
    expect(ex.saida).toEqual({ recebi: { x: 1 } });
    expect(ex.finalizadaEm).not.toBeNull();
    expect(ex.duracaoMs).toBeGreaterThanOrEqual(0);
  });

  it("erro do agente: FALHA registrada (nunca fica EM_ANDAMENTO) e propagada de forma controlada", async () => {
    const rt = runtimeTeste({ extras: [agenteTeste("quebra", async () => { throw new Error("detalhe interno\n    at stack trace"); })] });
    const e = await capturar(rt.executarAgente("quebra", { tipo: "TESTE" }));
    expect(e).toBeInstanceOf(ErroExecucaoAgente);
    expect(e.status).toBe(500);
    expect(e.corpo).toEqual({ error: 'Falha na execução do agente "quebra"', execucaoId: e.execucaoId });
    const ex = await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } });
    expect(ex).toMatchObject({ status: "FALHA", erro: "detalhe interno" }); // sem a stack
    expect(ex.finalizadaEm).not.toBeNull();
    expect(await prisma.execucaoAgente.count({ where: { status: "EM_ANDAMENTO" } })).toBe(0);
  });

  it("limite de tempo: execução lenta vira FALHA com 'Tempo esgotado'", async () => {
    const lento = agenteTeste("lento", () => new Promise((r) => setTimeout(() => r("tarde"), 400)));
    const rt = runtimeTeste({ extras: [lento], limiteMs: 50 });
    const e = await capturar(rt.executarAgente("lento", { tipo: "TESTE" }));
    const ex = await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } });
    expect(ex.status).toBe("FALHA");
    expect(ex.erro).toMatch(/^Tempo esgotado: agente lento passou de 50 ms/);
  });

  it("agente inexistente → 404 e nenhuma execução registrada", async () => {
    const e = await capturar(runtimeTeste().executarAgente("fantasma", { tipo: "PING" }));
    expect(e.status).toBe(404);
    expect(await prisma.execucaoAgente.count()).toBe(0);
  });

  it("o agente só recebe o contexto: sem Prisma nem services, e imutável", async () => {
    let visto;
    const rt = runtimeTeste({ extras: [agenteTeste("espiao", async (ctx) => { visto = ctx; return Object.keys(ctx); })] });
    const { saida } = await rt.executarAgente("espiao", { tipo: "TESTE" });
    expect(saida.sort()).toEqual(
      // Etapa 5: + gerarLLM (uma chamada ao LLM, sem tools) e provedorLLM (só nome e modelo, nunca o objeto)
      ["agente", "encerrarRecomendacoesAusentes", "entrada", "enviarMensagem", "execucaoId", "gerarLLM", "profundidade", "provedorLLM", "raciocinar", "registrarRecomendacao", "toolsPermitidas", "usarTool"].sort(),
    );
    expect(Object.isFrozen(visto)).toBe(true);
  });

  // Etapa 2: o limite da SAÍDA de execução subiu para 32.000 caracteres (análise do Agente de Estoque).
  it("saída grande é guardada truncada na auditoria (a execução não falha)", async () => {
    const rt = runtimeTeste({ extras: [agenteTeste("grande", async () => ({ texto: "x".repeat(40000) }))] });
    const r = await rt.executarAgente("grande", { tipo: "TESTE" });
    const ex = await prisma.execucaoAgente.findUnique({ where: { id: r.execucaoId } });
    expect(ex.saida).toMatchObject({ _truncado: true });
    expect(r.saida.texto).toHaveLength(40000);
  });
});

describe("runtime: recomendações", () => {
  it("registrarRecomendacao grava ABERTA com agente e execução; inválida faz a execução falhar", async () => {
    const recomenda = agenteTeste("recomenda", async (ctx) =>
      ctx.registrarRecomendacao({ tipo: "TESTE", titulo: "Repor coco", descricao: "Saldo abaixo do usual", prioridade: "ALTA", dados: { saborId: 1 } }));
    const invalida = agenteTeste("invalida", async (ctx) => ctx.registrarRecomendacao({ titulo: "x" }));
    const rt = runtimeTeste({ extras: [recomenda, invalida] });
    const { execucaoId } = await rt.executarAgente("recomenda", { tipo: "TESTE" });
    const rec = await prisma.recomendacao.findFirst();
    expect(rec).toMatchObject({ agente: "recomenda", execucaoId, status: "ABERTA", prioridade: "ALTA", dados: { saborId: 1 } });
    expect((await capturar(rt.executarAgente("invalida", { tipo: "TESTE" }))).status).toBe(500);
    expect(await prisma.recomendacao.count()).toBe(1);
  });
});

describe("barramento de eventos in-process (interface)", () => {
  it("entrega aos assinantes do tipo; a falha de um não impede os outros; cancelar assinatura", async () => {
    const b = criarBarramento();
    const recebidos = [];
    const cancelar = b.assinar("VENDA_CRIADA", (d) => recebidos.push(d.id));
    b.assinar("VENDA_CRIADA", () => { throw new Error("falhou"); });
    expect(await b.publicar("VENDA_CRIADA", { id: 7 })).toEqual({ entregues: 2, falhas: 1 });
    cancelar();
    await b.publicar("VENDA_CRIADA", { id: 8 });
    expect(recebidos).toEqual([7]);
    expect(await b.publicar("OUTRO", {})).toEqual({ entregues: 0, falhas: 0 });
  });
});
