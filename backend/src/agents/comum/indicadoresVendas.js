// Indicadores gerenciais de vendas compartilhados pelos agentes (Etapa 3 na
// Inteligência; extraído na Etapa 4 para o Agente de Vendas usar a MESMA regra).
// Função pura sobre a saída da tool consultarVendasPeriodo.
import { INICIO_CONTROLE_PAGAMENTO, qualidadePagamento } from "../contratos/marcosDados.js";

const arred = (x, casas = 2) => Math.round(x * 10 ** casas) / 10 ** casas;

/**
 * Pagamento: o status de vendas anteriores a 14/08/2026 é sintético (Etapa
 * 0.2) e "pendente" é a situação ATUAL do registro, nunca inadimplência.
 */
export function indicadoresVendas(v) {
  const pagamentoConfiavel = v.periodo.dataInicio >= INICIO_CONTROLE_PAGAMENTO;
  return {
    periodo: v.periodo,
    quantidadeVendas: v.totalVendas,
    unidades: v.unidades,
    faturamentoRegistrado: arred(v.valorTotal, 2),
    ticketMedio: v.totalVendas > 0 ? arred(v.valorTotal / v.totalVendas, 2) : null,
    unidadesPorVenda: v.totalVendas > 0 ? arred(v.unidades / v.totalVendas, 2) : null,
    pagamentos: {
      vendasPagas: v.vendasPagas,
      vendasPendentes: v.vendasPendentes,
      valorPago: arred(v.valorPago, 2),
      valorPendente: arred(v.valorPendente, 2),
      confiabilidade: pagamentoConfiavel ? "SITUACAO_ATUAL_DO_REGISTRO" : "COM_RESSALVA",
      historicoPagamento: qualidadePagamento(v.periodo.dataInicio),
      observacao: pagamentoConfiavel
        ? "Pendente = ainda não marcada como paga hoje; não é inadimplência."
        : "O período começa antes de 14/08/2026: o status de pagamento dessas vendas veio de um backfill (todas marcadas pagas na data da venda) e não reflete comportamento real de pagamento.",
    },
  };
}
