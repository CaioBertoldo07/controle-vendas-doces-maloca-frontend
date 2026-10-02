// Agente de Inteligência — ANÁLISE (Etapa 3). Orquestra as tools pelo
// `contexto` (nunca Prisma nem services) e aplica as funções puras de
// calculos.js. Duas entradas:
//
//   analisarInteligencia(contexto, parametros) → resumo gerencial (ANALISAR_INTELIGENCIA)
//   calcularDemandaMedia(contexto, pedido)     → resposta do contrato DEMANDA_MEDIA
//
// Toda análise recebe uma data de referência explícita; sem ela, usa hoje em
// Manaus. Modo degradado: tool que falha deixa a seção indisponível e a análise
// continua (ANALISAR); na DEMANDA_MEDIA, sem dados não há resposta (falha
// explícita, para o solicitante saber que não recebeu média nenhuma).
import { erro } from "../../../lib/erros.js";
import { hojeCivilISO } from "../../../lib/periodos.js";
import { DEMANDA_MEDIA, JANELA_SEMANAS } from "../../contratos/demandaMedia.js";
import * as C from "./calculos.js";

async function consultar(contexto, falhas, tool, entrada) {
  const r = await contexto.usarTool(tool, entrada);
  if (r.ok) return r.dados;
  falhas.push({ tool, codigo: r.erro.codigo, mensagem: r.erro.mensagem });
  return null;
}

const LIMITACOES = Object.freeze([
  "Estatística descritiva do histórico registrado: médias, média móvel, variação entre janelas e perfil por dia da semana. Nenhum número é previsão.",
  "A tendência compara apenas as últimas semanas completas com as imediatamente anteriores; não projeta o futuro.",
  "Semanas de domingo a sábado (calendário de Manaus); a semana da data de referência é parcial e fica fora das médias.",
  "Status de pagamento anterior a 14/08/2026 vem de um backfill e não serve para analisar comportamento de pagamento; 'pendente' não é inadimplência.",
  "Sem custo nem margem por sabor: não há receitas cadastradas. Custos são agregados, pela data de lançamento.",
  "Sem sazonalidade anual: o histórico tem cerca de 7 meses.",
]);

export async function analisarInteligencia(contexto, { dataReferencia, janelaSemanas = C.PARAMETROS.JANELA_SEMANAS, perfilPorSabor = false } = {}) {
  const referencia = dataReferencia ?? hojeCivilISO();
  const falhas = [];
  const n = janelaSemanas;
  const totalSemanas = Math.max(C.PARAMETROS.SEMANAS_SERIE, 2 * n, C.PARAMETROS.SEMANAS_PERFIL);
  const { semanas, parcial } = C.delimitarSemanas(referencia, totalSemanas);
  const janelas = C.dividirJanelas(semanas, n);
  const semanasPerfil = semanas.slice(-C.PARAMETROS.SEMANAS_PERFIL);

  // 1. Dados (agregados), pelas tools permitidas ao agente
  const diarias = await consultar(contexto, falhas, "consultarVendasDiariasPorSabor", { dataInicio: semanas[0].inicio, dataFim: referencia });
  const vendasRecente = await consultar(contexto, falhas, "consultarVendasPeriodo", C.periodoDe(janelas.recente));
  const vendasAnterior = await consultar(contexto, falhas, "consultarVendasPeriodo", C.periodoDe(janelas.anterior));
  const custos = await consultar(contexto, falhas, "consultarCustosPeriodo", C.periodoDe(janelas.recente));

  // 2. Indicadores gerais
  const recente = vendasRecente && C.indicadoresVendas(vendasRecente);
  const anterior = vendasAnterior && C.indicadoresVendas(vendasAnterior);
  const indicadores = {
    disponivel: Boolean(recente),
    ...(recente ? { recente } : { motivo: "FALHA_CONSULTA_VENDAS" }),
    ...(anterior && { anterior }),
    ...(recente && anterior && {
      variacao: {
        quantidadeVendas: C.variacao(anterior.quantidadeVendas, recente.quantidadeVendas),
        unidades: C.variacao(anterior.unidades, recente.unidades),
        faturamentoRegistrado: C.variacao(anterior.faturamentoRegistrado, recente.faturamentoRegistrado),
      },
    }),
    custos: custos ? C.indicadoresCustos(custos, recente) : { disponivel: false, motivo: "FALHA_CONSULTA_CUSTOS" },
  };

  // 3. Séries, demanda, tendência e perfil (dependem da série diária)
  let serie = { disponivel: false, motivo: "FALHA_CONSULTA_SERIE" };
  let sabores = [];
  let tendencias = { disponivel: false, motivo: "FALHA_CONSULTA_SERIE" };
  let perfil = { disponivel: false, motivo: "FALHA_CONSULTA_SERIE" };
  let qualidadeHistorico = { confiabilidade: "INDISPONIVEL", motivo: "FALHA_CONSULTA_SERIE" };
  let insights = [];
  if (diarias) {
    const { total, porSabor } = C.serieSemanal(diarias.dias, semanas);
    const mm4 = C.mediaMovel(total);
    const primeiraGeral = diarias.sabores.map((s) => s.primeiraVenda).filter(Boolean).sort()[0] ?? null;
    const unidadesParciais = diarias.dias.filter((d) => d.dia >= parcial.inicio).reduce((s, d) => s + d.unidades, 0);
    serie = {
      disponivel: true,
      semana: "DOMINGO_A_SABADO",
      semanas: semanas.map((s, i) => ({ ...s, unidades: total[i], mediaMovel4: mm4[i] })),
      semanaParcial: { ...parcial, unidades: unidadesParciais, observacao: "Semana em curso: fora das médias e comparações." },
      observacao: "Média móvel de 4 semanas = suavização descritiva, não previsão.",
    };
    const totalSuficiente = C.qualidadeAmostra([...janelas.anterior, ...janelas.recente], primeiraGeral) === "SUFICIENTE";
    const somas = C.somarJanelas(total, n);
    const vTotal = C.variacao(somas.anterior, somas.recente);
    const tendenciaTotal = { variacao: vTotal, ...C.classificarTendencia(vTotal, { suficiente: totalSuficiente }) };
    sabores = C.analisarSabores({ sabores: diarias.sabores, dias: diarias.dias, janelas, porSabor, semanasSerie: semanas });
    const porTendencia = (t) => sabores.filter((s) => s.tendencia === t).map((s) => s.sabor);
    tendencias = {
      disponivel: true,
      natureza: "COMPARACAO_ENTRE_JANELAS_HISTORICAS",
      observacao: "A tendência representa apenas a comparação recente entre janelas históricas e não constitui previsão futura.",
      janelas: { anterior: C.periodoDe(janelas.anterior), recente: C.periodoDe(janelas.recente) },
      limiarPercentual: C.PARAMETROS.LIMIAR_TENDENCIA_PERCENTUAL,
      total: tendenciaTotal,
      sabores: { ALTA: porTendencia("ALTA"), ESTAVEL: porTendencia("ESTAVEL"), QUEDA: porTendencia("QUEDA"), INDETERMINADA: porTendencia("INDETERMINADA") },
    };
    const perfilTotal = C.perfilDiaSemana(diarias.dias, semanasPerfil);
    const perfilCompleto = C.qualidadeAmostra(semanasPerfil, primeiraGeral) === "SUFICIENTE";
    perfil = {
      disponivel: true,
      qualidade: perfilCompleto ? "SUFICIENTE" : "DADOS_INSUFICIENTES",
      observacao: "Perfil descritivo das semanas completas recentes; não é sazonalidade estatística.",
      total: perfilTotal,
      ...(perfilPorSabor && { porSabor: sabores.map((s) => ({ saborId: s.saborId, sabor: s.sabor, ...C.perfilDiaSemana(diarias.dias, semanasPerfil, { saborId: s.saborId }) })) }),
    };
    // Semanas sem venda: só entre as observadas (a partir da primeira venda)
    const observadas = semanas.map((s, i) => [s, total[i]]).filter(([s]) => primeiraGeral && s.inicio >= primeiraGeral);
    const semanasComVenda = observadas.filter(([, u]) => u > 0).length;
    qualidadeHistorico = {
      confiabilidade: totalSuficiente ? "SUFICIENTE" : "DADOS_INSUFICIENTES",
      primeiraVenda: primeiraGeral,
      semanasAnalisadas: semanas.length,
      semanasObservadas: observadas.length,
      semanasComVenda,
      semanasSemVenda: observadas.length - semanasComVenda,
      // Etapa 0.2 (P1): datas impossíveis ficam fora da primeira venda e são apontadas aqui
      vendasComDataImplausivel: diarias.vendasComDataImplausivel,
    };
    insights = C.gerarInsights({ tendenciaTotal, janelas, sabores, perfil: perfilCompleto ? perfilTotal : null });
  }

  return {
    agente: "inteligencia",
    tipo: "ANALISE_INTELIGENCIA",
    dataReferencia: referencia,
    periodo: {
      semana: "DOMINGO_A_SABADO",
      semanaParcial: { dataInicio: parcial.inicio, dataFim: parcial.fim },
      recente: { ...C.periodoDe(janelas.recente), semanas: n },
      anterior: { ...C.periodoDe(janelas.anterior), semanas: n },
      serie: { ...C.periodoDe(semanas), semanas: semanas.length },
      perfil: { ...C.periodoDe(semanasPerfil), semanas: semanasPerfil.length },
    },
    resumo: {
      insights: insights.length,
      sabores: sabores.length,
      tendenciaTotal: tendencias.total?.tendencia ?? "INDETERMINADA",
      modoDegradado: falhas.length > 0,
    },
    indicadores,
    serieSemanal: serie,
    sabores,
    tendencias,
    perfilDiaSemana: perfil,
    insights,
    qualidadeDados: {
      historicoVendas: qualidadeHistorico,
      pagamentos: recente?.pagamentos.confiabilidade ?? "INDISPONIVEL",
      custos: custos ? "AGREGADO" : "INDISPONIVEL",
      custoPorSabor: "INDISPONIVEL_SEM_RECEITAS",
    },
    limitacoes: LIMITACOES,
    falhasDeConsulta: falhas,
  };
}

/** Resposta do contrato DEMANDA_MEDIA (pedido já validado). */
export async function calcularDemandaMedia(contexto, { dataReferencia, janelaSemanas = JANELA_SEMANAS.PADRAO, saborIds } = {}) {
  const referencia = dataReferencia ?? hojeCivilISO();
  const { semanas, parcial } = C.delimitarSemanas(referencia, janelaSemanas);
  const periodo = C.periodoDe(semanas);
  const r = await contexto.usarTool("consultarVendasDiariasPorSabor", periodo);
  if (!r.ok) throw erro(503, `Dados de vendas indisponíveis para a demanda média (${r.erro.codigo})`);

  let alvo;
  if (saborIds) {
    const porId = new Map(r.dados.sabores.map((s) => [s.saborId, s]));
    const inexistentes = saborIds.filter((id) => !porId.has(id));
    if (inexistentes.length > 0) throw erro(404, `Sabor(es) inexistente(s): ${inexistentes.join(", ")}`);
    alvo = [...new Set(saborIds)].map((id) => porId.get(id));
  } else {
    alvo = r.dados.sabores.filter((s) => s.ativo);
  }

  const resposta = {
    dataReferencia: referencia,
    metodologia: {
      tipo: "MEDIA_HISTORICA_RECENTE",
      janelaSemanas,
      unidade: "UNIDADES_POR_SEMANA",
      semana: "DOMINGO_A_SABADO",
      periodo,
      semanaParcialExcluida: { dataInicio: parcial.inicio, dataFim: parcial.fim },
      criterioSuficiencia: `SUFICIENTE só se o sabor já tinha venda antes de ${periodo.dataInicio} (as ${janelaSemanas} semanas completas observadas); caso contrário, sem média.`,
      observacao: "Média histórica recente de unidades vendidas; não é previsão de demanda.",
    },
    sabores: alvo.map((s) => C.demandaMediaSabor(s, semanas, r.dados.dias)),
  };
  return DEMANDA_MEDIA.resposta.parse(resposta); // o agente cumpre o próprio contrato
}
