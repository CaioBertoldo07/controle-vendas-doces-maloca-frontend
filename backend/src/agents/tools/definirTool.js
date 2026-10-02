// Contrato das tools (Etapa 1): adaptadores finos sobre os SERVICES (nunca
// controllers, nunca Prisma direto), com entrada validada por Zod.
//
// Resultado padronizado, que nunca lança para situações previstas:
//   { ok: true,  dados }
//   { ok: false, erro: { codigo, mensagem, detalhes? } }
// codigo: ENTRADA_INVALIDA | NAO_ENCONTRADO | AMBIGUO | CONFLITO |
//         REGRA_NEGOCIO | TOOL_INEXISTENTE | TOOL_NAO_PERMITIDA | ERRO_INTERNO
// Assim o LLM recebe o erro como dado e pode corrigir a chamada. Erros internos
// não expõem detalhes (a mensagem interna vai só para a auditoria).
import { z } from "zod";
import { ErroDominio } from "../../lib/erros.js";

/**
 * Cria uma tool imutável. `entrada` é um schema Zod (use .strict()).
 * `resumir(dados)` (opcional): o que vai para a auditoria (ChamadaTool.saida)
 * no lugar do resultado inteiro, para não guardar datasets grandes.
 */
export function definirTool({ nome, descricao, entrada, executar, escrita = false, resumir = null }) {
  if (!/^[a-z][A-Za-z0-9]{2,79}$/.test(nome ?? "")) throw new Error(`Nome de tool inválido: "${nome}"`);
  if (!descricao || typeof executar !== "function" || !(entrada instanceof z.ZodType)) {
    throw new Error(`Tool "${nome}" incompleta`);
  }
  const { $schema, ...parametros } = z.toJSONSchema(entrada);
  return Object.freeze({ nome, descricao, entrada, executar, escrita, resumir, parametros });
}

/** Definição exposta a um provedor de LLM (sem a função executora). */
export const paraLLM = (tool) => ({ nome: tool.nome, descricao: tool.descricao, parametros: tool.parametros });

function codigoDoErro(e) {
  if (e.corpo?.tipo === "AMBIGUO") return "AMBIGUO";
  if (e.status === 400) return "ENTRADA_INVALIDA";
  if (e.status === 404) return "NAO_ENCONTRADO";
  if (e.status === 409) return "CONFLITO";
  if (e.status === 422) return "REGRA_NEGOCIO";
  return "ERRO_INTERNO";
}

export const falha = (codigo, mensagem, detalhes) => ({ ok: false, erro: { codigo, mensagem, ...(detalhes !== undefined && { detalhes }) } });

/**
 * Valida a entrada e executa. Devolve { resultado, interno? }: `interno` é a
 * mensagem de um erro inesperado, só para a auditoria.
 */
export async function executarTool(tool, entradaBruta, contexto) {
  const validacao = tool.entrada.safeParse(entradaBruta ?? {});
  if (!validacao.success) {
    const detalhes = validacao.error.issues.map((i) => ({ campo: i.path.join(".") || "(raiz)", mensagem: i.message }));
    return { resultado: falha("ENTRADA_INVALIDA", `Entrada inválida para a tool ${tool.nome}`, detalhes) };
  }
  try {
    return { resultado: { ok: true, dados: await tool.executar(validacao.data, contexto) } };
  } catch (e) {
    if (e instanceof ErroDominio) {
      const { error, ...resto } = e.corpo ?? {};
      return { resultado: falha(codigoDoErro(e), error ?? e.message, Object.keys(resto).length ? resto : undefined) };
    }
    return { resultado: falha("ERRO_INTERNO", `Erro interno ao executar a tool ${tool.nome}`), interno: String(e?.message ?? e).split("\n")[0] };
  }
}
