// Tools de leitura de vendas (Etapa 1). Só chamam services.
import { z } from "zod";
import * as clientesService from "../../services/clientesService.js";
import * as vendasService from "../../services/vendasService.js";
import { definirTool } from "./definirTool.js";
import { dataCivil, diaCivil, idPositivo, numero } from "./formato.js";

export const consultarVendasPeriodo = definirTool({
  nome: "consultarVendasPeriodo",
  descricao:
    "Totais de vendas entre dois dias (inclusive, calendário de Manaus): quantidade de vendas, unidades, valor total, pago e pendente, por cliente e por dia. Opcionalmente de um cliente.",
  entrada: z
    .object({ dataInicio: diaCivil, dataFim: diaCivil, clienteId: idPositivo.optional() })
    .strict()
    .refine((e) => e.dataInicio <= e.dataFim, { message: "dataInicio deve ser anterior ou igual a dataFim", path: ["dataFim"] }),
  async executar({ dataInicio, dataFim, clienteId }) {
    const t = await vendasService.resumoVendasPeriodo({ dataInicio, dataFim, clienteId });
    return {
      periodo: { dataInicio, dataFim },
      ...(clienteId && { clienteId }),
      totalVendas: t.totalVendas,
      vendasPagas: t.totalVendasPagas,
      vendasPendentes: t.totalVendasPendentes,
      unidades: t.totalGeral,
      mediaUnidadesPorVenda: t.media,
      valorTotal: numero(t.valorTotal),
      valorPago: numero(t.valorPago),
      valorPendente: numero(t.valorPendente),
      porCliente: Object.entries(t.porCliente)
        .map(([cliente, unidades]) => ({ cliente, unidades }))
        .sort((a, b) => b.unidades - a.unidades),
      porDia: Object.entries(t.porDia).map(([dia, unidades]) => ({ dia, unidades })),
    };
  },
  // Etapa 3: a auditoria guarda os totais, não a lista de clientes nem a de dias.
  resumir: (d) => ({
    periodo: d.periodo, totalVendas: d.totalVendas, unidades: d.unidades, valorTotal: d.valorTotal,
    valorPago: d.valorPago, valorPendente: d.valorPendente, clientes: d.porCliente.length, dias: d.porDia.length,
  }),
});

export const consultarRankingSabores = definirTool({
  nome: "consultarRankingSabores",
  descricao: "Ranking de clientes por unidades compradas (histórico inteiro), com o sabor favorito e a distribuição por sabor de cada um.",
  entrada: z.object({ limite: z.number().int().min(1).max(50).default(10) }).strict(),
  async executar({ limite }) {
    const ranking = await clientesService.obterRankingSabores();
    return {
      totalClientes: ranking.length,
      clientes: ranking.slice(0, limite).map((c) => ({
        cliente: c.cliente,
        unidades: c.totalComprado,
        saborFavorito: c.saborFavorito,
        sabores: c.sabores.map((s) => ({ sabor: s.nome, unidades: s.quantidade, percentual: numero(s.porcentagem) })),
      })),
    };
  },
});

export const consultarRecebiveis = definirTool({
  nome: "consultarRecebiveis",
  descricao: "Vendas ainda não pagas (a receber), da mais antiga para a mais recente, e o valor total pendente.",
  entrada: z.object({ limite: z.number().int().min(1).max(100).default(20) }).strict(),
  async executar({ limite }) {
    const { vendas, valorPendente } = await vendasService.obterRecebiveis();
    return {
      quantidade: vendas.length,
      valorPendente: numero(valorPendente),
      vendas: vendas.slice(0, limite).map((v) => ({
        vendaId: v.id,
        cliente: { id: v.cliente.id, nome: v.cliente.nome },
        data: dataCivil(v.data),
        unidades: v.quantidade,
        valor: numero(v.valor),
      })),
      truncado: vendas.length > limite,
    };
  },
  // Etapa 4: a auditoria guarda totais, não os nomes dos clientes.
  resumir: (d) => ({ quantidade: d.quantidade, valorPendente: d.valorPendente, listadas: d.vendas.length, truncado: d.truncado }),
});
