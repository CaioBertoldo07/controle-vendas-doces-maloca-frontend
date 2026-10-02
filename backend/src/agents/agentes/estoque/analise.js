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
// Cooperação (Etapa 3): a demanda média recente é pedida ao Agente de
// Inteligência por MENSAGEM SMA (contexto.enviarMensagem → MensagemAgente +
// execução filha), nunca importando o outro agente. Se ele falhar ou responder
// fora do contrato, a seção de demanda fica indisponível e o resto continua.
import { deslocarDiaISO, hojeCivilISO } from "../../../lib/periodos.js";
import { DEMANDA_MEDIA, JANELA_SEMANAS } from "../../contratos/demandaMedia.js";
import * as R from "./regras.js";

/** Chama uma tool e devolve os dados, ou null se falhou (a falha fica na ChamadaTool). */
async function consultar(contexto, falhas, tool, entrada = {}) {
  const r = await contexto.usarTool(tool, entrada);
  if (r.ok) return r.dados;
  falhas.push({ tool, codigo: r.erro.codigo, mensagem: r.erro.mensagem });
  return null;
}

/**
 * Pede DEMANDA_MEDIA à Inteligência e compara com a produção das mesmas
 * semanas. Devolve a seção "demanda" da análise (nunca lança).
 */
async function obterDemanda(contexto, falhas, { referencia, ritmo }) {
  const base = { fonte: "AGENTE_INTELIGENCIA", observacao: "Demanda média recente (histórico), não previsão. Nenhuma quantidade a produzir é calculada: o estoque não foi reconciliado e não há estoque mínimo." };
  const saborIds = R.saboresParaDemanda(ritmo);
  if (saborIds.length === 0) return { ...base, solicitada: false, disponivel: false, motivo: "SEM_MOVIMENTO_RECENTE" };

  const pedido = { dataReferencia: referencia, janelaSemanas: JANELA_SEMANAS.PADRAO, saborIds };
  let resposta;
  try {
    resposta = await contexto.enviarMensagem({ para: DEMANDA_MEDIA.para, tipo: DEMANDA_MEDIA.tipo, dados: pedido });
  } catch (e) {
    falhas.push({ agente: DEMANDA_MEDIA.para, mensagem: DEMANDA_MEDIA.tipo, codigo: "FALHA_AGENTE_INTELIGENCIA" });
    return { ...base, solicitada: true, disponivel: false, motivo: "FALHA_AGENTE_INTELIGENCIA", execucaoInteligenciaId: e.execucaoId ?? null };
  }
  const valida = DEMANDA_MEDIA.resposta.safeParse(resposta);
  if (!valida.success) {
    falhas.push({ agente: DEMANDA_MEDIA.para, mensagem: DEMANDA_MEDIA.tipo, codigo: "RESPOSTA_INVALIDA" });
    return { ...base, solicitada: true, disponivel: false, motivo: "RESPOSTA_INVALIDA" };
  }
  const { metodologia, sabores } = valida.data;
  // Produção das MESMAS semanas, só se houver ao menos uma média utilizável
  const producao = sabores.some((s) => s.qualidade === "SUFICIENTE")
    ? await consultar(contexto, falhas, "consultarProducaoVendasPeriodo", metodologia.periodo)
    : null;
  return { ...base, solicitada: true, disponivel: true, metodologia, sabores: R.compararProducaoDemanda(valida.data, producao) };
}

export async function analisarEstoque(contexto, { dataReferencia } = {}) {
  const referencia = dataReferencia ?? hojeCivilISO();
  const falhas = [];

  // 1. Dados (só leitura, pelas tools permitidas ao agente)
  const estoque = R.diagnosticarEstoqueAcabado(await consultar(contexto, falhas, "consultarEstoqueAcabado"));
  const materias = R.diagnosticarMateriasPrimas(await consultar(contexto, falhas, "consultarSaldoMateriasPrimas"));
  const receitas = R.diagnosticarReceitas(await consultar(contexto, falhas, "consultarReceitas"));
  const janelas = [];
  for (const j of R.janelasRitmo(referencia, deslocarDiaISO)) {
    janelas.push(R.diagnosticarJanela(j, await consultar(contexto, falhas, "consultarProducaoVendasPeriodo", { dataInicio: j.dataInicio, dataFim: j.dataFim })));
  }
  const ritmo = { natureza: "FLUXO_REGISTRADO_NO_PERIODO", observacao: "Comparação de ritmo recente, não é previsão.", janelas };

  // 2. Demanda média recente: pedida ao Agente de Inteligência (mensagem SMA)
  const demanda = await obterDemanda(contexto, falhas, { referencia, ritmo });

  // 3. MRP: só com receita; caso contrário, indisponível (nunca "necessidade zero")
  const pedido = R.pedidoSimulacaoMRP(receitas, ritmo);
  let simulacao = { executada: false, motivo: pedido.motivo };
  if (pedido.executar) {
    const r = await consultar(contexto, falhas, "calcularNecessidadesProducao", { sabores: pedido.sabores });
    simulacao = r
      ? {
          executada: true,
          natureza: "SIMULACAO_TECNICA",
          aviso: "Simulação da reposição do volume vendido nos últimos 30 dias, só para os sabores com receita. Não é lista de compras: o saldo de matéria-prima não foi conferido fisicamente.",
          base: pedido.base,
          sabores: pedido.sabores,
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
    ...R.alertasRitmo(janelas),
  ]);

  // 5. Recomendações (persistidas, deduplicadas) e resolução automática do que sumiu
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
      modoDegradado: falhas.length > 0 || !receitas.mrp.disponivel || !estoque.disponivel || materias.confiabilidade === "INDISPONIVEL" || (demanda.solicitada && !demanda.disponivel),
    },
    qualidade: { ...R.qualidadeDosDados({ estoque, materias, receitas, ritmo }), demandaMediaRecente: R.qualidadeDemanda(demanda) },
    estoqueAcabado: estoque,
    materiasPrimas: materias,
    mrp,
    ritmo,
    demanda: demanda.disponivel ? { ...demanda, divergencias: R.contextualizarDivergencias(alertas, demanda.sabores) } : demanda,
    alertas,
    recomendacoes,
    resolvidasAutomaticamente,
    falhasDeConsulta: falhas,
  };
}
