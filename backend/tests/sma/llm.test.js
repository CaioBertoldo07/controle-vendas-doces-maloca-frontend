// Etapa 1 — adaptador de LLM com provedor fake (sem rede, sem custo):
// texto, tool call, várias tool calls, erro, timeout lógico e limites.
import { describe, expect, it } from "vitest";
import { criarProvedorFake } from "../../src/agents/llm/provedorFake.js";
import { runtimePadrao } from "../../src/agents/index.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { cenarioReceitaBasica, criarCliente, criarSabor } from "../caracterizacao/helpers/fixtures.js";
import { agenteTeste, capturar, runtimeTeste } from "./helpers.js";

const perguntar = (rt, pergunta = "Como está o estoque?") => rt.executarAgente("estoque", { tipo: "PERGUNTA", dados: { pergunta } });
const erroDaExecucao = async (e) => (await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } })).erro;

describe("provedor fake e ciclo de tool calling", () => {
  it("resposta textual direta; o provedor recebe só DEFINIÇÕES das tools permitidas ao agente", async () => {
    const llm = criarProvedorFake([{ texto: "Tudo certo." }]);
    const r = await perguntar(runtimeTeste({ provedorLLM: llm }));
    expect(r.saida).toEqual({ agente: "estoque", resposta: "Tudo certo.", passos: 1, chamadas: [] });
    const [req] = llm.requisicoes;
    // Etapa 2: a allowlist do Agente de Estoque ganhou consultarReceitas e consultarProducaoVendasPeriodo
    expect(req.tools.map((t) => t.nome)).toEqual([
      "consultarEstoqueAcabado", "consultarSaldoMateriasPrimas", "consultarReceitas", "consultarProducaoVendasPeriodo",
      "calcularNecessidadesProducao", "consultarResumoProducao", "proporAcao",
    ]);
    expect(req.tools.every((t) => Object.keys(t).sort().join() === "descricao,nome,parametros")).toBe(true);
    expect(req.mensagens).toEqual([{ papel: "usuario", conteudo: "Como está o estoque?" }]);
    expect((await prisma.execucaoAgente.findFirst()).metadados).toMatchObject({ provedorLLM: "fake" });
  });

  it("tool call: o runtime executa a tool (auditada como LLM) e devolve o resultado ao provedor", async () => {
    const { sabor } = await cenarioReceitaBasica();
    const llm = criarProvedorFake([
      { chamadas: [{ id: "c1", nome: "calcularNecessidadesProducao", entrada: { sabores: [{ saborId: sabor.id, quantidade: 100 }] } }] },
      (req) => ({ texto: `Precisa de ${req.mensagens.at(-1).conteudo.dados.necessidades[0].quantidade} g de açúcar.` }),
    ]);
    const r = await perguntar(runtimeTeste({ provedorLLM: llm }), "Quanto açúcar para 100 cocadas?");
    expect(r.saida.resposta).toBe("Precisa de 1000 g de açúcar."); // número veio da tool, não do LLM
    expect(r.saida.chamadas).toEqual([{ nome: "calcularNecessidadesProducao", ok: true }]);
    expect(llm.requisicoes[1].mensagens.at(-1)).toMatchObject({ papel: "tool", chamadaId: "c1", nome: "calcularNecessidadesProducao", conteudo: { ok: true } });
    expect(await prisma.chamadaTool.findFirst()).toMatchObject({ tool: "calcularNecessidadesProducao", origem: "LLM", ok: true, execucaoId: r.execucaoId });
  });

  it("várias tool calls num passo, inclusive uma fora da allowlist (TOOL_NAO_PERMITIDA volta ao LLM)", async () => {
    const llm = criarProvedorFake([
      { chamadas: [{ nome: "consultarEstoqueAcabado" }, { nome: "consultarSaldoMateriasPrimas" }, { nome: "consultarRecebiveis" }] },
      { texto: "Feito." },
    ]);
    const r = await perguntar(runtimeTeste({ provedorLLM: llm }));
    expect(r.saida.chamadas).toEqual([
      { nome: "consultarEstoqueAcabado", ok: true },
      { nome: "consultarSaldoMateriasPrimas", ok: true },
      { nome: "consultarRecebiveis", ok: false, codigo: "TOOL_NAO_PERMITIDA" },
    ]);
    expect(await prisma.chamadaTool.count({ where: { origem: "LLM" } })).toBe(3);
  });

  it("entrada inválida vinda do LLM volta como erro estruturado, e ele pode corrigir", async () => {
    const llm = criarProvedorFake([
      { chamadas: [{ nome: "consultarResumoProducao", entrada: { mes: 13 } }] },
      (req) => ({ chamadas: [{ nome: "consultarResumoProducao", entrada: req.mensagens.at(-1).conteudo.ok ? {} : { mes: 3, ano: 2026 } }] }),
      { texto: "Resumo obtido." },
    ]);
    const r = await perguntar(runtimeTeste({ provedorLLM: llm }));
    expect(r.saida.chamadas).toEqual([{ nome: "consultarResumoProducao", ok: false, codigo: "ENTRADA_INVALIDA" }, { nome: "consultarResumoProducao", ok: true }]);
  });

  it("o LLM só PROPÕE: proporAcao cria PENDENTE e nenhuma venda", async () => {
    const cliente = await criarCliente("Mercearia Fictícia Aurora");
    const coco = await criarSabor({ nome: "Coco Fictício" });
    const llm = criarProvedorFake([
      { chamadas: [{ nome: "proporAcao", entrada: { tipo: "REGISTRAR_VENDA", descricao: "Gestor relatou venda", payload: { clienteId: cliente.id, sabores: [{ saborId: coco.id, quantidade: 4 }], valor: 22 } } }] },
      { texto: "Proposta criada, aguardando aprovação." },
    ]);
    await perguntar(runtimeTeste({ provedorLLM: llm }), "Vendi 4 cocos para a Aurora por 22");
    expect(await prisma.acaoProposta.findFirst()).toMatchObject({ status: "PENDENTE", criadaPorAgente: "estoque" });
    expect(await prisma.venda.count()).toBe(0);
  });
});

describe("falhas do LLM viram FALHA controlada da execução", () => {
  it("erro do provedor", async () => {
    const e = await capturar(perguntar(runtimeTeste({ provedorLLM: criarProvedorFake([{ erro: "rate limit" }]) })));
    expect(await erroDaExecucao(e)).toBe("rate limit");
  });

  it("timeout lógico do provedor (limite do ciclo LLM)", async () => {
    const llm = criarProvedorFake([{ atrasoMs: 300, texto: "tarde demais" }]);
    const apressado = agenteTeste("apressado", (ctx) => ctx.raciocinar({ mensagens: [{ papel: "usuario", conteudo: "x" }], limiteMs: 50 }), ["consultarEstoqueAcabado"]);
    const e = await capturar(runtimeTeste({ provedorLLM: llm, extras: [apressado] }).executarAgente("apressado", { tipo: "TESTE" }));
    expect(await erroDaExecucao(e)).toBe("Tempo esgotado: provedor fake passou de 50 ms");
  });

  it("resposta malformada do provedor", async () => {
    const llm = { nome: "defeituoso", gerar: async () => ({ tipo: "tools", chamadas: [] }) };
    const e = await capturar(perguntar(runtimeTeste({ provedorLLM: llm })));
    expect(await erroDaExecucao(e)).toBe("Resposta inválida do provedor de LLM");
  });

  it("limite de passos (LLM que só pede tools)", async () => {
    const llm = criarProvedorFake(Array.from({ length: 10 }, () => ({ chamadas: [{ nome: "consultarEstoqueAcabado" }] })));
    const e = await capturar(perguntar(runtimeTeste({ provedorLLM: llm })));
    expect(await erroDaExecucao(e)).toBe("O LLM excedeu o limite de 6 passos sem responder");
  });

  it("servidor sem provedor configurado (Etapa 1) → FALHA explícita", async () => {
    const e = await capturar(perguntar(runtimePadrao));
    expect(await erroDaExecucao(e)).toBe("Nenhum provedor de LLM configurado");
  });
});
