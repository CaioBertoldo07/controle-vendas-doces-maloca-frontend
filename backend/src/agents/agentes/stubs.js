// Agentes especializados (Etapa 1): STUBS TÉCNICOS. Validam runtime, tools,
// mensagens e LLM; não têm regra de domínio (que vem na Etapa 2 em diante).
//   PING        → resposta imediata, sem tools
//   DIAGNOSTICO → chama as tools de diagnóstico e devolve se funcionaram
//   PERGUNTA    → raciocínio com o LLM configurado, só com as tools do agente
import { erro } from "../../lib/erros.js";

function stubTecnico({ nome, descricao, tools, diagnostico }) {
  return {
    nome,
    descricao,
    tools,
    async executar(contexto) {
      const { tipo, dados = {} } = contexto.entrada ?? {};
      switch (tipo) {
        case "PING":
          return { agente: nome, pong: true };
        case "DIAGNOSTICO": {
          const resultados = {};
          for (const tool of diagnostico) {
            const r = await contexto.usarTool(tool, {});
            resultados[tool] = r.ok ? "ok" : r.erro.codigo;
          }
          return { agente: nome, toolsOk: Object.values(resultados).every((v) => v === "ok"), tools: resultados };
        }
        case "PERGUNTA": {
          if (typeof dados.pergunta !== "string" || !dados.pergunta.trim()) throw erro(400, "PERGUNTA exige dados.pergunta");
          const r = await contexto.raciocinar({
            sistema: `Você é o agente "${nome}" do Doces da Maloca (stub técnico). Use apenas as tools disponíveis; todos os números vêm delas.`,
            mensagens: [{ papel: "usuario", conteudo: dados.pergunta }],
          });
          return { agente: nome, resposta: r.texto, passos: r.passos, chamadas: r.chamadas };
        }
        default:
          throw erro(400, `Tipo de execução não suportado pelo agente ${nome}: "${tipo}"`);
      }
    },
  };
}

export const estoque = stubTecnico({
  nome: "estoque",
  descricao: "Agente de Estoque (stub técnico): estoque acabado, matéria-prima e necessidades de produção.",
  tools: ["consultarEstoqueAcabado", "consultarSaldoMateriasPrimas", "calcularNecessidadesProducao", "consultarResumoProducao", "proporAcao"],
  diagnostico: ["consultarEstoqueAcabado", "consultarSaldoMateriasPrimas"],
});

export const vendas = stubTecnico({
  nome: "vendas",
  descricao: "Agente de Vendas (stub técnico): vendas por período, recebíveis, clientes e ranking.",
  tools: ["consultarVendasPeriodo", "consultarRecebiveis", "consultarRankingSabores", "consultarEstatisticasCliente", "proporAcao"],
  diagnostico: ["consultarRecebiveis", "consultarRankingSabores"],
});

export const inteligencia = stubTecnico({
  nome: "inteligencia",
  descricao: "Agente de Inteligência (stub técnico): indicadores de produção e vendas.",
  tools: ["consultarResumoProducao", "consultarVendasPeriodo", "consultarEstoqueAcabado"],
  diagnostico: ["consultarResumoProducao"],
});

/**
 * Agente de Atendimento: interface de entrada do gestor (stub). Por enquanto,
 * encaminha um pedido de diagnóstico ao Coordenador; a conversa com LLM vem
 * na Etapa 5.
 */
export const atendimento = {
  nome: "atendimento",
  descricao: "Agente de Atendimento (stub técnico): porta de entrada do gestor; encaminha ao Coordenador.",
  tools: [],
  async executar(contexto) {
    const { tipo } = contexto.entrada ?? {};
    if (tipo === "PING") return { agente: "atendimento", pong: true };
    if (tipo === "SOLICITAR_DIAGNOSTICO") {
      const resposta = await contexto.enviarMensagem({ para: "coordenador", tipo: "DIAGNOSTICO_GERAL", dados: {} });
      return { agente: "atendimento", encaminhadoPara: "coordenador", resposta };
    }
    throw erro(400, `Tipo de execução não suportado pelo agente atendimento: "${tipo}"`);
  },
};
