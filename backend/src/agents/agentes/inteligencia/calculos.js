// Agente de Inteligência — CÁLCULOS (Etapa 3). Funções puras e determinísticas:
// sem banco, sem tools, sem LLM, sem relógio (a data de referência é sempre
// recebida). Documento: docs/tcc/etapa-3-agente-inteligencia.md.
//
// Só estatística DESCRITIVA sobre o histórico: médias, média móvel, variação
// entre janelas e perfil por dia da semana. Nada aqui é previsão.
//
// Semana: domingo a sábado no calendário de Manaus (a mesma de
// intervaloDaSemana, Etapa 0.5). A semana que contém a data de referência é
// sempre PARCIAL e fica fora das médias, mesmo que a referência seja um sábado.
import { diaDaSemanaISO, inicioDaSemanaISO, semanasCompletas } from "../../../lib/periodos.js";
import { indicadoresVendas } from "../../comum/indicadoresVendas.js";
import { INICIO_CONTROLE_PAGAMENTO } from "../../contratos/marcosDados.js";

/** Parâmetros (todos explícitos, documentados e testados nas fronteiras). */
export const PARAMETROS = Object.freeze({
  /** Semanas completas de cada janela (demanda média e cada lado da comparação). */
  JANELA_SEMANAS: 4,
  /** Semanas completas da série semanal exibida (a MM4 existe a partir da 4ª). */
  SEMANAS_SERIE: 12,
  /** Semanas completas do perfil por dia da semana (cada dia ocorre 8 vezes). */
  SEMANAS_PERFIL: 8,
  /** Largura da média móvel, em semanas. */
  MEDIA_MOVEL: 4,
  /**
   * |variação| ≥ 15% entre as duas janelas → ALTA ou QUEDA. Na Etapa 0.2 o
   * coeficiente de variação semanal é 0,24; a diferença relativa entre duas
   * somas de 4 semanas independentes oscila ≈ 0,24 × √(2/4) ≈ 17% só por
   * ruído. 15% fica perto desse desvio: abaixo disso, ESTAVEL.
   */
  LIMIAR_TENDENCIA_PERCENTUAL: 15,
  /** Unidades somadas nas duas janelas abaixo das quais a variação não vira tendência (evita "+100%" de 1 → 2). */
  VOLUME_MINIMO_TENDENCIA: 20,
  /** Início do controle real de pagamento (Etapa 0.2): antes disso o status "pago" é de um backfill. */
  INICIO_CONTROLE_PAGAMENTO,
});

export const DIAS_SEMANA = Object.freeze(["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]);

const soma = (v) => v.reduce((s, x) => s + x, 0);
export const arred = (x, casas = 2) => Math.round(x * 10 ** casas) / 10 ** casas;

// ---------------------------------------------------------------- semanas

/**
 * As `n` semanas completas anteriores à semana da data de referência (da mais
 * antiga para a mais recente) e a semana parcial [domingo, referência]. Desde a
 * Etapa 4 é a janela canônica compartilhada (lib/periodos.semanasCompletas).
 */
export const delimitarSemanas = semanasCompletas;

/** As últimas `n` semanas de uma lista e as `n` imediatamente anteriores. */
export const dividirJanelas = (semanas, n) => ({ anterior: semanas.slice(-2 * n, -n), recente: semanas.slice(-n) });

export const periodoDe = (semanas) => ({ dataInicio: semanas[0].inicio, dataFim: semanas.at(-1).fim });

/** Soma das últimas `n` posições de uma série semanal e das `n` anteriores. */
export const somarJanelas = (serie, n) => ({ anterior: soma(serie.slice(-2 * n, -n)), recente: soma(serie.slice(-n)) });

/**
 * Linhas diárias { dia, saborId, unidades } → unidades por semana completa
 * (zeros preenchidos), no total e por sabor. Dias fora das semanas (ex.: a
 * semana parcial) são ignorados.
 */
export function serieSemanal(dias, semanas) {
  const posicao = new Map(semanas.map((s, i) => [s.inicio, i]));
  const total = semanas.map(() => 0);
  const porSabor = new Map();
  for (const { dia, saborId, unidades } of dias) {
    const i = posicao.get(inicioDaSemanaISO(dia));
    if (i === undefined) continue;
    total[i] += unidades;
    if (!porSabor.has(saborId)) porSabor.set(saborId, semanas.map(() => 0));
    porSabor.get(saborId)[i] += unidades;
  }
  return { total, porSabor };
}

/** Média móvel simples de `k` semanas, alinhada à série: as k − 1 primeiras posições são null. Suavização, não previsão. */
export function mediaMovel(valores, k = PARAMETROS.MEDIA_MOVEL) {
  return valores.map((_, i) => (i + 1 < k ? null : arred(soma(valores.slice(i + 1 - k, i + 1)) / k, 2)));
}

// ---------------------------------------------------------------- variação e tendência

/**
 * Variação percentual de `anterior` para `recente`. Nunca devolve Infinity
 * nem NaN: base zero e ambos zero têm estado próprio e percentual null.
 */
export function variacao(anterior, recente) {
  if (!Number.isFinite(anterior) || !Number.isFinite(recente)) return { estado: "INDISPONIVEL", anterior: null, recente: null, percentual: null };
  if (anterior === 0 && recente === 0) return { estado: "AMBOS_ZERO", anterior, recente, diferenca: 0, percentual: null };
  if (anterior === 0) return { estado: "BASE_ZERO", anterior, recente, diferenca: recente, percentual: null };
  return { estado: "CALCULADA", anterior, recente, diferenca: recente - anterior, percentual: arred(((recente - anterior) / anterior) * 100, 1) };
}

/**
 * Tendência RECENTE: só compara duas janelas históricas, não diz nada sobre
 * o futuro. Comparação em inteiros (sem arredondamento nas fronteiras).
 */
export function classificarTendencia(v, { suficiente = true } = {}) {
  if (!suficiente) return { tendencia: "INDETERMINADA", motivo: "DADOS_INSUFICIENTES" };
  if (v.estado !== "CALCULADA") return { tendencia: "INDETERMINADA", motivo: v.estado };
  if (v.anterior + v.recente < PARAMETROS.VOLUME_MINIMO_TENDENCIA) return { tendencia: "INDETERMINADA", motivo: "VOLUME_BAIXO" };
  const delta100 = (v.recente - v.anterior) * 100;
  const limite = PARAMETROS.LIMIAR_TENDENCIA_PERCENTUAL * v.anterior;
  if (delta100 >= limite) return { tendencia: "ALTA" };
  if (delta100 <= -limite) return { tendencia: "QUEDA" };
  return { tendencia: "ESTAVEL" };
}

// ---------------------------------------------------------------- suficiência e demanda média

/** Semanas completas observadas: as que começam no dia da primeira venda do sabor ou depois. */
export const semanasObservadas = (semanas, primeiraVenda) =>
  primeiraVenda ? semanas.filter((s) => s.inicio >= primeiraVenda).length : 0;

/**
 * Qualidade da amostra de um sabor numa janela: SUFICIENTE só se TODAS as
 * semanas foram observadas (o sabor já vendia antes do início da janela).
 * Sem venda nenhuma até o fim da janela: SEM_HISTORICO.
 */
export function qualidadeAmostra(semanas, primeiraVenda) {
  if (!primeiraVenda) return "SEM_HISTORICO";
  return semanasObservadas(semanas, primeiraVenda) >= semanas.length ? "SUFICIENTE" : "DADOS_INSUFICIENTES";
}

/**
 * Demanda média recente de um sabor = unidades vendidas na janela ÷ semanas
 * da janela (e ÷ dias, para a média diária observada, que inclui dias sem
 * venda). Sem amostra suficiente não há média: nenhuma extrapolação.
 */
export function demandaMediaSabor({ saborId, sabor, primeiraVenda }, semanas, dias) {
  const doSabor = dias.filter((d) => d.saborId === saborId && d.dia >= semanas[0].inicio && d.dia <= semanas.at(-1).fim);
  const unidades = soma(doSabor.map((d) => d.unidades));
  const qualidade = qualidadeAmostra(semanas, primeiraVenda);
  const ok = qualidade === "SUFICIENTE";
  return {
    saborId,
    sabor,
    qualidade,
    primeiraVenda: primeiraVenda ?? null,
    semanasObservadas: semanasObservadas(semanas, primeiraVenda),
    unidadesVendidas: unidades,
    diasComVenda: new Set(doSabor.filter((d) => d.unidades > 0).map((d) => d.dia)).size,
    mediaSemanal: ok ? arred(unidades / semanas.length, 2) : null,
    mediaDiaria: ok ? arred(unidades / (semanas.length * 7), 2) : null,
  };
}

// ---------------------------------------------------------------- perfil por dia da semana

/**
 * Unidades por dia da semana nas semanas completas informadas (total ou de um
 * sabor). Cada dia da semana ocorre uma vez por semana; a média é por
 * ocorrência. Perfil descritivo, não sazonalidade estatística.
 */
export function perfilDiaSemana(dias, semanas, { saborId = null } = {}) {
  const { dataInicio, dataFim } = periodoDe(semanas);
  const unidades = Array(7).fill(0);
  const comVenda = Array.from({ length: 7 }, () => new Set());
  for (const d of dias) {
    if (d.dia < dataInicio || d.dia > dataFim || (saborId !== null && d.saborId !== saborId) || d.unidades <= 0) continue;
    const i = diaDaSemanaISO(d.dia);
    unidades[i] += d.unidades;
    comVenda[i].add(d.dia);
  }
  const total = soma(unidades);
  const ocorrencias = semanas.length;
  return {
    semanas: ocorrencias,
    periodo: { dataInicio, dataFim },
    unidades: total,
    dias: DIAS_SEMANA.map((nome, i) => ({
      diaSemana: i,
      nome,
      unidades: unidades[i],
      ocorrencias,
      diasComVenda: comVenda[i].size,
      mediaPorOcorrencia: arred(unidades[i] / ocorrencias, 1),
      participacao: total > 0 ? arred((unidades[i] / total) * 100, 1) : null,
    })),
  };
}

/** Dia(s) da semana de maior média por ocorrência (empates mantidos). */
export function diasDeMaiorVenda(perfil) {
  if (!perfil || perfil.unidades === 0) return [];
  const max = Math.max(...perfil.dias.map((d) => d.unidades));
  return perfil.dias.filter((d) => d.unidades === max);
}

// ---------------------------------------------------------------- indicadores

/** Indicadores gerenciais de uma janela (consultarVendasPeriodo); regra compartilhada com o Agente de Vendas. */
export { indicadoresVendas };

/** Custo AGREGADO de uma janela (por data de lançamento) relativo às vendas da mesma janela. Nunca por sabor. */
export function indicadoresCustos(c, vendas) {
  return {
    natureza: "AGREGADO",
    periodo: c.periodo,
    lancamentos: c.quantidade,
    custoRegistrado: arred(c.valorTotal, 2),
    porCategoria: c.porCategoria.map((x) => ({ ...x, valorTotal: arred(x.valorTotal, 2) })),
    custoAgregadoPorUnidadeVendida: vendas?.unidades > 0 ? arred(c.valorTotal / vendas.unidades, 2) : null,
    custoSobreFaturamentoPercentual: vendas?.faturamentoRegistrado > 0 ? arred((c.valorTotal / vendas.faturamentoRegistrado) * 100, 1) : null,
    observacao: "Custos contam pela data de lançamento (compra), não de consumo: numa janela curta a relação oscila com o calendário de compras. Não existe custo nem margem por sabor (sem receitas cadastradas).",
  };
}

// ---------------------------------------------------------------- sabores

/**
 * Visão por sabor: unidades e participação na janela recente, média semanal
 * (só com amostra suficiente), variação e tendência entre as duas janelas.
 */
export function analisarSabores({ sabores, dias, janelas, porSabor, semanasSerie }) {
  const posRecente = semanasSerie.length - janelas.recente.length;
  const posAnterior = posRecente - janelas.anterior.length;
  const unidadesRecentesTotal = soma(sabores.map((s) => soma((porSabor.get(s.saborId) ?? []).slice(posRecente))));
  return sabores
    .map((s) => {
      const serie = porSabor.get(s.saborId) ?? semanasSerie.map(() => 0);
      const recente = soma(serie.slice(posRecente));
      const anterior = soma(serie.slice(posAnterior, posRecente));
      const demanda = demandaMediaSabor(s, janelas.recente, dias);
      const suficiente = qualidadeAmostra([...janelas.anterior, ...janelas.recente], s.primeiraVenda) === "SUFICIENTE";
      const v = variacao(anterior, recente);
      return {
        saborId: s.saborId,
        sabor: s.sabor,
        ativo: s.ativo,
        unidadesRecentes: recente,
        participacao: unidadesRecentesTotal > 0 ? arred((recente / unidadesRecentesTotal) * 100, 1) : null,
        mediaSemanal: demanda.mediaSemanal,
        qualidade: demanda.qualidade,
        variacao: v,
        ...classificarTendencia(v, { suficiente }),
        serieSemanal: serie,
      };
    })
    .filter((s) => s.ativo || s.serieSemanal.some((x) => x > 0))
    .sort((a, b) => b.unidadesRecentes - a.unidadesRecentes || a.sabor.localeCompare(b.sabor));
}

// ---------------------------------------------------------------- insights

const fmt = (n, casas = 1) => n.toLocaleString("pt-BR", { maximumFractionDigits: casas });
const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const nomeDia = (nome) => (["sábado", "domingo"].includes(nome) ? nome : `${nome}-feira`);

/** Frases determinísticas geradas a partir dos números (sem LLM). Poucas, e só com dado que as sustente. */
export function gerarInsights({ tendenciaTotal, janelas, sabores, perfil }) {
  const insights = [];
  const v = tendenciaTotal.variacao;
  const rec = periodoDe(janelas.recente);
  if (v.estado === "CALCULADA" && tendenciaTotal.tendencia !== "INDETERMINADA") {
    const sentido = v.percentual > 0 ? `${fmt(v.percentual)}% acima` : v.percentual < 0 ? `${fmt(-v.percentual)}% abaixo` : "iguais às";
    insights.push({
      tipo: "VARIACAO_VENDAS",
      texto: `As vendas das últimas ${janelas.recente.length} semanas completas (${dm(rec.dataInicio)} a ${dm(rec.dataFim)}) ficaram ${sentido}${v.percentual === 0 ? "" : " das"} ${janelas.anterior.length} semanas anteriores (${fmt(v.anterior, 0)} → ${fmt(v.recente, 0)} unidades): ${tendenciaTotal.tendencia === "ESTAVEL" ? "variação dentro da faixa considerada estável" : `tendência recente de ${tendenciaTotal.tendencia.toLowerCase()}`}.`,
      dados: { anterior: v.anterior, recente: v.recente, percentual: v.percentual, tendencia: tendenciaTotal.tendencia },
    });
  }
  const comParticipacao = sabores.filter((s) => s.participacao !== null && s.unidadesRecentes > 0);
  if (comParticipacao.length > 0) {
    const [a, b] = comParticipacao;
    const texto = b && a.participacao + b.participacao >= 50
      ? `${a.sabor} (${fmt(a.participacao)}%) e ${b.sabor} (${fmt(b.participacao)}%) somam ${fmt(arred(a.participacao + b.participacao, 1))}% das unidades das últimas ${janelas.recente.length} semanas.`
      : `${a.sabor} representa ${fmt(a.participacao)}% das unidades das últimas ${janelas.recente.length} semanas.`;
    insights.push({ tipo: "CONCENTRACAO_MIX", texto, dados: { sabores: comParticipacao.slice(0, 2).map((s) => ({ saborId: s.saborId, participacao: s.participacao })) } });
  }
  const maiores = diasDeMaiorVenda(perfil);
  if (maiores.length > 0) {
    const nomes = maiores.map((d) => nomeDia(d.nome)).join(" e ");
    insights.push({
      tipo: "DIA_DE_MAIOR_VENDA",
      texto: `${nomes[0].toUpperCase()}${nomes.slice(1)} ${maiores.length > 1 ? "têm" : "tem"} a maior média observada: ${fmt(maiores[0].mediaPorOcorrencia)} unidades por ${maiores.length > 1 ? "dia" : nomeDia(maiores[0].nome)} nas últimas ${perfil.semanas} semanas completas.`,
      dados: { dias: maiores.map((d) => d.diaSemana), mediaPorOcorrencia: maiores[0].mediaPorOcorrencia },
    });
  }
  for (const [tendencia, rotulo] of [["ALTA", "Em alta"], ["QUEDA", "Em queda"]]) {
    const lista = sabores.filter((s) => s.tendencia === tendencia);
    if (lista.length > 0) {
      insights.push({
        tipo: `SABORES_EM_${tendencia}`,
        texto: `${rotulo} nas últimas ${janelas.recente.length} semanas, em relação às ${janelas.anterior.length} anteriores: ${lista.map((s) => `${s.sabor} (${s.variacao.percentual > 0 ? "+" : ""}${fmt(s.variacao.percentual)}%)`).join(", ")}.`,
        dados: { sabores: lista.map((s) => ({ saborId: s.saborId, percentual: s.variacao.percentual })) },
      });
    }
  }
  const insuficientes = sabores.filter((s) => s.motivo === "DADOS_INSUFICIENTES" && s.ativo);
  if (insuficientes.length > 0) {
    insights.push({
      tipo: "HISTORICO_INSUFICIENTE",
      texto: `Sem ${2 * janelas.recente.length} semanas completas de histórico para medir tendência: ${insuficientes.map((s) => s.sabor).join(", ")}.`,
      dados: { sabores: insuficientes.map((s) => s.saborId) },
    });
  }
  return insights;
}
