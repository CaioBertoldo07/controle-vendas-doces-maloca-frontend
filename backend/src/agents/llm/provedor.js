/**
 * Contrato de provedor de LLM (Etapa 1), independente de fornecedor:
 *
 *   provedor.nome: string
 *   provedor.gerar({ sistema, mensagens, tools }) → Promise<
 *       { tipo: "texto", texto, uso? }
 *     | { tipo: "tools", chamadas: [{ id, nome, entrada }], texto?, uso? }
 *   >
 *
 * mensagens (formato neutro):
 *   { papel: "usuario",    conteudo: string }
 *   { papel: "assistente", conteudo: string, chamadas?: [{ id, nome, entrada }] }
 *   { papel: "tool",       chamadaId, nome, conteudo: <resultado padronizado da tool> }
 * tools: [{ nome, descricao, parametros (JSON Schema) }]: só DEFINIÇÕES, nunca
 *   funções, Prisma ou services. Quem executa a tool é o runtime (cicloTools.js).
 *
 * Um adaptador real (OpenAI, Claude...) traduz esse formato para o SDK ou a API
 * do fornecedor. Nesta etapa só existe o provedor fake (testes); nenhum
 * provedor real está configurado, e por isso a suíte não depende de rede nem
 * gera custo.
 */
import { erro } from "../../lib/erros.js";

/** Valida a forma da resposta de um provedor (protege o runtime de adaptadores defeituosos). */
export function validarResposta(r) {
  if (r?.tipo === "texto" && typeof r.texto === "string") return r;
  if (r?.tipo === "tools" && Array.isArray(r.chamadas) && r.chamadas.length > 0
      && r.chamadas.every((c) => c && typeof c.id === "string" && typeof c.nome === "string")) return r;
  throw new Error("Resposta inválida do provedor de LLM");
}

/** Provedor configurado para o servidor. Etapa 1: nenhum (retorna null). */
export function obterProvedorConfigurado() {
  return null;
}

export const semProvedor = () => erro(503, "Nenhum provedor de LLM configurado");
