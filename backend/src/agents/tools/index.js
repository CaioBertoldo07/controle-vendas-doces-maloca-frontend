// Catálogo das tools da camada SMA (Etapa 1). Cada agente declara quais pode
// usar; o runtime recusa qualquer outra (TOOL_NAO_PERMITIDA).
import { proporAcao } from "./acoes.js";
import {
  calcularNecessidadesProducao,
  consultarEstatisticasCliente,
  consultarEstoqueAcabado,
  consultarProducaoVendasPeriodo,
  consultarReceitas,
  consultarResumoProducao,
  consultarSaldoMateriasPrimas,
} from "./estoqueProducao.js";
import { consultarCustosPeriodo, consultarVendasDiariasPorSabor } from "./indicadores.js";
import { consultarRankingSabores, consultarRecebiveis, consultarVendasPeriodo } from "./vendas.js";

const TODAS = [
  consultarVendasPeriodo,
  consultarRankingSabores,
  consultarRecebiveis,
  consultarEstoqueAcabado,
  consultarSaldoMateriasPrimas,
  consultarResumoProducao,
  calcularNecessidadesProducao,
  consultarEstatisticasCliente,
  consultarReceitas,
  consultarProducaoVendasPeriodo,
  consultarVendasDiariasPorSabor,
  consultarCustosPeriodo,
  proporAcao,
];

export const CATALOGO = new Map(TODAS.map((t) => [t.nome, t]));

export { executarTool, paraLLM } from "./definirTool.js";
