// Agente de Estoque — ANÁLISE (Etapa 2). Orquestra as tools pelo `contexto`
// (nunca Prisma nem services), aplica as regras puras de regras.js e persiste
// as recomendações pela infraestrutura SMA (deduplicadas por chave).
//
// `analisarEstoque` é o ponto de entrada único: hoje é chamado pela execução
// manual (HTTP / Coordenador); no futuro, por cron e pelos eventos
// VENDA_REGISTRADA / PRODUCAO_REGISTRADA, sem mudança aqui.
//
// Modo degradado: se uma tool falhar ou faltar dado, a análise continua,
// marca a seção como indisponível e não tira conclusão sobre ela.
//
// Cooperação, sempre por MENSAGEM SMA (contexto.enviarMensagem →
// MensagemAgente + execução filha), nunca importando outro agente:
//   Etapa 3: DEMANDA_MEDIA → Inteligência (demanda média recente);
//   Etapa 4: EXPOSICAO_CLIENTES_POR_SABOR → Vendas (clientes recorrentes),
//            só para os sabores que merecem contexto.
// O Estoque consolida: as respostas enriquecem o diagnóstico, nunca viram
// quantidade a produzir. Falha de um especialista não impede o outro.
//
// Ritmo (Etapa 4): uma visão só, na janela CANÔNICA de 4 semanas completas
// (a mesma da Inteligência e de Vendas); as janelas de 7/30 dias saíram.
import { hojeCivilISO, semanasCompletas } from "../../../lib/periodos.js";
import { DEMANDA_MEDIA } from "../../contratos/demandaMedia.js";
import { EXPOSICAO_CLIENTES } from "../../contratos/exposicaoClientes.js";
import * as R from "./regras.js";

/** Chama uma tool e devolve os dados, ou null se falhou (a falha fica na ChamadaTool). */
async function consultar(contexto, falhas, tool, entrada = {}) {
  const r = await contexto.usarTool(tool, entrada);
  if (r.ok) return r.dados;
  falhas.push({ tool, codigo: r.erro.codigo, mensagem: r.erro.mensagem });
  return null;
}

const mesmaJanela = (a, b) => a.dataInicio === b.dataInicio && a.dataFim === b.dataFim;

/**
 * Envia um pedido a outro agente e valida a resposta pelo contrato e pela
 * janela canônica. Nunca lança: devolve { disponivel, resposta | motivo }.
 */
async function solicitar(contexto, falhas, { contrato, pedido, janela, motivoFalha }) {
  let resposta;
  try {
    resposta = await contexto.enviarMensagem({ para: contrato.para, tipo: contrato.tipo, dados: pedido });
  } catch (e) {
    falhas.push({ agente: contrato.para, mensagem: contrato.tipo, codigo: motivoFalha });
    return { disponivel: false, motivo: motivoFalha, execucaoFilhaId: e.execucaoId ?? null };
  }
  const valida = contrato.resposta.safeParse(resposta);
  const motivo = !valida.success ? "RESPOSTA_INVALIDA" : !mesmaJanela(valida.data.metodologia.periodo, janela) ? "JANELA_DIVERGENTE" : null;
  if (motivo) {
    falhas.push({ agente: contrato.para, mensagem: contrato.tipo, codigo: motivo });
    return { disponivel: false, motivo };
  }
  return { disponivel: true, resposta: valida.data };
}

export async function analisarEstoque(contexto, { dataReferencia } = {}) {
  const referencia = dataReferencia ?? hojeCivilISO();
  const falhas = [];
  const n = R.LIMITES.JANELA_RITMO_SEMANAS;
  const { semanas, parcial } = semanasCompletas(referencia, n);
  const janela = { dataInicio: semanas[0].inicio, dataFim: semanas.at(-1).fim, semanas: n, semanaParcialExcluida: { dataInicio: parcial.inicio, dataFim: parcial.fim } };
  const periodo = { dataInicio: janela.dataInicio, dataFim: janela.dataFim };

  // 1. Dados locais (só leitura, pelas tools permitidas ao agente)
  const estoque = R.diagnosticarEstoqueAcabado(await consultar(contexto, falhas, "consultarEstoqueAcabado"));
  const materias = R.diagnosticarMateriasPrimas(await consultar(contexto, falhas, "consultarSaldoMateriasPrimas"));
  const receitas = R.diagnosticarReceitas(await consultar(contexto, falhas, "consultarReceitas"));
  const fluxos = await consultar(contexto, falhas, "consultarProducaoVendasPeriodo", periodo);

  // 2. Demanda média recente: Inteligência, mesma janela (mensagem SMA)
  const baseDemanda = { fonte: "AGENTE_INTELIGENCIA", observacao: "Demanda média recente (histórico), não previsão. Nenhuma quantidade a produzir é calculada: o estoque não foi reconciliado e não há estoque mínimo." };
  const saborIdsDemanda = R.saboresComMovimento(fluxos);
  let demanda;
  if (saborIdsDemanda.length === 0) {
    demanda = { ...baseDemanda, solicitada: false, disponivel: false, motivo: fluxos ? "SEM_MOVIMENTO_RECENTE" : "FALHA_CONSULTA_FLUXOS" };
  } else {
    const r = await solicitar(contexto, falhas, {
      contrato: DEMANDA_MEDIA, janela: periodo, motivoFalha: "FALHA_AGENTE_INTELIGENCIA",
      pedido: { dataReferencia: referencia, janelaSemanas: n, saborIds: saborIdsDemanda },
    });
    demanda = r.disponivel
      ? { ...baseDemanda, solicitada: true, disponivel: true, metodologia: r.resposta.metodologia,
          sabores: r.resposta.sabores.map((s) => ({ saborId: s.saborId, sabor: s.sabor, qualidade: s.qualidade, mediaSemanal: s.mediaSemanal })) }
      : { ...baseDemanda, solicitada: true, disponivel: false, motivo: r.motivo, ...(r.execucaoFilhaId !== undefined && { execucaoInteligenciaId: r.execucaoFilhaId }) };
  }

  // 3. Ritmo canônico (uma visão só) e MRP (só com receita; nunca "necessidade zero")
  const ritmo = R.diagnosticarRitmo({ janela, fluxos, demanda });
  const pedidoMRP = R.pedidoSimulacaoMRP(receitas, ritmo);
  let simulacao = { executada: false, motivo: pedidoMRP.motivo };
  if (pedidoMRP.executar) {
    const r = await consultar(contexto, falhas, "calcularNecessidadesProducao", { sabores: pedidoMRP.sabores });
    simulacao = r
      ? {
          executada: true,
          natureza: "SIMULACAO_TECNICA",
          aviso: "Simulação da reposição do volume vendido nas 4 semanas completas recentes, só para os sabores com receita. Não é lista de compras: o saldo de matéria-prima não foi conferido fisicamente.",
          base: pedidoMRP.base,
          sabores: pedidoMRP.sabores,
          necessidades: r.necessidades,
          faltantes: r.faltantes,
          podeProduzir: r.podeProduzir,
        }
      : { executada: false, motivo: "FALHA_CONSULTA_NECESSIDADES" };
  }
  const mrp = { ...receitas.mrp, ...(receitas.semReceita.length > 0 && { saboresSemReceita: receitas.semReceita }), simulacao };

  // 4. Alertas (regras determinísticas; prioridade definida pela regra, nunca por LLM)
  const alertas = R.ordenarPorPrioridade([
    ...R.alertasEstoqueAcabado(estoque),
    ...R.alertasMateriasPrimas(materias),
    ...R.alertasReceitas(receitas),
    ...R.alertasSimulacaoMRP(simulacao),
    ...R.alertasRitmo(ritmo),
  ]);

  // 5. Exposição de clientes: Vendas, só para os sabores que merecem contexto (mensagem SMA)
  const baseClientes = {
    fonte: "AGENTE_VENDAS",
    criterio: "Sabores com produção abaixo da demanda na janela canônica ou com divergência histórica (saldo negativo / venda sem produção).",
    observacao: "Exposição recente a clientes que historicamente recompram; não indica que vão comprar de novo.",
  };
  const relevantes = R.saboresParaExposicao({ ritmo, alertas });
  let clientes;
  if (relevantes.length === 0) {
    clientes = { ...baseClientes, solicitada: false, disponivel: false, motivo: "SEM_SABORES_RELEVANTES" };
  } else {
    const r = await solicitar(contexto, falhas, {
      contrato: EXPOSICAO_CLIENTES, janela: periodo, motivoFalha: "FALHA_AGENTE_VENDAS",
      pedido: { dataReferencia: referencia, janelaSemanas: n, saborIds: relevantes.map((s) => s.saborId) },
    });
    clientes = r.disponivel
      ? { ...baseClientes, solicitada: true, disponivel: true, metodologia: r.resposta.metodologia, sabores: R.contextualizarExposicao(r.resposta, relevantes) }
      : { ...baseClientes, solicitada: true, disponivel: false, motivo: r.motivo, ...(r.execucaoFilhaId !== undefined && { execucaoVendasId: r.execucaoFilhaId }) };
  }

  // 6. Recomendações (persistidas, deduplicadas) e resolução automática do que sumiu
  const rascunhos = R.gerarRecomendacoes({ estoque, alertas });
  const recomendacoes = [];
  for (const rec of rascunhos) {
    const { operacao, recomendacao } = await contexto.registrarRecomendacao(rec);
    recomendacoes.push({ id: recomendacao.id, tipo: rec.tipo, prioridade: rec.prioridade, titulo: rec.titulo, operacao });
  }
  const resolvidasAutomaticamente = await contexto.encerrarRecomendacoesAusentes({
    tipos: R.tiposAvaliados({ estoque, materias, receitas }),
    chavesAtivas: rascunhos.map((r) => ({ tipo: r.tipo, chave: r.chave })),
  });

  const porPrioridade = (lista) => ({
    ALTA: lista.filter((x) => x.prioridade === "ALTA").length,
    MEDIA: lista.filter((x) => x.prioridade === "MEDIA").length,
    BAIXA: lista.filter((x) => x.prioridade === "BAIXA").length,
  });
  const conta = (op) => recomendacoes.filter((r) => r.operacao === op).length;

  return {
    agente: "estoque",
    tipo: "ANALISE_ESTOQUE",
    dataReferencia: referencia,
    resumo: {
      alertas: alertas.length,
      alertasPorPrioridade: porPrioridade(alertas),
      recomendacoes: recomendacoes.length,
      recomendacoesCriadas: conta("CRIADA"),
      recomendacoesAtualizadas: conta("ATUALIZADA"),
      recomendacoesSuprimidas: conta("SUPRIMIDA"),
      recomendacoesResolvidasAutomaticamente: resolvidasAutomaticamente.length,
      cooperacao: { inteligencia: demanda.solicitada ? (demanda.disponivel ? "RESPONDIDA" : "FALHA") : "NAO_SOLICITADA", vendas: clientes.solicitada ? (clientes.disponivel ? "RESPONDIDA" : "FALHA") : "NAO_SOLICITADA" },
      modoDegradado: falhas.length > 0 || !receitas.mrp.disponivel || !estoque.disponivel || materias.confiabilidade === "INDISPONIVEL"
        || (demanda.solicitada && !demanda.disponivel) || (clientes.solicitada && !clientes.disponivel),
    },
    qualidade: {
      ...R.qualidadeDosDados({ estoque, materias, receitas, ritmo }),
      demandaMediaRecente: R.qualidadeDemanda(demanda),
      exposicaoClientes: R.qualidadeExposicao(clientes),
    },
    estoqueAcabado: estoque,
    materiasPrimas: materias,
    mrp,
    ritmo,
    demanda: demanda.disponivel ? { ...demanda, divergencias: R.contextualizarDivergencias(alertas, demanda.sabores) } : demanda,
    clientes,
    alertas,
    recomendacoes,
    resolvidasAutomaticamente,
    falhasDeConsulta: falhas,
  };
}
