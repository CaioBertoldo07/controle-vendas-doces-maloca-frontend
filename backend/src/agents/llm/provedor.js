/**
 * Contrato de provedor de LLM (Etapa 1; estendido na Etapa 5), independente
 * de fornecedor:
 *
 *   provedor.nome: string
 *   provedor.modelo?: string
 *   provedor.gerar({ sistema, mensagens, tools?, formato?, maxTokens? }) → Promise<
 *       { tipo: "texto", texto, uso? }
 *     | { tipo: "tools", chamadas: [{ id, nome, entrada }], texto?, uso? }
 *   >
 *   uso = { modelo, tokensEntrada, tokensSaida } (quando o fornecedor informa)
 *
 * mensagens (formato neutro):
 *   { papel: "usuario",    conteudo: string }
 *   { papel: "assistente", conteudo: string, chamadas?: [{ id, nome, entrada }] }
 *   { papel: "tool",       chamadaId, nome, conteudo: <resultado padronizado da tool> }
 * tools: [{ nome, descricao, parametros (JSON Schema) }]: só DEFINIÇÕES, nunca
 *   funções, Prisma ou services. Quem executa a tool é o runtime (cicloTools.js).
 * formato (Etapa 5): JSON Schema da resposta. O provedor devolve { tipo:
 *   "texto", texto: <JSON> } e QUEM CHAMA valida (Zod): o roteamento nunca
 *   depende de texto livre.
 *
 * Falhas viram ErroLLM (llm/erros.js), com `transitorio` para distinguir o que
 * pode ser tentado de novo (rede, 429, 5xx) do que não pode (configuração,
 * credencial, recusa).
 *
 * Implementações: provedorFake.js (toda a suíte automatizada; sem rede) e
 * provedorAnthropic.js (real; SDK oficial). Os agentes nunca importam SDK.
 */
import { erro } from "../../lib/erros.js";
import { ErroLLM } from "./erros.js";

/** Valida a forma da resposta de um provedor (protege o runtime de adaptadores defeituosos). */
export function validarResposta(r) {
  if (r?.tipo === "texto" && typeof r.texto === "string") return r;
  if (r?.tipo === "tools" && Array.isArray(r.chamadas) && r.chamadas.length > 0
      && r.chamadas.every((c) => c && typeof c.id === "string" && typeof c.nome === "string")) return r;
  throw new ErroLLM("RESPOSTA_INVALIDA", "Resposta inválida do provedor de LLM");
}

/** Provedor que sempre falha com erro de configuração: o backend sobe; só a conversa fica indisponível. */
const provedorMalConfigurado = (motivo) => ({
  nome: "indisponivel",
  modelo: null,
  configuracaoInvalida: motivo,
  async gerar() {
    throw new ErroLLM("CONFIGURACAO", motivo);
  },
});

/**
 * Provedor do servidor, lido do ambiente:
 *   LLM_PROVIDER   vazio → nenhum (padrão) | "anthropic"
 *   LLM_MODEL      modelo (padrão claude-haiku-4-5)
 *   ANTHROPIC_API_KEY  credencial (convenção do SDK oficial)
 *   LLM_TIMEOUT_MS, LLM_MAX_RETRIES  limites por chamada
 * Em APP_ENV=test nunca há provedor real (a suíte só usa o fake e não usa rede).
 * Import dinâmico: sem LLM_PROVIDER, o SDK nem é carregado.
 */
export async function obterProvedorConfigurado(env = process.env) {
  if (env.APP_ENV === "test") return null;
  const nome = String(env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (!nome) return null;
  if (nome !== "anthropic") return provedorMalConfigurado(`LLM_PROVIDER desconhecido: "${nome}" (suportado: anthropic)`);
  if (!env.ANTHROPIC_API_KEY) return provedorMalConfigurado("LLM_PROVIDER=anthropic sem ANTHROPIC_API_KEY definida");
  const { criarProvedorAnthropic } = await import("./provedorAnthropic.js");
  return criarProvedorAnthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    modelo: env.LLM_MODEL || undefined,
    timeoutMs: Number(env.LLM_TIMEOUT_MS) || undefined,
    maxRetries: env.LLM_MAX_RETRIES !== undefined && env.LLM_MAX_RETRIES !== "" ? Number(env.LLM_MAX_RETRIES) : undefined,
  });
}

export const semProvedor = () => erro(503, "Nenhum provedor de LLM configurado");
