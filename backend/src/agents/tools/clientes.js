// Tools de leitura de comportamento de clientes (Etapa 4, Agente de Vendas).
// Só chamam services e devolvem ids e agregados: nenhum nome de cliente.
import { z } from "zod";
import * as vendasService from "../../services/vendasService.js";
import { definirTool } from "./definirTool.js";
import { diaCivil } from "./formato.js";

export const consultarComprasClientes = definirTool({
  nome: "consultarComprasClientes",
  descricao:
    "Ocasiões de compra de cada cliente até dataFim (inclusive, calendário de Manaus): uma linha por cliente e dia com venda (várias vendas no mesmo dia contam como uma ocasião), com nº de vendas e unidades. Só ids; base da recorrência.",
  entrada: z.object({ dataFim: diaCivil }).strict(),
  async executar({ dataFim }) {
    const compras = await vendasService.comprasPorClienteDia({ dataFim });
    return { dataFim, compras };
  },
  resumir: (d) => ({ dataFim: d.dataFim, clientes: new Set(d.compras.map((c) => c.clienteId)).size, ocasioes: d.compras.length }),
});

export const consultarUnidadesClienteSabor = definirTool({
  nome: "consultarUnidadesClienteSabor",
  descricao:
    "Unidades compradas por cliente e sabor entre dois dias (inclusive, calendário de Manaus), agregadas no banco. Só ids; base da exposição de clientes por sabor.",
  entrada: z
    .object({ dataInicio: diaCivil, dataFim: diaCivil })
    .strict()
    .refine((e) => e.dataInicio <= e.dataFim, { message: "dataInicio deve ser anterior ou igual a dataFim", path: ["dataFim"] }),
  async executar({ dataInicio, dataFim }) {
    const linhas = await vendasService.unidadesPorClienteSabor({ dataInicio, dataFim });
    return { periodo: { dataInicio, dataFim }, linhas };
  },
  resumir: (d) => ({ periodo: d.periodo, linhas: d.linhas.length, clientes: new Set(d.linhas.map((l) => l.clienteId)).size, unidades: d.linhas.reduce((s, l) => s + l.unidades, 0) }),
});
