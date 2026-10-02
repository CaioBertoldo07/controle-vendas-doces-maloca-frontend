// Marcos de qualidade dos dados reais (Etapa 0.2), compartilhados pelos agentes.
// Ficam num lugar só para que Inteligência e Vendas apliquem a mesma ressalva.

/**
 * Início do controle real de pagamento (deploy de 14/08/2026). Antes disso,
 * todas as vendas foram marcadas pagas por um backfill (pago = true,
 * dataPagamento = data): o status de pagamento anterior é sintético e nunca
 * serve para medir comportamento de pagamento ou prazo de recebimento.
 * `dataPagamento` registra quando o gestor marcou a venda, não o recebimento.
 */
export const INICIO_CONTROLE_PAGAMENTO = "2026-08-14";

/** Qualidade do status de pagamento de uma janela de vendas que começa em `dataInicio`. */
export const qualidadePagamento = (dataInicio) => ({
  confiavelDesde: INICIO_CONTROLE_PAGAMENTO,
  classificacao: dataInicio >= INICIO_CONTROLE_PAGAMENTO ? "OPERACIONAL" : "COM_RESSALVA",
});
