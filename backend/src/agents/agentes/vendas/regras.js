// Agente de Vendas — REGRAS (Etapa 4). Funções puras e determinísticas: sem
// banco, sem tools, sem LLM, sem relógio (a data de referência é recebida).
// Documento: docs/tcc/etapa-4-agente-vendas.md.
//
// Só fatos observados. Pode dizer: cliente comprou, recomprou, intervalo
// histórico, venda pendente há X dias, sabor representa X% das unidades.
// Nunca: inadimplente, atrasado, vencido, "vai comprar", "abandonou". Não
// existe data de vencimento no sistema: tempo em aberto não é atraso.
import { diasEntre } from "../../../lib/periodos.js";
import { qualidadePagamento } from "../../contratos/marcosDados.js";

/** Parâmetros (explícitos, documentados e testados nas fronteiras). */
export const PARAMETROS = Object.freeze({
  /** Semanas completas da janela de indicadores, mix e exposição (a mesma dos outros agentes). */
  JANELA_SEMANAS: 4,
  /**
   * Faixas de TEMPO EM ABERTO (dias desde a venda), não de vencimento.
   * `ate: null` = sem limite superior.
   */
  FAIXAS_TEMPO_EM_ABERTO: Object.freeze([
    Object.freeze({ faixa: "0-7", de: 0, ate: 7 }),
    Object.freeze({ faixa: "8-15", de: 8, ate: 15 }),
    Object.freeze({ faixa: "16-30", de: 16, ate: 30 }),
    Object.freeze({ faixa: "31+", de: 31, ate: null }),
  ]),
  /** Pendência com pelo menos este tempo em aberto eleva a recomendação de BAIXA para MEDIA (é a última faixa). */
  TEMPO_EM_ABERTO_PRIORIDADE_MEDIA: 31,
  /**
   * Ocasiões de compra (dias com venda) mínimas para classificar o padrão de
   * recompra: 4 compras = 3 intervalos completos. Na cópia real, o mínimo 3
   * daria 45 clientes elegíveis; 4 dá 41; 5 dá 40 (de 52): 4 é estável.
   */
  MIN_COMPRAS_RECORRENCIA: 4,
  /**
   * FORA_DO_PADRAO_HISTORICO quando os dias desde a última compra passam de
   * 2 × a mediana dos intervalos do PRÓPRIO cliente ("mais que o dobro do
   * intervalo típico dele"). Calibrado na cópia real (41 elegíveis): 5 casos,
   * igual a mediana + 3·MAD e mais simples; "maior intervalo já visto" (3) não
   * detecta quem teve uma única pausa longa no passado.
   */
  MULTIPLICADOR_FORA_DO_PADRAO: 2,
});

const soma = (v) => v.reduce((s, x) => s + x, 0);
export const arred = (x, casas = 2) => Math.round(x * 10 ** casas) / 10 ** casas;

/** Mediana (média dos dois centrais quando o tamanho é par); null para lista vazia. */
export function mediana(valores) {
  if (valores.length === 0) return null;
  const s = [...valores].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const dia = (dataHoraCivil) => dataHoraCivil.slice(0, 10); // "2026-09-20T12:00:00.000-04:00" → "2026-09-20"
const brl = (v) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

// ---------------------------------------------------------------- recebíveis

export function faixaTempoEmAberto(dias) {
  return PARAMETROS.FAIXAS_TEMPO_EM_ABERTO.find((f) => dias >= f.de && (f.ate === null || dias <= f.ate)).faixa;
}

/**
 * Recebíveis = vendas com pago = false NO REGISTRO ATUAL, com data até a
 * referência. Para cada uma: tempo em aberto (dias civis desde a venda) e a
 * faixa. Só ids de cliente. Nenhuma noção de vencimento ou atraso.
 */
export function analisarRecebiveis(rec, dataReferencia) {
  if (!rec) return { disponivel: false, motivo: "FALHA_CONSULTA_RECEBIVEIS" };
  const todas = rec.vendas.map((v) => ({ vendaId: v.vendaId, clienteId: v.cliente.id, valor: v.valor, unidades: v.unidades, dataVenda: dia(v.data) }));
  const vendas = todas
    .filter((v) => v.dataVenda <= dataReferencia)
    .map((v) => {
      const diasEmAberto = diasEntre(v.dataVenda, dataReferencia);
      return { ...v, diasEmAberto, faixa: faixaTempoEmAberto(diasEmAberto) };
    })
    .sort((a, b) => b.diasEmAberto - a.diasEmAberto || a.vendaId - b.vendaId);
  const faixas = PARAMETROS.FAIXAS_TEMPO_EM_ABERTO.map(({ faixa }) => {
    const nela = vendas.filter((v) => v.faixa === faixa);
    return { faixa, quantidade: nela.length, valor: arred(soma(nela.map((v) => v.valor)), 2) };
  });
  const maisAntiga = vendas[0]?.dataVenda ?? null;
  return {
    disponivel: true,
    natureza: "PENDENTE_NO_REGISTRO",
    quantidade: vendas.length,
    valorPendente: arred(soma(vendas.map((v) => v.valor)), 2),
    clientes: new Set(vendas.map((v) => v.clienteId)).size,
    faixas,
    maiorTempoEmAberto: vendas[0]?.diasEmAberto ?? null,
    vendas,
    ...(todas.length > vendas.length && { posterioresAReferencia: todas.length - vendas.length }),
    ...(rec.truncado && { truncado: true, aviso: `Só as ${rec.vendas.length} pendências mais antigas foram listadas (de ${rec.quantidade}).` }),
    historicoPagamento: {
      ...qualidadePagamento(maisAntiga ?? dataReferencia),
      observacao: "Pendente = venda ainda não marcada como paga no registro atual. Não existe data de vencimento: tempo em aberto não é atraso nem inadimplência. dataPagamento registra quando o gestor marcou a venda, não o recebimento.",
    },
  };
}

// ---------------------------------------------------------------- recorrência

/**
 * Ocasiões de compra { clienteId, dia } → por cliente: compras (dias distintos
 * com venda; o mesmo dia conta uma vez), primeira e última, intervalos entre
 * compras consecutivas (dias), mediana (robusta a uma pausa longa isolada),
 * maior intervalo, dias desde a última compra e a classificação.
 */
export function recorrenciaClientes(compras, dataReferencia) {
  const porCliente = new Map();
  for (const c of compras) {
    if (c.dia > dataReferencia) continue;
    if (!porCliente.has(c.clienteId)) porCliente.set(c.clienteId, new Set());
    porCliente.get(c.clienteId).add(c.dia);
  }
  return [...porCliente.entries()]
    .map(([clienteId, conjunto]) => {
      const dias = [...conjunto].sort();
      const intervalos = dias.slice(1).map((d, i) => diasEntre(dias[i], d));
      const desde = diasEntre(dias.at(-1), dataReferencia);
      const med = mediana(intervalos);
      const elegivel = dias.length >= PARAMETROS.MIN_COMPRAS_RECORRENCIA;
      const limite = elegivel ? PARAMETROS.MULTIPLICADOR_FORA_DO_PADRAO * med : null;
      return {
        clienteId,
        compras: dias.length,
        primeiraCompra: dias[0],
        ultimaCompra: dias.at(-1),
        intervalos,
        medianaIntervalo: med,
        maiorIntervalo: intervalos.length ? Math.max(...intervalos) : null,
        diasDesdeUltimaCompra: desde,
        limiteForaDoPadrao: limite,
        classificacao: !elegivel ? "DADOS_INSUFICIENTES" : desde > limite ? "FORA_DO_PADRAO_HISTORICO" : "DENTRO_DO_PADRAO",
      };
    })
    .sort((a, b) => a.clienteId - b.clienteId);
}

export function resumirRecorrencia(clientes) {
  const por = (c) => clientes.filter((x) => x.classificacao === c).length;
  const elegiveis = clientes.filter((c) => c.classificacao !== "DADOS_INSUFICIENTES");
  return {
    clientes: clientes.length,
    elegiveis: elegiveis.length,
    dadosInsuficientes: por("DADOS_INSUFICIENTES"),
    dentroDoPadrao: por("DENTRO_DO_PADRAO"),
    foraDoPadraoHistorico: por("FORA_DO_PADRAO_HISTORICO"),
    comRecompra: clientes.filter((c) => c.compras >= 2).length,
    medianaDasMedianas: mediana(elegiveis.map((c) => c.medianaIntervalo)),
    medianaGeralIntervalos: mediana(clientes.flatMap((c) => c.intervalos)),
  };
}

// ---------------------------------------------------------------- mix e exposição

/** Unidades por sabor na janela, participação, ranking e concentração (insight, não alerta). */
export function mixSabores(dias, sabores, periodo) {
  const unidades = new Map();
  for (const d of dias) if (d.dia >= periodo.dataInicio && d.dia <= periodo.dataFim) unidades.set(d.saborId, (unidades.get(d.saborId) ?? 0) + d.unidades);
  const total = soma([...unidades.values()]);
  const nome = new Map(sabores.map((s) => [s.saborId, s.sabor]));
  const linhas = [...unidades.entries()]
    .filter(([, u]) => u > 0)
    .map(([saborId, u]) => ({ saborId, sabor: nome.get(saborId) ?? `#${saborId}`, unidades: u, participacao: arred((u / total) * 100, 1) }))
    .sort((a, b) => b.unidades - a.unidades || a.sabor.localeCompare(b.sabor))
    .map((l, i) => ({ posicao: i + 1, ...l }));
  const fracoes = linhas.map((l) => l.unidades / total);
  return {
    periodo,
    unidades: total,
    vazio: total === 0,
    sabores: linhas,
    concentracao: total === 0 ? null : {
      maiorParticipacao: linhas[0].participacao,
      duasMaiores: arred(((linhas[0].unidades + (linhas[1]?.unidades ?? 0)) / total) * 100, 1),
      indiceHerfindahl: arred(soma(fracoes.map((f) => f * f)), 3),
      observacao: "Concentração descreve o mix; não é problema por si só.",
    },
  };
}

/**
 * Exposição por sabor na janela: clientes que compraram o sabor, quantos
 * deles são RECORRENTES (≥ MIN_COMPRAS_RECORRENCIA ocasiões de compra até a
 * referência) e a parcela das unidades que veio deles. Só contagens.
 */
export function exposicaoPorSabor({ linhas, recorrencia, sabores }) {
  const recorrente = new Set(recorrencia.filter((c) => c.compras >= PARAMETROS.MIN_COMPRAS_RECORRENCIA).map((c) => c.clienteId));
  return sabores.map(({ saborId, sabor }) => {
    const doSabor = linhas.filter((l) => l.saborId === saborId && l.unidades > 0);
    const unidades = soma(doSabor.map((l) => l.unidades));
    const deRecorrentes = doSabor.filter((l) => recorrente.has(l.clienteId));
    const unidadesRec = soma(deRecorrentes.map((l) => l.unidades));
    return {
      saborId,
      sabor,
      qualidade: unidades > 0 ? "COM_VENDAS_NA_JANELA" : "SEM_VENDAS_NA_JANELA",
      unidadesRecentes: unidades,
      clientesComCompraRecente: doSabor.length,
      clientesRecorrentes: deRecorrentes.length,
      clientesSemHistoricoSuficiente: doSabor.length - deRecorrentes.length,
      unidadesDeClientesRecorrentes: unidadesRec,
      participacaoClientesRecorrentes: unidades > 0 ? arred((unidadesRec / unidades) * 100, 1) : null,
    };
  });
}

// ---------------------------------------------------------------- recomendações e insights

/** Tipos de recomendação deste agente (agregadas, deduplicadas por chave). */
export const RECOMENDACAO = Object.freeze({
  REVISAR_RECEBIVEIS_PENDENTES: "REVISAR_RECEBIVEIS_PENDENTES",
  REVISAR_CLIENTES_FORA_PADRAO: "REVISAR_CLIENTES_FORA_PADRAO",
});

/**
 * No máximo UMA recomendação por tema, com a lista estruturada nos dados:
 *   REVISAR_RECEBIVEIS_PENDENTES enquanto houver pendência (sem limiar
 *     monetário); BAIXA, ou MEDIA se alguma estiver há 31+ dias em aberto;
 *   REVISAR_CLIENTES_FORA_PADRAO se algum cliente elegível estiver fora do
 *     próprio padrão histórico; BAIXA.
 */
export function gerarRecomendacoes({ recebiveis, recorrencia }) {
  const recs = [];
  if (recebiveis.disponivel && recebiveis.quantidade > 0) {
    const longas = recebiveis.vendas.filter((v) => v.diasEmAberto >= PARAMETROS.TEMPO_EM_ABERTO_PRIORIDADE_MEDIA).length;
    recs.push({
      tipo: RECOMENDACAO.REVISAR_RECEBIVEIS_PENDENTES,
      chave: "recebiveis-pendentes",
      prioridade: longas > 0 ? "MEDIA" : "BAIXA",
      titulo: "Revisar as vendas pendentes de pagamento",
      descricao: `Há ${recebiveis.quantidade} venda(s) ainda não marcada(s) como paga(s), somando ${brl(recebiveis.valorPendente)}. Tempo em aberto: ${recebiveis.faixas.filter((f) => f.quantidade > 0).map((f) => `${f.quantidade} em ${f.faixa} dias`).join(", ")}. Confira se já foram recebidas e marque as pagas; não há data de vencimento, então isso não indica atraso.`,
      dados: { quantidade: recebiveis.quantidade, valorPendente: recebiveis.valorPendente, faixas: recebiveis.faixas, vendaIds: recebiveis.vendas.map((v) => v.vendaId) },
    });
  }
  if (recorrencia.disponivel) {
    const fora = recorrencia.clientes.filter((c) => c.classificacao === "FORA_DO_PADRAO_HISTORICO");
    if (fora.length > 0) {
      recs.push({
        tipo: RECOMENDACAO.REVISAR_CLIENTES_FORA_PADRAO,
        chave: "clientes-fora-padrao",
        prioridade: "BAIXA",
        titulo: "Revisar clientes fora do próprio padrão de compra",
        descricao: `${fora.length} cliente(s) com histórico de recompra estão há mais tempo sem comprar do que o dobro do intervalo típico de cada um. É um desvio do comportamento observado, não uma previsão: vale verificar se houve mudança (pausa, troca de fornecedor, fechamento) antes de qualquer contato.`,
        dados: { clientes: fora.map((c) => ({ clienteId: c.clienteId, compras: c.compras, medianaIntervalo: c.medianaIntervalo, diasDesdeUltimaCompra: c.diasDesdeUltimaCompra, ultimaCompra: c.ultimaCompra })) },
      });
    }
  }
  return recs;
}

/** Tipos cuja condição foi avaliada nesta análise (só esses podem ser resolvidos automaticamente). */
export function tiposAvaliados({ recebiveis, recorrencia }) {
  return [
    ...(recebiveis.disponivel ? [RECOMENDACAO.REVISAR_RECEBIVEIS_PENDENTES] : []),
    ...(recorrencia.disponivel ? [RECOMENDACAO.REVISAR_CLIENTES_FORA_PADRAO] : []),
  ];
}

/** Frases determinísticas a partir dos números (sem LLM, sem previsão). */
export function gerarInsights({ mix, recebiveis, recorrencia }) {
  const insights = [];
  if (mix?.concentracao) {
    const [a, b] = mix.sabores;
    insights.push({
      tipo: "MIX_SABORES",
      texto: b
        ? `${a.sabor} representa ${pct(a.participacao)} das unidades da janela; com ${b.sabor} (${pct(b.participacao)}), as duas maiores somam ${pct(mix.concentracao.duasMaiores)}.`
        : `${a.sabor} representa ${pct(a.participacao)} das unidades da janela.`,
    });
  }
  if (recorrencia?.disponivel && recorrencia.resumo.clientes > 0) {
    const r = recorrencia.resumo;
    insights.push({
      tipo: "RECORRENCIA",
      texto: `${r.comRecompra} de ${r.clientes} clientes já recompraram; ${r.elegiveis} têm histórico suficiente (${PARAMETROS.MIN_COMPRAS_RECORRENCIA}+ compras) e ${r.foraDoPadraoHistorico} ${r.foraDoPadraoHistorico === 1 ? "deles está" : "deles estão"} fora do próprio padrão histórico de compra.`,
    });
  }
  if (recebiveis?.disponivel) {
    insights.push({
      tipo: "RECEBIVEIS",
      texto: recebiveis.quantidade === 0
        ? "Não há vendas pendentes de pagamento no registro."
        : `${recebiveis.quantidade} venda(s) pendente(s) no registro (${brl(recebiveis.valorPendente)}); a mais antiga está há ${recebiveis.maiorTempoEmAberto} dia(s) em aberto.`,
    });
  }
  return insights;
}
