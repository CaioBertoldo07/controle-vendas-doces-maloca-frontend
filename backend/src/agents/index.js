// Ponto de entrada da camada SMA (Etapa 1).
//
//   HTTP /api/agentes → controller → runtime → agentes → tools → services → Prisma
//
// A camada consome os services diretamente, no mesmo processo (sem chamadas
// HTTP ao próprio backend). O LLM só aparece através de `contexto.raciocinar`,
// que oferece definições de tools; quem executa é o runtime.
import { coordenador } from "./agentes/coordenador.js";
import { estoque } from "./agentes/estoque/index.js";
import { atendimento, inteligencia, vendas } from "./agentes/stubs.js";
import { obterProvedorConfigurado } from "./llm/provedor.js";
import { criarRegistro } from "./runtime/registro.js";
import { criarRuntime } from "./runtime/runtime.js";
import { CATALOGO } from "./tools/index.js";

export const AGENTES_PADRAO = [coordenador, estoque, vendas, inteligencia, atendimento];

/** Registro com os agentes do sistema (novo a cada chamada; útil em testes). */
export function criarRegistroPadrao() {
  const registro = criarRegistro();
  for (const agente of AGENTES_PADRAO) registro.registrar(agente);
  return registro;
}

/** Runtime usado pelo servidor HTTP. */
export const runtimePadrao = criarRuntime({
  registro: criarRegistroPadrao(),
  catalogo: CATALOGO,
  provedorLLM: obterProvedorConfigurado(),
});

export { criarRegistro, criarRuntime, CATALOGO };
