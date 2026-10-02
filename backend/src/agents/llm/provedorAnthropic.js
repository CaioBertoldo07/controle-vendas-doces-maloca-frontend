// Provedor real (Etapa 5): Claude pela API da Anthropic, com o SDK oficial
// (@anthropic-ai/sdk). Só este arquivo conhece o SDK: traduz o contrato neutro
// de provedor.js para a Messages API e de volta.
//
//   mensagens neutras → messages (tool_result agrupados numa mensagem de usuário)
//   tools             → tools [{ name, description, input_schema }]
//   formato           → output_config.format (json_schema): resposta JSON validada pelo modelo
//
// Sem tool_choice forçado (any/tool): modelos recentes o rejeitam (400) e o
// LLM_MODEL é configurável. Sem temperature (também rejeitado nos recentes).
// Retentativa: só a do SDK (maxRetries), que cobre rede, 408/409/429 e 5xx;
// esta camada não repete chamadas. A chave nunca aparece em erro ou log.
import Anthropic from "@anthropic-ai/sdk";
import { CODIGOS_LLM, ErroLLM } from "./erros.js";

export const MODELO_PADRAO = "claude-haiku-4-5";
const TIMEOUT_PADRAO_MS = 20000;
const MAX_RETRIES_PADRAO = 1;
const MAX_TOKENS_PADRAO = 2048;

/** Mensagens neutras → MessageParam[] (resultados de tools consecutivos viram uma única mensagem de usuário). */
export function paraMensagensAnthropic(mensagens) {
  const saida = [];
  for (const m of mensagens) {
    if (m.papel === "usuario") {
      saida.push({ role: "user", content: m.conteudo });
    } else if (m.papel === "assistente") {
      const blocos = [];
      if (m.conteudo) blocos.push({ type: "text", text: m.conteudo });
      for (const c of m.chamadas ?? []) blocos.push({ type: "tool_use", id: c.id, name: c.nome, input: c.entrada ?? {} });
      saida.push({ role: "assistant", content: blocos.length ? blocos : m.conteudo });
    } else if (m.papel === "tool") {
      const bloco = { type: "tool_result", tool_use_id: m.chamadaId, content: JSON.stringify(m.conteudo), ...(m.conteudo?.ok === false && { is_error: true }) };
      const anterior = saida.at(-1);
      if (anterior?.role === "user" && Array.isArray(anterior.content) && anterior.content.every((b) => b.type === "tool_result")) anterior.content.push(bloco);
      else saida.push({ role: "user", content: [bloco] });
    }
  }
  return saida;
}

/** Erro do SDK → ErroLLM (mais específico primeiro; APIConnectionError é subclasse de APIError no SDK TS). */
export function traduzirErro(e) {
  if (e instanceof ErroLLM) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ErroLLM(CODIGOS_LLM.TEMPO_ESGOTADO, "O provedor de LLM não respondeu no tempo limite");
  if (e instanceof Anthropic.APIConnectionError) return new ErroLLM(CODIGOS_LLM.INDISPONIVEL, "Falha de conexão com o provedor de LLM");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ErroLLM(CODIGOS_LLM.CREDENCIAL, "Credencial do provedor de LLM recusada");
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return new ErroLLM(CODIGOS_LLM.INDISPONIVEL, "Provedor de LLM temporariamente indisponível");
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || (e.status ?? 0) >= 500) return new ErroLLM(CODIGOS_LLM.INDISPONIVEL, "Provedor de LLM temporariamente indisponível");
    return new ErroLLM(CODIGOS_LLM.REQUISICAO, `Requisição recusada pelo provedor de LLM (HTTP ${e.status ?? "?"})`);
  }
  return new ErroLLM(CODIGOS_LLM.INDISPONIVEL, "Falha inesperada ao chamar o provedor de LLM");
}

/**
 * @param cliente injeção para testes (objeto com messages.create); sem ele, cria o
 *                cliente oficial com a chave informada.
 */
export function criarProvedorAnthropic({ apiKey, modelo = MODELO_PADRAO, timeoutMs = TIMEOUT_PADRAO_MS, maxRetries = MAX_RETRIES_PADRAO, cliente } = {}) {
  const api = cliente ?? new Anthropic({ apiKey, timeout: timeoutMs, maxRetries });

  return Object.freeze({
    nome: "anthropic",
    modelo,
    async gerar({ sistema, mensagens, tools = [], formato, maxTokens = MAX_TOKENS_PADRAO }) {
      const requisicao = {
        model: modelo,
        max_tokens: maxTokens,
        ...(sistema && { system: sistema }),
        messages: paraMensagensAnthropic(mensagens),
        ...(tools.length > 0 && { tools: tools.map((t) => ({ name: t.nome, description: t.descricao, input_schema: t.parametros })) }),
        ...(formato && { output_config: { format: { type: "json_schema", schema: formato } } }),
      };
      let r;
      try {
        r = await api.messages.create(requisicao);
      } catch (e) {
        throw traduzirErro(e);
      }

      const uso = { modelo: r.model ?? modelo, tokensEntrada: r.usage?.input_tokens ?? null, tokensSaida: r.usage?.output_tokens ?? null };
      if (r.stop_reason === "refusal") throw new ErroLLM(CODIGOS_LLM.RECUSA, "O modelo recusou a solicitação");
      if (r.stop_reason === "max_tokens") throw new ErroLLM(CODIGOS_LLM.LIMITE_TOKENS, "Resposta do modelo cortada pelo limite de tokens");

      const texto = (r.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const chamadas = (r.content ?? []).filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, nome: b.name, entrada: b.input ?? {} }));
      return chamadas.length > 0 ? { tipo: "tools", chamadas, texto, uso } : { tipo: "texto", texto, uso };
    },
  });
}
