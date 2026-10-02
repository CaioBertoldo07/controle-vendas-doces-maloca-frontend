// Tools de leitura para indicadores (Etapa 3, Agente de Inteligência). Só
// chamam services e devolvem AGREGADOS: nenhuma venda individual, nenhum cliente.
import { z } from "zod";
import * as custosService from "../../services/custosService.js";
import * as vendasService from "../../services/vendasService.js";
import { definirTool } from "./definirTool.js";
import { diaCivil } from "./formato.js";

const periodo = z
  .object({ dataInicio: diaCivil, dataFim: diaCivil })
  .strict()
  .refine((e) => e.dataInicio <= e.dataFim, { message: "dataInicio deve ser anterior ou igual a dataFim", path: ["dataFim"] });

export const consultarVendasDiariasPorSabor = definirTool({
  nome: "consultarVendasDiariasPorSabor",
  descricao:
    "Unidades vendidas por dia e por sabor entre dois dias (inclusive, calendário de Manaus), agregadas no banco, e o dia da primeira venda (com data plausível) de cada sabor até dataFim, mais quantas vendas têm data implausível. Base das séries semanais, médias e perfil por dia da semana.",
  entrada: periodo,
  async executar({ dataInicio, dataFim }) {
    const { sabores, dias, vendasComDataImplausivel } = await vendasService.vendasDiariasPorSabor({ dataInicio, dataFim });
    return {
      periodo: { dataInicio, dataFim },
      sabores: sabores.map((s) => ({ saborId: s.id, sabor: s.nome, ativo: s.ativo, primeiraVenda: s.primeiraVenda })),
      dias,
      vendasComDataImplausivel,
    };
  },
  resumir: (d) => ({ periodo: d.periodo, sabores: d.sabores.length, linhas: d.dias.length, dias: new Set(d.dias.map((x) => x.dia)).size, unidades: d.dias.reduce((s, x) => s + x.unidades, 0) }),
});

export const consultarCustosPeriodo = definirTool({
  nome: "consultarCustosPeriodo",
  descricao:
    "Custos lançados entre dois dias (inclusive, calendário de Manaus): total e por categoria. Custo AGREGADO por data de lançamento; não existe custo por sabor.",
  entrada: periodo,
  async executar({ dataInicio, dataFim }) {
    const c = await custosService.totalCustosPeriodo({ dataInicio, dataFim });
    return { periodo: { dataInicio, dataFim }, ...c };
  },
});
