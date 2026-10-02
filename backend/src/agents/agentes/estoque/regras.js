// Agente de Estoque — REGRAS (Etapa 2). Funções puras e determinísticas: sem
// banco, sem tools, sem LLM. Recebem os dados que as tools devolveram e
// produzem diagnóstico, alertas e recomendações. Documento:
// docs/tcc/etapa-2-agente-estoque.md.
//
// Princípio: dado confiável → análise; utilizável com ressalvas → análise +
// aviso; inadequado → nenhuma conclusão operacional. Nada é inventado: sem
// estoque mínimo, lead time, fornecedor, cobertura em dias ou lista de compras.

/** Limiares (todos explícitos e testados). */
export const LIMITES = Object.freeze({
  /** Janelas de comparação produção × vendas (dias, terminando na data de referência). */
  JANELAS_RITMO: Object.freeze([7, 30]),
  /** Vendas mínimas na janela de 30 dias para avaliar o ritmo de um sabor (evita ruído de baixo giro). */
  RITMO_VENDAS_MINIMAS_30: 20,
  /** Vendas mínimas na janela de 7 dias para a janela curta confirmar o desvio. */
  RITMO_VENDAS_MINIMAS_7: 5,
  /** Produção abaixo de 90% das vendas: os 10% absorvem defasagem entre o dia em que se produz e o dia em que se vende. */
  RITMO_RAZAO_ABAIXO: 0.9,
  /** Produção acima de 150% das vendas: excesso relevante para um produto de giro rápido. */
  RITMO_RAZAO_ACIMA: 1.5,
  /** Produção mínima na janela de 30 dias para apontar produção acima das vendas. */
  RITMO_PRODUCAO_MINIMA_30: 20,
  /** Saldo histórico positivo "alto": ≥ 50 unidades E ≥ 20% de tudo o que foi produzido. */
  SALDO_ACUMULADO_ABSOLUTO: 50,
  SALDO_ACUMULADO_PERCENTUAL: 0.2,
  /** Contagem física vira ALTA quando MAIS da metade dos sabores com movimento está negativa. */
  CONTAGEM_FISICA_ALTA_ACIMA_DE: 0.5,
});

/** Tipos de alerta (taxonomia da Etapa 2). */
export const ALERTA = Object.freeze({
  SALDO_NEGATIVO: "SALDO_NEGATIVO",
  DIVERGENCIA_ESTOQUE: "DIVERGENCIA_ESTOQUE",
  DADOS_ESTOQUE_NAO_RECONCILIADOS: "DADOS_ESTOQUE_NAO_RECONCILIADOS",
  MATERIA_PRIMA_NEGATIVA: "MATERIA_PRIMA_NEGATIVA",
  MATERIA_PRIMA_SEM_MOVIMENTO: "MATERIA_PRIMA_SEM_MOVIMENTO",
  RECEITA_AUSENTE: "RECEITA_AUSENTE",
  MRP_INDISPONIVEL: "MRP_INDISPONIVEL",
  MATERIA_PRIMA_INSUFICIENTE: "MATERIA_PRIMA_INSUFICIENTE",
  RITMO_PRODUCAO_ABAIXO_VENDAS: "RITMO_PRODUCAO_ABAIXO_VENDAS",
  RITMO_PRODUCAO_ACIMA_VENDAS: "RITMO_PRODUCAO_ACIMA_VENDAS",
});

/** Tipos de recomendação que este agente cria e mantém (deduplicadas por chave). */
export const RECOMENDACAO = Object.freeze({
  CONTAGEM_FISICA: "CONTAGEM_FISICA",
  REVISAR_REGISTROS_SABOR: "REVISAR_REGISTROS_SABOR",
  CADASTRAR_RECEITAS: "CADASTRAR_RECEITAS",
  REVISAR_MOVIMENTACOES_MATERIA_PRIMA: "REVISAR_MOVIMENTACOES_MATERIA_PRIMA",
});

const sabor = (s) => ({ tipo: "SABOR", id: s.saborId, nome: s.sabor });
const materiaPrima = (m) => ({ tipo: "MATERIA_PRIMA", id: m.materiaPrimaId, nome: m.nome });
const SISTEMA = Object.freeze({ tipo: "SISTEMA" });
const alerta = (tipo, prioridade, entidade, mensagem, dados = {}, subtipo) =>
  ({ tipo, ...(subtipo && { subtipo }), prioridade, entidade, mensagem, dados });
const listaNomes = (itens) => itens.map((i) => i.sabor ?? i.nome).join(", ");

// ---------------------------------------------------------------- estoque acabado

/**
 * Saldo de produto acabado = produção − vendas, histórico inteiro. NÃO é
 * estoque físico: nunca houve contagem física (Etapa 0.2, Opção C).
 */
export function diagnosticarEstoqueAcabado(estoque) {
  if (!estoque) {
    return { disponivel: false, motivo: "FALHA_CONSULTA_ESTOQUE", natureza: "SALDO_CONTABIL_HISTORICO" };
  }
  const sabores = estoque.itens.map((i) => ({
    ...i,
    situacao: i.saldo > 0 ? "POSITIVO" : i.saldo < 0 ? "NEGATIVO" : "ZERADO",
  }));
  const conta = (s) => sabores.filter((x) => x.situacao === s).length;
  return {
    disponivel: true,
    natureza: "SALDO_CONTABIL_HISTORICO",
    aviso: "Saldo calculado como produção − vendas de todo o histórico. Não representa o estoque físico: ainda não houve reconciliação por contagem física.",
    sabores,
    contagem: { sabores: sabores.length, positivos: conta("POSITIVO"), zerados: conta("ZERADO"), negativos: conta("NEGATIVO") },
    totais: { produzido: estoque.totalProduzido, vendido: estoque.totalVendido, saldo: estoque.totalSaldo },
  };
}

export function alertasEstoqueAcabado(diag) {
  if (!diag.disponivel) return [];
  const alertas = [];
  for (const s of diag.sabores) {
    if (s.situacao === "NEGATIVO" && s.produzido === 0) {
      alertas.push(alerta(ALERTA.DIVERGENCIA_ESTOQUE, "MEDIA", sabor(s),
        `Há ${s.vendido} unidade(s) de ${s.sabor} vendida(s) sem nenhuma produção registrada. Os registros de produção e vendas precisam ser revisados.`,
        { produzido: s.produzido, vendido: s.vendido, saldo: s.saldo }, "VENDA_SEM_PRODUCAO"));
    } else if (s.situacao === "NEGATIVO") {
      alertas.push(alerta(ALERTA.SALDO_NEGATIVO, "MEDIA", sabor(s),
        `Há divergência histórica de estoque para ${s.sabor}: o saldo calculado está negativo em ${Math.abs(s.saldo)} unidade(s). É necessária reconciliação física antes de usar esse valor operacionalmente.`,
        { produzido: s.produzido, vendido: s.vendido, saldo: s.saldo, divergenciaSobreVendas: Number((Math.abs(s.saldo) / s.vendido).toFixed(3)) }));
    } else if (
      s.situacao === "POSITIVO" &&
      s.saldo >= LIMITES.SALDO_ACUMULADO_ABSOLUTO &&
      s.saldo / s.produzido >= LIMITES.SALDO_ACUMULADO_PERCENTUAL
    ) {
      alertas.push(alerta(ALERTA.DIVERGENCIA_ESTOQUE, "BAIXA", sabor(s),
        `O saldo histórico de ${s.sabor} acumula ${s.saldo} unidade(s) (${Math.round((s.saldo / s.produzido) * 100)}% de tudo o que foi produzido). Pode haver vendas ou perdas não registradas; só a contagem física confirma.`,
        { produzido: s.produzido, vendido: s.vendido, saldo: s.saldo }, "SALDO_ACUMULADO_ALTO"));
    }
  }
  if (diag.sabores.length > 0) {
    const comDivergencia = alertas.some((a) => a.prioridade !== "BAIXA");
    alertas.push(alerta(ALERTA.DADOS_ESTOQUE_NAO_RECONCILIADOS, comDivergencia ? "MEDIA" : "BAIXA", SISTEMA,
      "O estoque de produto acabado é um saldo contábil histórico, não reconciliado por contagem física.",
      { saboresNegativos: diag.contagem.negativos, sabores: diag.contagem.sabores }));
  }
  return alertas;
}

// ---------------------------------------------------------------- matéria-prima

/**
 * Saldo de matéria-prima = soma das movimentações. Também não foi conferido
 * fisicamente; o sinalizador "saldo baixo" legado (< 200) é IGNORADO.
 */
export function diagnosticarMateriasPrimas(mps) {
  if (!mps) return { disponivel: false, confiabilidade: "INDISPONIVEL", motivo: "FALHA_CONSULTA_MATERIAS_PRIMAS", itens: [] };
  if (mps.length === 0) return { disponivel: true, confiabilidade: "INDISPONIVEL", motivo: "SEM_MATERIAS_PRIMAS_CADASTRADAS", itens: [] };
  const itens = mps.map((m) => ({
    materiaPrimaId: m.materiaPrimaId,
    nome: m.nome,
    unidadeBase: m.unidadeBase,
    saldo: m.saldo,
    movimentacoes: m.movimentacoes,
    ultimaMovimentacao: m.ultimaMovimentacao,
    situacao: m.saldo < 0 ? "NEGATIVO" : m.movimentacoes === 0 ? "SEM_MOVIMENTO" : "COM_SALDO_CALCULADO",
  }));
  const problemas = itens.filter((i) => i.situacao !== "COM_SALDO_CALCULADO").length;
  return {
    disponivel: true,
    confiabilidade: problemas > 0 ? "PARCIAL" : "UTILIZAVEL_COM_RESSALVAS",
    aviso: "Saldo calculado pelas movimentações registradas, sem conferência física. O limiar legado de 'saldo baixo' (< 200 em qualquer unidade) não é usado: não existe estoque mínimo cadastrado.",
    itens,
  };
}

export function alertasMateriasPrimas(diag) {
  const alertas = [];
  for (const m of diag.itens) {
    if (m.situacao === "NEGATIVO") {
      alertas.push(alerta(ALERTA.MATERIA_PRIMA_NEGATIVA, "ALTA", materiaPrima(m),
        `O saldo calculado de ${m.nome} está negativo (${m.saldo} ${m.unidadeBase}), o que é fisicamente impossível: faltam entradas registradas ou há saídas a mais.`,
        { saldo: m.saldo, unidadeBase: m.unidadeBase, movimentacoes: m.movimentacoes }));
    } else if (m.situacao === "SEM_MOVIMENTO") {
      alertas.push(alerta(ALERTA.MATERIA_PRIMA_SEM_MOVIMENTO, "BAIXA", materiaPrima(m),
        `${m.nome} está cadastrada, mas não tem nenhuma movimentação registrada: não há dado de saldo.`,
        { movimentacoes: 0 }));
    }
  }
  return alertas;
}

// ---------------------------------------------------------------- receitas / MRP

/**
 * Sabor sem receita utilizável = INFORMAÇÃO AUSENTE, não consumo zero. Sem
 * receita, o MRP fica indisponível (não "sem necessidade de insumos").
 */
export function diagnosticarReceitas(receitas) {
  if (!receitas) {
    return { disponivel: false, confiabilidade: "INDISPONIVEL", comReceita: [], semReceita: [],
      mrp: { disponivel: false, estado: "INDISPONIVEL_POR_FALHA", motivo: "FALHA_CONSULTA_RECEITAS" } };
  }
  const comReceita = receitas.filter((r) => r.utilizavel).map((r) => ({ saborId: r.saborId, sabor: r.sabor }));
  const semReceita = receitas.filter((r) => !r.utilizavel).map((r) => ({ saborId: r.saborId, sabor: r.sabor }));
  let mrp;
  if (receitas.length === 0) mrp = { disponivel: false, estado: "INDISPONIVEL_POR_DADOS", motivo: "SEM_SABORES_ATIVOS" };
  else if (comReceita.length === 0) mrp = { disponivel: false, estado: "INDISPONIVEL_POR_DADOS", motivo: "RECEITAS_NAO_CADASTRADAS" };
  else if (semReceita.length > 0) mrp = { disponivel: true, estado: "PARCIAL", motivo: "RECEITAS_INCOMPLETAS" };
  else mrp = { disponivel: true, estado: "DISPONIVEL" };
  return {
    disponivel: true,
    confiabilidade: comReceita.length === 0 ? "INDISPONIVEL" : semReceita.length > 0 ? "PARCIAL" : "COMPLETA",
    comReceita,
    semReceita,
    mrp,
  };
}

export function alertasReceitas(diag) {
  if (!diag.disponivel) return [];
  const alertas = diag.semReceita.map((s) => alerta(ALERTA.RECEITA_AUSENTE, "MEDIA", sabor(s),
    `${s.sabor} não tem receita utilizável (rendimento e itens de matéria-prima). O consumo de insumos desse sabor é desconhecido, não zero.`));
  if (!diag.mrp.disponivel && diag.mrp.motivo === "RECEITAS_NAO_CADASTRADAS") {
    alertas.push(alerta(ALERTA.MRP_INDISPONIVEL, "MEDIA", SISTEMA,
      "O cálculo de necessidades de matéria-prima (MRP) está indisponível: nenhum sabor ativo tem receita cadastrada. Nenhuma lista de compras ou necessidade de insumos pode ser calculada com os dados atuais.",
      { motivo: diag.mrp.motivo }));
  }
  return alertas;
}

/**
 * Pedido da simulação técnica de MRP: repor o volume VENDIDO nos últimos
 * 30 dias dos sabores com receita (ritmo recente, não previsão). Sem receita
 * ou sem volume, não há simulação.
 */
export function pedidoSimulacaoMRP(receitas, ritmo) {
  if (!receitas.mrp.disponivel) return { executar: false, motivo: receitas.mrp.motivo };
  const j30 = ritmo.janelas.find((j) => j.dias === 30);
  if (!j30?.disponivel) return { executar: false, motivo: "SEM_DADOS_DE_VENDAS_NA_JANELA" };
  const ids = new Set(receitas.comReceita.map((s) => s.saborId));
  const sabores = j30.sabores.filter((s) => ids.has(s.saborId) && s.vendido > 0).map((s) => ({ saborId: s.saborId, quantidade: s.vendido }));
  if (sabores.length === 0) return { executar: false, motivo: "SEM_VOLUME_DE_REFERENCIA" };
  return { executar: true, sabores, base: "VOLUME_VENDIDO_ULTIMOS_30_DIAS" };
}

export function alertasSimulacaoMRP(simulacao) {
  if (!simulacao?.executada || simulacao.faltantes.length === 0) return [];
  return [alerta(ALERTA.MATERIA_PRIMA_INSUFICIENTE, "MEDIA", SISTEMA,
    "Na simulação técnica, o saldo calculado de matéria-prima não cobre a reposição do volume vendido nos últimos 30 dias dos sabores com receita.",
    { faltantes: simulacao.faltantes, base: simulacao.base })];
}

// ---------------------------------------------------------------- ritmo produção × vendas

/** Janelas [ref − (dias − 1), ref], em dias civis de Manaus. Recebe `deslocar(diaISO, n)`. */
export const janelasRitmo = (dataReferencia, deslocar) =>
  LIMITES.JANELAS_RITMO.map((dias) => ({ dias, dataInicio: deslocar(dataReferencia, -(dias - 1)), dataFim: dataReferencia }));

/** Janela consultada → produzido, vendido, diferença e razão por sabor. Não é previsão. */
export function diagnosticarJanela(janela, dados) {
  if (!dados) return { ...janela, disponivel: false, motivo: "FALHA_CONSULTA_FLUXOS" };
  const sabores = dados.sabores.map((s) => ({
    ...s,
    diferenca: s.produzido - s.vendido,
    razaoProduzidoVendido: s.vendido > 0 ? Number((s.produzido / s.vendido).toFixed(3)) : null,
  }));
  const produzido = sabores.reduce((t, s) => t + s.produzido, 0);
  const vendido = sabores.reduce((t, s) => t + s.vendido, 0);
  return { ...janela, disponivel: true, semMovimento: sabores.length === 0, produzido, vendido, sabores };
}

export function alertasRitmo(janelas) {
  const j30 = janelas.find((j) => j.dias === 30);
  const j7 = janelas.find((j) => j.dias === 7);
  if (!j30?.disponivel) return [];
  const curta = new Map((j7?.disponivel ? j7.sabores : []).map((s) => [s.saborId, s]));
  const alertas = [];
  for (const s of j30.sabores) {
    if (s.vendido >= LIMITES.RITMO_VENDAS_MINIMAS_30 && s.produzido / s.vendido < LIMITES.RITMO_RAZAO_ABAIXO) {
      const c = curta.get(s.saborId);
      const confirmada = Boolean(c) && c.vendido >= LIMITES.RITMO_VENDAS_MINIMAS_7 && c.produzido / c.vendido < LIMITES.RITMO_RAZAO_ABAIXO;
      alertas.push(alerta(ALERTA.RITMO_PRODUCAO_ABAIXO_VENDAS, confirmada ? "MEDIA" : "BAIXA", sabor(s),
        `Nos últimos 30 dias foram produzidas ${s.produzido} e vendidas ${s.vendido} unidade(s) de ${s.sabor}: a produção ficou abaixo do ritmo de vendas${confirmada ? ", também nos últimos 7 dias" : ""}.`,
        { janela30: { produzido: s.produzido, vendido: s.vendido }, ...(c && { janela7: { produzido: c.produzido, vendido: c.vendido } }), confirmadaNaJanelaCurta: confirmada }));
    } else if (s.produzido >= LIMITES.RITMO_PRODUCAO_MINIMA_30 && (s.vendido === 0 || s.produzido / s.vendido > LIMITES.RITMO_RAZAO_ACIMA)) {
      alertas.push(alerta(ALERTA.RITMO_PRODUCAO_ACIMA_VENDAS, "BAIXA", sabor(s),
        `Nos últimos 30 dias foram produzidas ${s.produzido} e vendidas ${s.vendido} unidade(s) de ${s.sabor}: a produção ficou bem acima do ritmo de vendas.`,
        { janela30: { produzido: s.produzido, vendido: s.vendido } }));
    }
  }
  return alertas;
}

// ---------------------------------------------------------------- recomendações

/**
 * Recomendações por regra, cada uma com chave de deduplicação. Só onde há
 * ação concreta para o gestor; os demais achados ficam como alertas.
 */
export function gerarRecomendacoes({ estoque, alertas }) {
  const recs = [];
  const divergentes = alertas.filter((a) => a.tipo === ALERTA.SALDO_NEGATIVO || a.subtipo === "VENDA_SEM_PRODUCAO");
  if (divergentes.length > 0) {
    const comMovimento = estoque.disponivel ? estoque.sabores.filter((s) => s.produzido > 0 || s.vendido > 0).length : divergentes.length;
    const proporcao = divergentes.length / Math.max(comMovimento, 1);
    recs.push({
      tipo: RECOMENDACAO.CONTAGEM_FISICA,
      chave: "estoque-acabado",
      prioridade: proporcao > LIMITES.CONTAGEM_FISICA_ALTA_ACIMA_DE ? "ALTA" : "MEDIA",
      titulo: "Realizar contagem física do estoque acabado",
      descricao: `O saldo histórico (produção − vendas) não foi reconciliado com contagem física e diverge em ${divergentes.length} sabor(es): ${divergentes.map((a) => `${a.entidade.nome} (${a.dados.saldo})`).join(", ")}. Faça a contagem física antes de usar esses saldos para decidir produção.`,
      dados: { sabores: divergentes.map((a) => ({ saborId: a.entidade.id, sabor: a.entidade.nome, saldo: a.dados.saldo })), proporcaoDivergente: Number(proporcao.toFixed(3)) },
    });
  }
  for (const a of alertas.filter((x) => x.subtipo === "VENDA_SEM_PRODUCAO")) {
    recs.push({
      tipo: RECOMENDACAO.REVISAR_REGISTROS_SABOR,
      chave: `sabor:${a.entidade.id}`,
      prioridade: "MEDIA",
      titulo: `Revisar os registros de produção e vendas de ${a.entidade.nome}`,
      descricao: `Revise o registro de produção e vendas do sabor ${a.entidade.nome}: há ${a.dados.vendido} unidade(s) vendida(s) e nenhuma produção registrada.`,
      dados: { saborId: a.entidade.id, ...a.dados },
    });
  }
  const semReceita = alertas.filter((a) => a.tipo === ALERTA.RECEITA_AUSENTE);
  if (semReceita.length > 0) {
    recs.push({
      tipo: RECOMENDACAO.CADASTRAR_RECEITAS,
      chave: "receitas",
      prioridade: "MEDIA",
      titulo: "Cadastrar as receitas dos sabores",
      descricao: `Cadastre a receita (rendimento e matérias-primas) de: ${listaNomes(semReceita.map((a) => a.entidade))}. Sem receita, o cálculo de necessidades de matéria-prima (MRP) fica indisponível: a ausência de receita é falta de informação, não consumo zero.`,
      dados: { sabores: semReceita.map((a) => ({ saborId: a.entidade.id, sabor: a.entidade.nome })) },
    });
  }
  for (const a of alertas.filter((x) => x.tipo === ALERTA.MATERIA_PRIMA_NEGATIVA)) {
    recs.push({
      tipo: RECOMENDACAO.REVISAR_MOVIMENTACOES_MATERIA_PRIMA,
      chave: `materia-prima:${a.entidade.id}`,
      prioridade: "ALTA",
      titulo: `Revisar as movimentações de ${a.entidade.nome}`,
      descricao: `O saldo calculado de ${a.entidade.nome} está negativo (${a.dados.saldo} ${a.dados.unidadeBase}). Revise as compras (entradas) e as produções (saídas) registradas.`,
      dados: { materiaPrimaId: a.entidade.id, ...a.dados },
    });
  }
  return recs;
}

/**
 * Tipos de recomendação que podem ser resolvidos automaticamente nesta análise:
 * só os cuja condição foi de fato avaliada (dados disponíveis). CONTAGEM_FISICA
 * nunca entra: o saldo histórico deixar de ser negativo (ex.: produção nova
 * registrada) não reconcilia nada; só uma contagem física, decidida pelo
 * gestor, encerra essa recomendação.
 */
export function tiposAvaliados({ estoque, materias, receitas }) {
  const tipos = [];
  if (estoque.disponivel) tipos.push(RECOMENDACAO.REVISAR_REGISTROS_SABOR);
  if (receitas.disponivel) tipos.push(RECOMENDACAO.CADASTRAR_RECEITAS);
  if (materias.disponivel) tipos.push(RECOMENDACAO.REVISAR_MOVIMENTACOES_MATERIA_PRIMA);
  return tipos;
}

const ORDEM_PRIORIDADE = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
export const ordenarPorPrioridade = (itens) =>
  [...itens].sort((a, b) => ORDEM_PRIORIDADE[a.prioridade] - ORDEM_PRIORIDADE[b.prioridade]);

/** Qualidade dos dados por funcionalidade (nunca "confiável" para estoque acabado). */
export function qualidadeDosDados({ estoque, materias, receitas, ritmo }) {
  return {
    estoqueAcabado: estoque.disponivel
      ? { confiabilidade: "NAO_RECONCILIADO", natureza: "SALDO_CONTABIL_HISTORICO", saboresNegativos: estoque.contagem.negativos, sabores: estoque.contagem.sabores }
      : { confiabilidade: "INDISPONIVEL", motivo: estoque.motivo },
    materiasPrimas: { confiabilidade: materias.confiabilidade, ...(materias.motivo && { motivo: materias.motivo }), quantidade: materias.itens.length },
    receitas: { confiabilidade: receitas.confiabilidade, comReceita: receitas.comReceita.length, semReceita: receitas.semReceita.length },
    mrp: receitas.mrp,
    fluxosProducaoVendas: ritmo.janelas.every((j) => j.disponivel)
      ? { confiabilidade: ritmo.janelas.some((j) => !j.semMovimento) ? "UTILIZAVEL" : "SEM_DADOS_NO_PERIODO", observacao: "Fluxos registrados no período; não dependem do saldo histórico." }
      : { confiabilidade: "INDISPONIVEL", motivo: "FALHA_CONSULTA_FLUXOS" },
  };
}
