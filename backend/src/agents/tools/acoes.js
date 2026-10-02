// A ÚNICA capacidade de escrita oferecida aos agentes/LLM (Etapa 1): propor.
// Grava uma AcaoProposta PENDENTE; nada é executado. Não existe tool de
// aprovação ou execução: isso só acontece pelo gestor (rotas /api/agentes/acoes).
import { z } from "zod";
import * as servicoAcoes from "../acoes/servicoAcoes.js";
import { TIPOS_ACAO } from "../acoes/contratos.js";
import { definirTool } from "./definirTool.js";

export const proporAcao = definirTool({
  nome: "proporAcao",
  descricao:
    "Propõe uma ação para o gestor aprovar (não executa nada; reenviar a mesma proposta enquanto ela estiver PENDENTE devolve a mesma ação). Tipos: REGISTRAR_VENDA {clienteId, sabores:[{saborId, quantidade}], valor, desconto?, data?, pago?}, REGISTRAR_PRODUCAO {sabores, data?, observacao?}, MARCAR_VENDA_PAGA {vendaId, dataPagamento?}. Clientes, sabores e vendas sempre por id.",
  escrita: true,
  entrada: z
    .object({
      tipo: z.enum(TIPOS_ACAO),
      descricao: z.string().min(5).max(500),
      payload: z.record(z.string(), z.unknown()),
    })
    .strict(),
  async executar({ tipo, descricao, payload }, contexto) {
    const acao = await servicoAcoes.proporAcao({
      tipo,
      descricao,
      payload,
      criadaPorAgente: contexto.agente,
      execucaoId: contexto.execucaoId,
    });
    return { acaoId: acao.id, tipo: acao.tipo, status: acao.status, reaproveitada: acao.reaproveitada };
  },
});
