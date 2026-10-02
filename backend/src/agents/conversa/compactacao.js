// Compactação das saídas dos especialistas para a conversa (Etapa 5). Puras.
//
// A saída COMPLETA de cada especialista continua na auditoria (ExecucaoAgente)
// e no runtime. O LLM recebe só uma visão compacta, por FOCO da intenção:
// métricas relevantes, qualidade dos dados, limitações e as frases
// determinísticas que os próprios especialistas já escrevem. Sai sem datasets
// internos, sem detalhes de auditoria e sem nomes de clientes; listas por
// cliente/venda vão num `anexo` à parte (só ids), que nunca é enviado ao LLM.
//
// Limite: cada visão cabe em LIMITE_FATOS caracteres. Se passar, ela é
// reduzida ESTRUTURALMENTE (a maior lista é encurtada e o nº de itens
// omitidos fica registrado), nunca cortada no meio do JSON.

export const LIMITE_FATOS = 3500;
const MAX_ALERTAS = 6;
const MAX_LIMITACOES = 4;

const filtroSabor = (saborId) => (x) => saborId == null || x.saborId === saborId || x.entidade?.id === saborId;
const semNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)));
const unicos = (lista) => [...new Set(lista.filter(Boolean))];

/** Reduz um objeto até caber em `limite`: encurta à metade a maior lista, repetidamente. Nunca corta texto. */
export function limitarEstruturalmente(fatos, limite = LIMITE_FATOS) {
  const copia = structuredClone(fatos);
  const omitidos = {};
  const maiorLista = (obj, caminho = []) => {
    let melhor = null;
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (Array.isArray(v) && v.length > 1 && (!melhor || JSON.stringify(v).length > melhor.tamanho)) melhor = { pai: obj, chave: k, caminho: [...caminho, k].join("."), tamanho: JSON.stringify(v).length };
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const m = maiorLista(v, [...caminho, k]);
        if (m && (!melhor || m.tamanho > melhor.tamanho)) melhor = m;
      }
    }
    return melhor;
  };
  while (JSON.stringify(copia).length > limite) {
    const alvo = maiorLista(copia);
    if (!alvo) break;
    const lista = alvo.pai[alvo.chave];
    const manter = Math.max(1, Math.floor(lista.length / 2));
    omitidos[alvo.caminho] = (omitidos[alvo.caminho] ?? 0) + (lista.length - manter);
    alvo.pai[alvo.chave] = lista.slice(0, manter);
  }
  const tamanho = JSON.stringify(copia).length;
  if (Object.keys(omitidos).length) copia.itensOmitidos = omitidos;
  return { fatos: copia, reduzido: Object.keys(omitidos).length > 0, cabe: tamanho <= limite };
}

// ---------------------------------------------------------------- Estoque

function estoque(s, { foco, saborId }) {
  const doSabor = filtroSabor(saborId);
  const limitacoes = [s.estoqueAcabado?.aviso, s.ritmo?.observacao, s.demanda?.observacao, s.clientes?.disponivel ? s.clientes.observacao : null];
  const alertas = (s.alertas ?? []).filter(doSabor).slice(0, MAX_ALERTAS).map((a) => ({ tipo: a.tipo, prioridade: a.prioridade, sabor: a.entidade?.tipo === "SABOR" ? a.entidade.nome : undefined, mensagem: a.mensagem }));
  const qualidade = { estoqueAcabado: s.qualidade?.estoqueAcabado?.confiabilidade, materiasPrimas: s.qualidade?.materiasPrimas?.confiabilidade, receitas: s.qualidade?.receitas?.confiabilidade, demandaMediaRecente: s.qualidade?.demandaMediaRecente?.confiabilidade };
  const base = { fonte: "AGENTE_ESTOQUE", dataReferencia: s.dataReferencia, qualidade: semNulos(qualidade) };
  let fatos;
  let textos = [];
  if (foco === "MATERIA_PRIMA") {
    fatos = { ...base, materiasPrimas: semNulos({ confiabilidade: s.materiasPrimas?.confiabilidade, motivo: s.materiasPrimas?.motivo, itens: (s.materiasPrimas?.itens ?? []).map((m) => ({ nome: m.nome, saldo: m.saldo, unidade: m.unidadeBase, situacao: m.situacao })) }), alertas: alertas.filter((a) => a.tipo.startsWith("MATERIA_PRIMA")) };
    limitacoes.unshift(s.materiasPrimas?.aviso);
  } else if (foco === "MRP") {
    const sim = s.mrp?.simulacao;
    fatos = { ...base, mrp: semNulos({ disponivel: s.mrp?.disponivel, estado: s.mrp?.estado, motivo: s.mrp?.motivo, saboresSemReceita: (s.mrp?.saboresSemReceita ?? []).map((x) => x.sabor), simulacao: sim?.executada ? { natureza: sim.natureza, podeProduzir: sim.podeProduzir, faltantes: sim.faltantes, aviso: sim.aviso } : { executada: false, motivo: sim?.motivo } }) };
    textos = alertas.filter((a) => ["MRP_INDISPONIVEL", "MATERIA_PRIMA_INSUFICIENTE"].includes(a.tipo)).map((a) => a.mensagem);
  } else {
    const ritmo = (s.ritmo?.sabores ?? []).filter(doSabor);
    const divergencias = (s.demanda?.divergencias ?? []).filter(doSabor);
    const clientes = (s.clientes?.sabores ?? []).filter(doSabor);
    fatos = {
      ...base,
      estoqueAcabado: semNulos({
        natureza: s.estoqueAcabado?.natureza,
        contagem: saborId == null ? s.estoqueAcabado?.contagem : undefined,
        sabores: (s.estoqueAcabado?.sabores ?? []).filter(doSabor).map((x) => ({ sabor: x.sabor, saldoContabilHistorico: x.saldo, situacao: x.situacao })),
      }),
      ritmo: s.ritmo?.disponivel ? { janela: { dataInicio: s.ritmo.janela.dataInicio, dataFim: s.ritmo.janela.dataFim, semanas: s.ritmo.janela.semanas }, fonteDemanda: s.ritmo.fonteDemanda, sabores: ritmo.map((x) => semNulos({ sabor: x.sabor, produzido: x.produzido, vendido: x.vendido, demandaMediaSemanal: x.demandaMediaSemanal, producaoMediaSemanal: x.producaoMediaSemanal, situacao: x.situacao, motivo: x.motivo })) } : { disponivel: false },
      divergencias: divergencias.map((d) => ({ sabor: d.sabor, saldo: d.saldo, semanasDeDemanda: d.semanasDeDemanda })),
      clientes: clientes.map((c) => ({ sabor: c.sabor, clientesComCompraRecente: c.clientesComCompraRecente, clientesRecorrentes: c.clientesRecorrentes, participacaoClientesRecorrentes: c.participacaoClientesRecorrentes })),
      alertas,
      recomendacoes: (s.recomendacoes ?? []).map((r) => ({ tipo: r.tipo, prioridade: r.prioridade, titulo: r.titulo })),
    };
    textos = [...ritmo.map((x) => x.texto), ...divergencias.map((d) => d.texto), ...clientes.map((c) => c.texto)];
  }
  return { fatos: semNulos(fatos), textos: unicos(textos), limitacoes: unicos(limitacoes).slice(0, MAX_LIMITACOES) };
}

// ---------------------------------------------------------------- Inteligência

function inteligencia(s, { foco, saborId }) {
  const doSabor = filtroSabor(saborId);
  const base = { fonte: "AGENTE_INTELIGENCIA", dataReferencia: s.dataReferencia, periodo: { recente: s.periodo?.recente, anterior: s.periodo?.anterior } };
  const limitacoes = [s.tendencias?.observacao, ...(s.limitacoes ?? []).slice(0, 2)];
  const sabores = (s.sabores ?? []).filter(doSabor).map((x) => semNulos({ sabor: x.sabor, unidadesRecentes: x.unidadesRecentes, participacao: x.participacao, mediaSemanal: x.mediaSemanal, qualidade: x.qualidade, variacaoPercentual: x.variacao?.percentual, tendencia: x.tendencia, motivo: x.motivo }));
  let fatos;
  let textos = [];
  if (foco === "PERFIL") {
    const perfil = saborId != null ? (s.perfilDiaSemana?.porSabor ?? []).find((p) => p.saborId === saborId) : s.perfilDiaSemana?.total;
    fatos = { ...base, periodo: s.periodo?.perfil, perfilDiaSemana: s.perfilDiaSemana?.disponivel && perfil ? { qualidade: s.perfilDiaSemana.qualidade, semanas: perfil.semanas, dias: perfil.dias.map((d) => ({ dia: d.nome, unidades: d.unidades, mediaPorOcorrencia: d.mediaPorOcorrencia, participacao: d.participacao })) } : { disponivel: false } };
    textos = (s.insights ?? []).filter((i) => i.tipo === "DIA_DE_MAIOR_VENDA").map((i) => i.texto);
    limitacoes.unshift(s.perfilDiaSemana?.observacao);
  } else if (foco === "INDICADORES") {
    const r = s.indicadores?.recente;
    fatos = {
      ...base,
      indicadores: r ? semNulos({ quantidadeVendas: r.quantidadeVendas, unidades: r.unidades, faturamentoRegistrado: r.faturamentoRegistrado, ticketMedio: r.ticketMedio, vendasPendentes: r.pagamentos?.vendasPendentes, valorPendente: r.pagamentos?.valorPendente, qualidadePagamento: r.pagamentos?.historicoPagamento?.classificacao }) : { disponivel: false },
      variacao: semNulos({ unidadesPercentual: s.indicadores?.variacao?.unidades?.percentual, faturamentoPercentual: s.indicadores?.variacao?.faturamentoRegistrado?.percentual }),
      custoAgregado: s.indicadores?.custos?.natureza === "AGREGADO" ? semNulos({ custoRegistrado: s.indicadores.custos.custoRegistrado, porUnidadeVendida: s.indicadores.custos.custoAgregadoPorUnidadeVendida, sobreFaturamentoPercentual: s.indicadores.custos.custoSobreFaturamentoPercentual }) : undefined,
    };
    textos = (s.insights ?? []).filter((i) => i.tipo === "VARIACAO_VENDAS").map((i) => i.texto);
    limitacoes.unshift(s.indicadores?.custos?.observacao, s.indicadores?.recente?.pagamentos?.observacao);
  } else {
    // TENDENCIA e GERAL
    fatos = {
      ...base,
      tendenciaTotal: s.tendencias?.disponivel ? semNulos({ tendencia: s.tendencias.total?.tendencia, variacaoPercentual: s.tendencias.total?.variacao?.percentual, motivo: s.tendencias.total?.motivo }) : { disponivel: false },
      sabores,
      ...(foco === "GERAL" && { indicadores: semNulos({ quantidadeVendas: s.indicadores?.recente?.quantidadeVendas, unidades: s.indicadores?.recente?.unidades, faturamentoRegistrado: s.indicadores?.recente?.faturamentoRegistrado }) }),
    };
    textos = (s.insights ?? []).filter((i) => saborId == null || ["SABORES_EM_ALTA", "SABORES_EM_QUEDA"].includes(i.tipo)).map((i) => i.texto);
  }
  return { fatos: semNulos(fatos), textos: unicos(textos), limitacoes: unicos(limitacoes).slice(0, MAX_LIMITACOES) };
}

function demandaMedia(s) {
  const fatos = {
    fonte: "AGENTE_INTELIGENCIA",
    dataReferencia: s.dataReferencia,
    metodologia: { tipo: s.metodologia?.tipo, janelaSemanas: s.metodologia?.janelaSemanas, periodo: s.metodologia?.periodo },
    sabores: (s.sabores ?? []).map((x) => semNulos({ sabor: x.sabor, qualidade: x.qualidade, mediaSemanal: x.mediaSemanal, mediaDiaria: x.mediaDiaria, unidadesVendidas: x.unidadesVendidas })),
  };
  const n = s.metodologia?.janelaSemanas;
  const p = s.metodologia?.periodo;
  const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const janela = p ? `${n} semanas completas, ${dm(p.dataInicio)} a ${dm(p.dataFim)}` : `${n} semanas completas`;
  const fmt = (x) => x.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const textos = (s.sabores ?? []).map((x) => (x.qualidade === "SUFICIENTE"
    ? `A demanda média recente de ${x.sabor} é ${fmt(x.mediaSemanal)} un./semana (${janela}).`
    : `${x.sabor} não tem histórico de vendas em todas as ${janela}: sem média (${x.qualidade === "SEM_HISTORICO" ? "sem histórico" : "dados insuficientes"}).`));
  return { fatos, textos, limitacoes: unicos([s.metodologia?.observacao, s.metodologia?.criterioSuficiencia]) };
}

// ---------------------------------------------------------------- Vendas

function vendas(s, { foco, saborId }) {
  const doSabor = filtroSabor(saborId);
  const base = { fonte: "AGENTE_VENDAS", dataReferencia: s.dataReferencia, periodo: s.periodo ? { dataInicio: s.periodo.dataInicio, dataFim: s.periodo.dataFim, semanas: s.periodo.semanas } : undefined };
  const limitacoes = (s.limitacoes ?? []).slice(0, 2);
  let fatos;
  let textos = [];
  let anexo;
  if (foco === "RECEBIVEIS") {
    const r = s.recebiveis ?? {};
    fatos = { ...base, recebiveis: r.disponivel ? semNulos({ quantidade: r.quantidade, valorPendente: r.valorPendente, clientes: r.clientes, maiorTempoEmAberto: r.maiorTempoEmAberto, faixasTempoEmAberto: r.faixas, qualidadePagamento: r.historicoPagamento?.classificacao }) : { disponivel: false } };
    textos = (s.insights ?? []).filter((i) => i.tipo === "RECEBIVEIS").map((i) => i.texto);
    limitacoes.unshift(r.historicoPagamento?.observacao);
    if (r.disponivel && r.vendas?.length) anexo = { tipo: "RECEBIVEIS", itens: r.vendas.map((v) => ({ vendaId: v.vendaId, clienteId: v.clienteId, valor: v.valor, dataVenda: v.dataVenda, diasEmAberto: v.diasEmAberto })) };
  } else if (foco === "RECORRENCIA") {
    const r = s.recorrencia ?? {};
    fatos = { ...base, recorrencia: r.disponivel ? { criterio: r.criterio, resumo: r.resumo } : { disponivel: false } };
    textos = (s.insights ?? []).filter((i) => i.tipo === "RECORRENCIA").map((i) => i.texto);
    limitacoes.unshift(r.observacao);
    const fora = (r.clientes ?? []).filter((c) => c.classificacao === "FORA_DO_PADRAO_HISTORICO");
    if (fora.length) anexo = { tipo: "CLIENTES_FORA_DO_PADRAO", itens: fora.map((c) => ({ clienteId: c.clienteId, compras: c.compras, medianaIntervalo: c.medianaIntervalo, diasDesdeUltimaCompra: c.diasDesdeUltimaCompra })) };
  } else {
    // VENDAS, MIX e GERAL
    const i = s.indicadores ?? {};
    const mix = (s.mix?.sabores ?? []).filter(doSabor).map((x) => semNulos({ posicao: x.posicao, sabor: x.sabor, unidades: x.unidades, participacao: x.participacao, clientesRecorrentes: x.clientesRecorrentes, participacaoClientesRecorrentes: x.participacaoClientesRecorrentes }));
    fatos = {
      ...base,
      ...(foco !== "MIX" && { indicadores: i.disponivel ? semNulos({ quantidadeVendas: i.quantidadeVendas, unidades: i.unidades, faturamentoRegistrado: i.faturamentoRegistrado, ticketMedio: i.ticketMedio, clientesCompradores: i.clientesCompradores, vendasPendentes: i.pagamentos?.vendasPendentes, valorPendente: i.pagamentos?.valorPendente, qualidadePagamento: i.pagamentos?.historicoPagamento?.classificacao }) : { disponivel: false } }),
      mix,
      ...(foco !== "VENDAS" && saborId == null && s.mix?.concentracao && { concentracao: { duasMaiores: s.mix.concentracao.duasMaiores, maiorParticipacao: s.mix.concentracao.maiorParticipacao } }),
      ...(foco === "GERAL" && { recebiveis: semNulos({ quantidade: s.recebiveis?.quantidade, valorPendente: s.recebiveis?.valorPendente }), clientesForaDoPadrao: s.recorrencia?.resumo?.foraDoPadraoHistorico }),
    };
    textos = (s.insights ?? []).filter((x) => foco === "GERAL" || x.tipo === "MIX_SABORES").map((x) => x.texto);
  }
  return { fatos: semNulos(fatos), textos: unicos(textos), limitacoes: unicos(limitacoes).slice(0, MAX_LIMITACOES), ...(anexo && { anexo }) };
}

/** Visão compacta de uma saída de especialista para um foco (e sabor opcional). */
export function compactar({ agente, tipo, saida, foco, saborId = null }) {
  let r;
  if (agente === "estoque") r = estoque(saida, { foco, saborId });
  else if (agente === "inteligencia" && tipo === "DEMANDA_MEDIA") r = demandaMedia(saida);
  else if (agente === "inteligencia") r = inteligencia(saida, { foco, saborId });
  else if (agente === "vendas") r = vendas(saida, { foco, saborId });
  else throw new Error(`Sem compactação para ${agente}/${tipo}`);
  const limitado = limitarEstruturalmente(r.fatos);
  return { ...r, fatos: limitado.fatos, reduzido: limitado.reduzido };
}
