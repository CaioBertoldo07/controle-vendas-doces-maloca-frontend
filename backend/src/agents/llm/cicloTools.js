// Ciclo de tool calling (Etapa 1): o LLM pede tools pelo nome; o runtime as
// executa (validação, allowlist do agente, auditoria) e devolve o resultado
// como mensagem "tool". O LLM nunca recebe funções nem acesso ao banco.
import { erro } from "../../lib/erros.js";
import { comLimite } from "../runtime/util.js";
import { validarResposta } from "./provedor.js";

/**
 * @param provedor   contrato de provedor.js
 * @param definicoes [{ nome, descricao, parametros }] oferecidas ao LLM
 * @param usarTool   (nome, entrada) → resultado padronizado (do contexto do agente)
 * @returns { texto, passos, chamadas: [{ nome, ok, codigo? }], mensagens }
 */
export async function executarCicloLLM({ provedor, sistema, mensagens, definicoes, usarTool, maxPassos = 6, limiteMs = 20000 }) {
  const historico = [...mensagens];
  const chamadas = [];

  for (let passo = 1; passo <= maxPassos; passo++) {
    const resposta = validarResposta(
      await comLimite(provedor.gerar({ sistema, mensagens: historico, tools: definicoes }), limiteMs, `provedor ${provedor.nome}`),
    );

    if (resposta.tipo === "texto") {
      historico.push({ papel: "assistente", conteudo: resposta.texto });
      return { texto: resposta.texto, passos: passo, chamadas, mensagens: historico };
    }

    historico.push({ papel: "assistente", conteudo: resposta.texto ?? "", chamadas: resposta.chamadas });
    for (const c of resposta.chamadas) {
      const resultado = await usarTool(c.nome, c.entrada, { origem: "LLM" });
      chamadas.push({ nome: c.nome, ok: resultado.ok, ...(resultado.ok ? {} : { codigo: resultado.erro.codigo }) });
      historico.push({ papel: "tool", chamadaId: c.id, nome: c.nome, conteudo: resultado });
    }
  }
  throw erro(422, `O LLM excedeu o limite de ${maxPassos} passos sem responder`);
}
