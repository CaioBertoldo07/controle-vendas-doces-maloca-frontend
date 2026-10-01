// Apoio aos testes da camada SMA (Etapa 1). O banco é o de TESTE (setup da
// suíte), limpo antes de cada teste, inclusive as tabelas SMA.
import { AGENTES_PADRAO, CATALOGO, criarRegistro, criarRuntime } from "../../src/agents/index.js";

/** Agente mínimo para testes do runtime. */
export const agenteTeste = (nome, executar, tools = []) => ({ nome, descricao: `agente de teste ${nome}`, tools, executar });

/**
 * Runtime com os agentes padrão, permitindo trocar agentes pelo nome
 * (`substituir`), acrescentar (`extras`), injetar um provedor de LLM, um
 * catálogo de tools e limites.
 */
export function runtimeTeste({ extras = [], substituir = [], provedorLLM = null, catalogo = CATALOGO, limiteMs, profundidadeMaxima } = {}) {
  const trocados = new Map(substituir.map((a) => [a.nome, a]));
  const registro = criarRegistro();
  for (const a of AGENTES_PADRAO) registro.registrar(trocados.get(a.nome) ?? a);
  for (const a of extras) registro.registrar(a);
  return criarRuntime({ registro, catalogo, provedorLLM, ...(limiteMs && { limiteMs }), ...(profundidadeMaxima && { profundidadeMaxima }) });
}

/** Executa e devolve o erro (para asserções sobre falhas controladas). */
export async function capturar(promessa) {
  try {
    await promessa;
  } catch (e) {
    return e;
  }
  throw new Error("era esperado um erro");
}
