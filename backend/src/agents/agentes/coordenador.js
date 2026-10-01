// Coordenador (Etapa 1, esqueleto): recebe uma INTENÇÃO estruturada (o `tipo`
// da entrada), delega por mensagem aos agentes da tabela de rotas e agrega as
// respostas. O roteamento é determinístico; o roteamento por LLM fica para
// depois. Cada delegação vira uma MensagemAgente e uma execução filha.
import { erro } from "../../lib/erros.js";

export const ROTAS = Object.freeze({
  DIAGNOSTICO_GERAL: ["estoque", "vendas", "inteligencia"],
  DIAGNOSTICO_ESTOQUE: ["estoque"],
  DIAGNOSTICO_VENDAS: ["vendas"],
  DIAGNOSTICO_INTELIGENCIA: ["inteligencia"],
});

export const coordenador = {
  nome: "coordenador",
  descricao: "Coordenador: encaminha intenções estruturadas aos agentes especializados e agrega as respostas.",
  tools: [],
  async executar(contexto) {
    const { tipo: intencao, dados = {} } = contexto.entrada ?? {};
    if (intencao === "PING") return { agente: "coordenador", pong: true };
    const destinos = ROTAS[intencao];
    if (!destinos) throw erro(400, `Intenção não suportada pelo coordenador: "${intencao}"`);

    const respostas = {};
    const falhas = [];
    for (const para of destinos) {
      try {
        respostas[para] = await contexto.enviarMensagem({ para, tipo: "DIAGNOSTICO", dados });
      } catch (e) {
        falhas.push({ agente: para, execucaoId: e.execucaoId ?? null });
      }
    }
    return { intencao, delegadoPara: destinos, respostas, falhas, completo: falhas.length === 0 };
  },
};
