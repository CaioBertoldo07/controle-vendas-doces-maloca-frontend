// Agente ainda STUB TÉCNICO (Etapa 1): atendimento. Estoque virou agente real
// na Etapa 2, Inteligência na Etapa 3 e Vendas na Etapa 4 (agentes/<nome>).
// O stub valida a cadeia Atendimento → Coordenador → especializados; não tem
// regra de domínio.
import { erro } from "../../lib/erros.js";

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
