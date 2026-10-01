// Tools de leitura de estoque, produção e clientes (Etapa 1). Só chamam services.
import { z } from "zod";
import * as clientesService from "../../services/clientesService.js";
import * as estoqueService from "../../services/estoqueService.js";
import * as producaoService from "../../services/producaoService.js";
import * as saboresService from "../../services/saboresService.js";
import { definirTool } from "./definirTool.js";
import { dataCivil, idPositivo, itemSabor, numero } from "./formato.js";

export const consultarEstoqueAcabado = definirTool({
  nome: "consultarEstoqueAcabado",
  descricao:
    "Estoque de produto acabado por sabor (produzido − vendido, histórico inteiro, sem inventário físico nem data de corte) e totais.",
  entrada: z.object({}).strict(),
  async executar() {
    const e = await estoqueService.obterEstoqueAcabado();
    return {
      itens: e.itens.map((i) => ({ saborId: i.id, sabor: i.nome, produzido: i.produzido, vendido: i.vendido, saldo: i.saldo })),
      totalProduzido: e.totalProduzido,
      totalVendido: e.totalVendido,
      totalSaldo: e.totalSaldo,
      observacao: "Saldo derivado de produção − vendas; ainda sem reconciliação por contagem física.",
    };
  },
});

export const consultarSaldoMateriasPrimas = definirTool({
  nome: "consultarSaldoMateriasPrimas",
  descricao: "Saldo atual das matérias-primas ativas (na unidade base de cada uma), com os sinalizadores de saldo baixo e negativo.",
  entrada: z.object({}).strict(),
  async executar() {
    const lista = await estoqueService.resumoMateriasPrimas();
    return lista.map((m) => ({
      materiaPrimaId: m.id,
      nome: m.nome,
      unidadeBase: m.unidadeBase,
      saldo: m.saldo,
      saldoBaixo: m.saldoBaixo,
      saldoNegativo: m.saldoNegativo,
    }));
  },
});

export const consultarResumoProducao = definirTool({
  nome: "consultarResumoProducao",
  descricao:
    "Produção de hoje, da semana e do mês (calendário de Manaus), produzido × vendido no mês por sabor e a série dos 12 meses do ano. Sem mês/ano: mês corrente.",
  entrada: z
    .object({ mes: z.number().int().min(1).max(12).optional(), ano: z.number().int().min(2020).max(2100).optional() })
    .strict()
    .refine((e) => (e.mes === undefined) === (e.ano === undefined), { message: "informe mes e ano juntos, ou nenhum" }),
  async executar({ mes, ano }) {
    const r = await producaoService.obterResumoProducao({ mes, ano });
    return {
      totalHoje: r.totalHoje,
      totalSemana: r.totalSemana,
      totalMes: r.totalMes,
      totalVendidoMes: r.totalVendidoMes,
      saldoMes: r.saldoEstoque,
      porSabor: Object.entries(r.saldoPorSabor).map(([sabor, s]) => ({ sabor, ...s })),
      meses: r.meses.map((m) => ({ mes: m.mes, nomeMes: m.nomeMes, produzido: m.total })),
    };
  },
});

export const calcularNecessidadesProducao = definirTool({
  nome: "calcularNecessidadesProducao",
  descricao:
    "Simula uma produção SEM gravar nada: matéria-prima necessária pela receita de cada sabor, o que falta no saldo atual e se dá para produzir. Sabores sem receita não geram necessidade.",
  entrada: z.object({ sabores: z.array(itemSabor).min(1).max(20) }).strict(),
  async executar({ sabores }) {
    const saboresSemReceita = [];
    for (const { saborId } of sabores) {
      const receita = await saboresService.obterReceita(saborId); // 404 se o sabor não existe
      if (!receita.rendimentoBase || receita.itens.length === 0) saboresSemReceita.push(saborId);
    }
    const necessidades = await producaoService.calcularNecessidades(sabores);
    const faltantes = await producaoService.verificarFaltantes(necessidades);
    return {
      necessidades: Object.entries(necessidades).map(([id, n]) => ({
        materiaPrimaId: Number(id),
        nome: n.nome,
        unidadeBase: n.unidadeBase,
        quantidade: Number(n.quantidade.toFixed(3)),
      })),
      faltantes,
      podeProduzir: faltantes.length === 0,
      saboresSemReceita,
    };
  },
});

export const consultarEstatisticasCliente = definirTool({
  nome: "consultarEstatisticasCliente",
  descricao: "Histórico de um cliente pelo id: total de vendas e unidades, média por venda, unidades por mês e as 5 vendas mais recentes.",
  entrada: z.object({ clienteId: idPositivo }).strict(),
  async executar({ clienteId }) {
    const e = await clientesService.obterEstatisticasCliente(clienteId);
    return {
      cliente: { id: e.cliente.id, nome: e.cliente.nome },
      totalVendas: e.totalVendas,
      unidades: e.totalQuantidade,
      mediaUnidadesPorVenda: e.mediaQuantidade,
      unidadesPorMes: Object.entries(e.vendasPorMes).map(([mes, unidades]) => ({ mes, unidades })),
      ultimasVendas: e.ultimasVendas.map((v) => ({
        vendaId: v.id,
        data: dataCivil(v.data),
        unidades: v.quantidade,
        valor: numero(v.valor),
        pago: v.pago,
      })),
    };
  },
});
