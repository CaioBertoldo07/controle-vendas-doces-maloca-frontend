// Agente de Vendas — ANÁLISE (Etapa 4). Orquestra as tools pelo `contexto`
// (nunca Prisma nem services) e aplica as regras puras de regras.js.
//
//   analisarVendas(contexto, parametros)   → diagnóstico (ANALISAR_VENDAS)
//   calcularExposicao(contexto, pedido)    → contrato EXPOSICAO_CLIENTES_POR_SABOR
//   proporVenda / proporPagamento          → AcaoProposta PENDENTE pela tool proporAcao
//
// Modo degradado: na análise, cada área (indicadores, mix, recebíveis,
// recorrência) depende de tools diferentes; uma falha deixa só aquela área
// indisponível. Na exposição (pedido de outro agente), sem dados não há
// resposta: falha explícita, para o solicitante entrar em modo degradado.
import { erro } from "../../../lib/erros.js";
import { hojeCivilISO, semanasCompletas } from "../../../lib/periodos.js";
import { indicadoresVendas } from "../../comum/indicadoresVendas.js";
import { EXPOSICAO_CLIENTES } from "../../contratos/exposicaoClientes.js";
import * as R from "./regras.js";

async function consultar(contexto, falhas, tool, entrada) {
  const r = await contexto.usarTool(tool, entrada);
  if (r.ok) return r.dados;
  falhas.push({ tool, codigo: r.erro.codigo, mensagem: r.erro.mensagem });
  return null;
}

const periodoDe = (semanas) => ({ dataInicio: semanas[0].inicio, dataFim: semanas.at(-1).fim });
const LIMITE_RECEBIVEIS = 100; // máximo da tool; acima disso a saída avisa que truncou

const LIMITACOES = Object.freeze([
  "Só fatos observados: compras, recompras, intervalos e pendências registradas. Nada aqui prevê compra futura.",
  "Pendente = não marcada como paga no registro atual. Não existe data de vencimento: tempo em aberto não é atraso nem inadimplência.",
  "Status de pagamento anterior a 14/08/2026 veio de um backfill: não mede comportamento de pagamento. dataPagamento é quando o gestor marcou a venda.",
  "Compra = dia com venda para o cliente (várias vendas no mesmo dia contam uma vez). Datas implausíveis (antes de 2020) ficam fora.",
  "Recebíveis e status de pagamento são sempre os do registro atual, mesmo com dataReferencia no passado.",
]);

export async function analisarVendas(contexto, { dataReferencia, janelaSemanas = R.PARAMETROS.JANELA_SEMANAS } = {}) {
  const referencia = dataReferencia ?? hojeCivilISO();
  const falhas = [];
  const { semanas, parcial } = semanasCompletas(referencia, janelaSemanas);
  const periodo = periodoDe(semanas);

  const vendas = await consultar(contexto, falhas, "consultarVendasPeriodo", periodo);
  const diarias = await consultar(contexto, falhas, "consultarVendasDiariasPorSabor", periodo);
  const rec = await consultar(contexto, falhas, "consultarRecebiveis", { limite: LIMITE_RECEBIVEIS });
  const compras = await consultar(contexto, falhas, "consultarComprasClientes", { dataFim: referencia });
  const clienteSabor = await consultar(contexto, falhas, "consultarUnidadesClienteSabor", periodo);

  const clientesRec = compras ? R.recorrenciaClientes(compras.compras, referencia) : null;
  const recorrencia = clientesRec
    ? {
        disponivel: true,
        criterio: {
          compra: "DIA_COM_VENDA",
          minimoCompras: R.PARAMETROS.MIN_COMPRAS_RECORRENCIA,
          foraDoPadrao: `dias desde a última compra > ${R.PARAMETROS.MULTIPLICADOR_FORA_DO_PADRAO} × mediana dos intervalos do próprio cliente`,
        },
        resumo: R.resumirRecorrencia(clientesRec),
        clientes: clientesRec,
        observacao: "Desvio do comportamento histórico do próprio cliente; não é previsão de compra nem de abandono.",
      }
    : { disponivel: false, motivo: "FALHA_CONSULTA_COMPRAS" };

  let mix = { disponivel: false, motivo: "FALHA_CONSULTA_SERIE" };
  if (diarias) {
    mix = { disponivel: true, ...R.mixSabores(diarias.dias, diarias.sabores, periodo) };
    if (clienteSabor && clientesRec) {
      const exp = new Map(R.exposicaoPorSabor({ linhas: clienteSabor.linhas, recorrencia: clientesRec, sabores: mix.sabores }).map((e) => [e.saborId, e]));
      mix.sabores = mix.sabores.map((s) => {
        const e = exp.get(s.saborId);
        return { ...s, clientesComCompraRecente: e.clientesComCompraRecente, clientesRecorrentes: e.clientesRecorrentes, participacaoClientesRecorrentes: e.participacaoClientesRecorrentes };
      });
    } else {
      mix.exposicao = { disponivel: false, motivo: "FALHA_CONSULTA_CLIENTES" };
    }
  }

  const indicadores = vendas
    ? {
        disponivel: true,
        ...indicadoresVendas(vendas),
        sabores: diarias ? mix.sabores.length : null,
        clientesCompradores: clienteSabor ? new Set(clienteSabor.linhas.map((l) => l.clienteId)).size : null,
      }
    : { disponivel: false, motivo: "FALHA_CONSULTA_VENDAS" };
  const recebiveis = R.analisarRecebiveis(rec, referencia);

  const rascunhos = R.gerarRecomendacoes({ recebiveis, recorrencia });
  const recomendacoes = [];
  for (const r of rascunhos) {
    const { operacao, recomendacao } = await contexto.registrarRecomendacao(r);
    recomendacoes.push({ id: recomendacao.id, tipo: r.tipo, prioridade: r.prioridade, titulo: r.titulo, operacao });
  }
  const resolvidasAutomaticamente = await contexto.encerrarRecomendacoesAusentes({
    tipos: R.tiposAvaliados({ recebiveis, recorrencia }),
    chavesAtivas: rascunhos.map((r) => ({ tipo: r.tipo, chave: r.chave })),
  });

  return {
    agente: "vendas",
    tipo: "ANALISE_VENDAS",
    dataReferencia: referencia,
    periodo: { ...periodo, semanas: janelaSemanas, semana: "DOMINGO_A_SABADO", semanaParcialExcluida: { dataInicio: parcial.inicio, dataFim: parcial.fim } },
    resumo: {
      vendas: indicadores.quantidadeVendas ?? null,
      pendencias: recebiveis.quantidade ?? null,
      clientesForaDoPadrao: recorrencia.resumo?.foraDoPadraoHistorico ?? null,
      recomendacoes: recomendacoes.length,
      modoDegradado: falhas.length > 0,
    },
    indicadores,
    mix,
    recebiveis,
    recorrencia,
    insights: R.gerarInsights({ mix: mix.disponivel ? mix : null, recebiveis, recorrencia }),
    recomendacoes,
    resolvidasAutomaticamente,
    limitacoes: LIMITACOES,
    falhasDeConsulta: falhas,
  };
}

/** Resposta do contrato EXPOSICAO_CLIENTES_POR_SABOR (pedido já validado). Só agregados. */
export async function calcularExposicao(contexto, { dataReferencia, janelaSemanas = R.PARAMETROS.JANELA_SEMANAS, saborIds }) {
  const referencia = dataReferencia ?? hojeCivilISO();
  const { semanas, parcial } = semanasCompletas(referencia, janelaSemanas);
  const periodo = periodoDe(semanas);
  const exigir = async (tool, entrada) => {
    const r = await contexto.usarTool(tool, entrada);
    if (!r.ok) throw erro(503, `Dados indisponíveis para a exposição de clientes (${tool}: ${r.erro.codigo})`);
    return r.dados;
  };
  const diarias = await exigir("consultarVendasDiariasPorSabor", periodo); // nomes e existência dos sabores
  const porId = new Map(diarias.sabores.map((s) => [s.saborId, s]));
  const inexistentes = saborIds.filter((id) => !porId.has(id));
  if (inexistentes.length > 0) throw erro(404, `Sabor(es) inexistente(s): ${inexistentes.join(", ")}`);
  const linhas = (await exigir("consultarUnidadesClienteSabor", periodo)).linhas;
  const compras = (await exigir("consultarComprasClientes", { dataFim: referencia })).compras;

  const resposta = {
    dataReferencia: referencia,
    metodologia: {
      tipo: "EXPOSICAO_HISTORICA_RECENTE",
      janelaSemanas,
      semana: "DOMINGO_A_SABADO",
      periodo,
      semanaParcialExcluida: { dataInicio: parcial.inicio, dataFim: parcial.fim },
      criterioRecorrencia: `Cliente recorrente = ${R.PARAMETROS.MIN_COMPRAS_RECORRENCIA}+ dias com compra até ${referencia}.`,
      observacao: "Exposição recente a clientes que historicamente recompram; não indica que eles vão comprar de novo.",
    },
    sabores: R.exposicaoPorSabor({
      linhas,
      recorrencia: R.recorrenciaClientes(compras, referencia),
      sabores: [...new Set(saborIds)].map((id) => ({ saborId: id, sabor: porId.get(id).sabor })),
    }),
  };
  return EXPOSICAO_CLIENTES.resposta.parse(resposta); // o agente cumpre o próprio contrato
}

const STATUS_DO_CODIGO = { ENTRADA_INVALIDA: 400, NAO_ENCONTRADO: 404, CONFLITO: 409, REGRA_NEGOCIO: 422 };

/** Chama a tool proporAcao; falha da tool vira erro com o status correspondente (execução FALHA controlada). */
async function propor(contexto, { tipo, descricao, payload }) {
  const r = await contexto.usarTool("proporAcao", { tipo, descricao, payload });
  if (!r.ok) {
    const campos = r.erro.detalhes?.detalhes?.map((d) => `${d.campo}: ${d.mensagem}`).join("; ");
    throw erro(STATUS_DO_CODIGO[r.erro.codigo] ?? 500, `${r.erro.mensagem}${campos ? ` (${campos})` : ""}`);
  }
  return {
    agente: "vendas",
    tipo: "PROPOSTA",
    acao: r.dados,
    observacao: r.dados.reaproveitada
      ? "Já existia uma proposta PENDENTE idêntica: nenhuma ação nova foi criada. Nada foi executado."
      : "Proposta criada como PENDENTE. Nada foi executado: só o gestor aprova (POST /api/agentes/acoes/:id/aprovar).",
  };
}

/** PROPOR_VENDA: ids explícitos (sem resolver nomes) e VALOR INFORMADO pelo gestor (K7: não calculado pelo preço). */
export function proporVenda(contexto, { descricao, ...payload }) {
  const unidades = Array.isArray(payload.sabores) ? payload.sabores.reduce((s, i) => s + (Number(i?.quantidade) || 0), 0) : 0;
  return propor(contexto, {
    tipo: "REGISTRAR_VENDA",
    descricao: descricao ?? `Registrar venda para o cliente ${payload.clienteId}: ${unidades} unidade(s), valor informado ${payload.valor}.`,
    payload,
  });
}

/** PROPOR_MARCAR_VENDA_PAGA: só com vendaId informado pelo gestor; nunca a partir da análise de recebíveis. */
export function proporPagamento(contexto, { descricao, ...payload }) {
  return propor(contexto, {
    tipo: "MARCAR_VENDA_PAGA",
    descricao: descricao ?? `Marcar a venda ${payload.vendaId} como paga (informado pelo gestor).`,
    payload,
  });
}
