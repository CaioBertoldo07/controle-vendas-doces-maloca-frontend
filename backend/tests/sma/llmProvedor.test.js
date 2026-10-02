// Etapa 5 — provedor real (Anthropic) testado SEM rede: cliente simulado
// injetado no adaptador; configuração lida do ambiente; bloqueio de rede da suíte.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { CODIGOS_LLM, ErroLLM } from "../../src/agents/llm/erros.js";
import { obterProvedorConfigurado } from "../../src/agents/llm/provedor.js";
import { MODELO_PADRAO, criarProvedorAnthropic, paraMensagensAnthropic, traduzirErro } from "../../src/agents/llm/provedorAnthropic.js";
import { capturar } from "./helpers.js";

const CHAVE_FICTICIA = "sk-ant-ficticia-da-suite-0000000000";
const clienteSimulado = (resposta) => {
  const pedidos = [];
  return { pedidos, messages: { create: async (p) => { pedidos.push(p); if (resposta instanceof Error) throw resposta; return resposta; } } };
};
const resposta = (content, extra = {}) => ({ model: "claude-haiku-4-5", stop_reason: "end_turn", content, usage: { input_tokens: 120, output_tokens: 30 }, ...extra });

describe("tradução para a Messages API", () => {
  it("mensagens neutras → MessageParam: tool_use no assistente e tool_result agrupados numa mensagem de usuário", () => {
    const m = paraMensagensAnthropic([
      { papel: "usuario", conteudo: "Como está o estoque?" },
      { papel: "assistente", conteudo: "Vou consultar.", chamadas: [{ id: "t1", nome: "a", entrada: { x: 1 } }, { id: "t2", nome: "b", entrada: {} }] },
      { papel: "tool", chamadaId: "t1", nome: "a", conteudo: { ok: true, dados: { n: 1 } } },
      { papel: "tool", chamadaId: "t2", nome: "b", conteudo: { ok: false, erro: { codigo: "X" } } },
    ]);
    expect(m).toEqual([
      { role: "user", content: "Como está o estoque?" },
      { role: "assistant", content: [{ type: "text", text: "Vou consultar." }, { type: "tool_use", id: "t1", name: "a", input: { x: 1 } }, { type: "tool_use", id: "t2", name: "b", input: {} }] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: '{"ok":true,"dados":{"n":1}}' },
        { type: "tool_result", tool_use_id: "t2", content: '{"ok":false,"erro":{"codigo":"X"}}', is_error: true },
      ] },
    ]);
  });

  it("formato → output_config.format json_schema; sem tool_choice forçado nem temperature; uso de tokens mapeado", async () => {
    const cliente = clienteSimulado(resposta([{ type: "text", text: '{"ok":true}' }]));
    const p = criarProvedorAnthropic({ cliente });
    const esquema = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
    const r = await p.gerar({ sistema: "S", mensagens: [{ papel: "usuario", conteudo: "oi" }], formato: esquema, maxTokens: 300 });
    expect(r).toEqual({ tipo: "texto", texto: '{"ok":true}', uso: { modelo: "claude-haiku-4-5", tokensEntrada: 120, tokensSaida: 30 } });
    expect(cliente.pedidos[0]).toEqual({ model: MODELO_PADRAO, max_tokens: 300, system: "S", messages: [{ role: "user", content: "oi" }], output_config: { format: { type: "json_schema", schema: esquema } } });
    expect(p).toMatchObject({ nome: "anthropic", modelo: "claude-haiku-4-5" });
  });

  it("tools → input_schema; resposta com tool_use vira chamadas", async () => {
    const cliente = clienteSimulado(resposta([{ type: "text", text: "" }, { type: "tool_use", id: "tu_1", name: "consultarX", input: { a: 1 } }], { stop_reason: "tool_use" }));
    const r = await criarProvedorAnthropic({ cliente, modelo: "claude-sonnet-5-5" }).gerar({ mensagens: [{ papel: "usuario", conteudo: "x" }], tools: [{ nome: "consultarX", descricao: "d", parametros: { type: "object" } }] });
    expect(cliente.pedidos[0]).toMatchObject({ model: "claude-sonnet-5-5", tools: [{ name: "consultarX", description: "d", input_schema: { type: "object" } }] });
    expect(cliente.pedidos[0]).not.toHaveProperty("tool_choice");
    expect(r).toMatchObject({ tipo: "tools", chamadas: [{ id: "tu_1", nome: "consultarX", entrada: { a: 1 } }] });
  });

  it.each([
    ["recusa", { stop_reason: "refusal" }, CODIGOS_LLM.RECUSA],
    ["corte por max_tokens", { stop_reason: "max_tokens" }, CODIGOS_LLM.LIMITE_TOKENS],
  ])("%s → ErroLLM %s", async (_, extra, codigo) => {
    const e = await capturar(criarProvedorAnthropic({ cliente: clienteSimulado(resposta([{ type: "text", text: "x" }], extra)) }).gerar({ mensagens: [{ papel: "usuario", conteudo: "x" }] }));
    expect(e).toMatchObject({ name: "ErroLLM", codigo });
  });
});

describe("erros do SDK → ErroLLM (transitório ou não), sem vazar a chave", () => {
  const h = new Headers();
  it.each([
    ["429", () => new Anthropic.RateLimitError(429, {}, "rate", h), CODIGOS_LLM.INDISPONIVEL, true],
    ["529 sobrecarga", () => new Anthropic.InternalServerError(529, {}, "overloaded", h), CODIGOS_LLM.INDISPONIVEL, true],
    ["rede", () => new Anthropic.APIConnectionError({ message: "ECONNRESET" }), CODIGOS_LLM.INDISPONIVEL, true],
    ["tempo", () => new Anthropic.APIConnectionTimeoutError({ message: "timeout" }), CODIGOS_LLM.TEMPO_ESGOTADO, true],
    ["401", () => new Anthropic.AuthenticationError(401, {}, `invalid x-api-key ${CHAVE_FICTICIA}`, h), CODIGOS_LLM.CREDENCIAL, false],
    ["400", () => new Anthropic.BadRequestError(400, {}, "bad", h), CODIGOS_LLM.REQUISICAO, false],
  ])("%s", async (_, criar, codigo, transitorio) => {
    const e = await capturar(criarProvedorAnthropic({ cliente: clienteSimulado(criar()) }).gerar({ mensagens: [{ papel: "usuario", conteudo: "x" }] }));
    expect(e).toBeInstanceOf(ErroLLM);
    expect(e).toMatchObject({ codigo, transitorio });
    expect(e.message).not.toContain(CHAVE_FICTICIA);
    expect(traduzirErro(e)).toBe(e);
  });
});

describe("configuração pelo ambiente", () => {
  it("sem LLM_PROVIDER, ou em APP_ENV=test: nenhum provedor (a conversa fica indisponível; o resto funciona)", async () => {
    expect(await obterProvedorConfigurado({})).toBeNull();
    expect(await obterProvedorConfigurado({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: CHAVE_FICTICIA, APP_ENV: "test" })).toBeNull();
    expect(await obterProvedorConfigurado(process.env)).toBeNull(); // o próprio processo da suíte
  });

  it("anthropic sem chave ou provedor desconhecido: erro de configuração claro só ao conversar (o backend sobe)", async () => {
    for (const env of [{ LLM_PROVIDER: "anthropic" }, { LLM_PROVIDER: "outro" }]) {
      const p = await obterProvedorConfigurado(env);
      expect(p).toMatchObject({ nome: "indisponivel" });
      expect(await capturar(p.gerar({ mensagens: [] }))).toMatchObject({ codigo: CODIGOS_LLM.CONFIGURACAO });
    }
  });

  it("anthropic com chave: modelo padrão claude-haiku-4-5 ou LLM_MODEL; a chave não aparece no objeto do provedor", async () => {
    const p = await obterProvedorConfigurado({ LLM_PROVIDER: "Anthropic", ANTHROPIC_API_KEY: CHAVE_FICTICIA });
    expect(p).toMatchObject({ nome: "anthropic", modelo: "claude-haiku-4-5" });
    expect(JSON.stringify(p)).not.toContain(CHAVE_FICTICIA);
    expect((await obterProvedorConfigurado({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: CHAVE_FICTICIA, LLM_MODEL: "claude-opus-5-5" })).modelo).toBe("claude-opus-5-5");
  });

  it("a suíte não tem rede: o SDK real (chave fictícia) falha como INDISPONIVEL, sem tocar a internet", async () => {
    await expect(fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow(/Rede externa bloqueada/);
    const real = criarProvedorAnthropic({ apiKey: CHAVE_FICTICIA, maxRetries: 0, timeoutMs: 2000 });
    expect(await capturar(real.gerar({ mensagens: [{ papel: "usuario", conteudo: "oi" }] }))).toMatchObject({ codigo: CODIGOS_LLM.INDISPONIVEL, transitorio: true });
  });
});
