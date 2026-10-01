// Registro explícito de agentes (Etapa 1).
import { erro } from "../../lib/erros.js";

const NOME_VALIDO = /^[a-z][a-z0-9_-]{1,49}$/;

/**
 * Contrato de agente (por convenção):
 *   { nome, descricao, tools: [nomes de tools permitidas], executar(contexto) }
 * O agente só enxerga o `contexto` (tools permitidas, mensagens, recomendações,
 * LLM); nunca o Prisma nem os services.
 */
export function criarRegistro() {
  const agentes = new Map();

  return {
    registrar(agente) {
      if (!agente || typeof agente !== "object") throw new Error("Agente inválido");
      const { nome, descricao, tools = [], executar } = agente;
      if (!NOME_VALIDO.test(nome ?? "")) throw new Error(`Nome de agente inválido: "${nome}"`);
      if (typeof descricao !== "string" || !descricao.trim()) throw new Error(`Agente "${nome}" sem descrição`);
      if (typeof executar !== "function") throw new Error(`Agente "${nome}" sem função executar`);
      if (!Array.isArray(tools) || tools.some((t) => typeof t !== "string")) throw new Error(`Agente "${nome}": tools deve ser uma lista de nomes`);
      if (agentes.has(nome)) throw new Error(`Agente já registrado: "${nome}"`);
      agentes.set(nome, Object.freeze({ nome, descricao, tools: Object.freeze([...tools]), executar }));
      return this;
    },

    /** Agente pelo nome; inexistente → ErroDominio 404. */
    obter(nome) {
      const agente = agentes.get(nome);
      if (!agente) throw erro(404, `Agente inexistente: "${nome}"`);
      return agente;
    },

    existe: (nome) => agentes.has(nome),

    listar: () => [...agentes.values()].map(({ nome, descricao, tools }) => ({ nome, descricao, tools: [...tools] })),
  };
}
