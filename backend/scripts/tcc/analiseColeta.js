/**
 * Análise dos resultados da coleta da Etapa 0.2 (funções puras, sem banco).
 *
 * Recebe o objeto `resultados` (nome da consulta -> linhas normalizadas) e
 * devolve apenas AGREGADOS. Nenhum nome de cliente sai daqui.
 */

// Marcos do sistema (git log; docs/tcc/auditoria-tecnica-inicial.md §4)
export const MARCOS = Object.freeze({
  inicioProducao: "2026-03-03",
  moduloEstoque: "2026-04-15",
  controlePagamento: "2026-08-14",
});

const dia = (v) => (v == null ? null : String(v).slice(0, 10));

// Datas fora desta janela são tratadas como erro de digitação (ex.: ano 0206):
// entram nas contagens e na regra atual de estoque, mas não nas séries
// temporais, períodos e intervalos (senão uma única data distorce tudo).
export const DATA_MINIMA_PLAUSIVEL = "2025-01-01";
export function dataPlausivel(v, hoje = new Date().toISOString().slice(0, 10)) {
  const d = dia(v);
  return d != null && d >= DATA_MINIMA_PLAUSIVEL && d <= hoje;
}
const num = (v) => (v == null ? 0 : Number(v));
const arred = (v, casas = 2) =>
  v == null || Number.isNaN(v) ? null : Number(v.toFixed(casas));

// ---------- Estatística descritiva ----------
function quantil(ordenado, q) {
  if (ordenado.length === 0) return null;
  const pos = (ordenado.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  const prox = ordenado[base + 1] ?? ordenado[base];
  return ordenado[base] + resto * (prox - ordenado[base]);
}

export function estatisticas(valores) {
  const v = valores.map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0 };
  const media = v.reduce((s, x) => s + x, 0) / v.length;
  const desvio = Math.sqrt(v.reduce((s, x) => s + (x - media) ** 2, 0) / v.length);
  return {
    n: v.length,
    min: arred(v[0]),
    p25: arred(quantil(v, 0.25)),
    mediana: arred(quantil(v, 0.5)),
    p75: arred(quantil(v, 0.75)),
    max: arred(v[v.length - 1]),
    media: arred(media),
    desvio_padrao: arred(desvio),
    coef_variacao: media > 0 ? arred(desvio / media) : null,
  };
}

function diasEntre(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(dia(b)) - new Date(dia(a))) / 86400000);
}

function segundaFeira(d) {
  const x = new Date(`${d}T00:00:00Z`);
  const dow = (x.getUTCDay() + 6) % 7; // 0 = segunda
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

function mesesNoIntervalo(inicio, fim) {
  const out = [];
  let [a, m] = inicio.split("-").map(Number);
  const [af, mf] = fim.split("-").map(Number);
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return out;
}

// ---------- Normalização igual a src/services/resolverNomes.js ----------
export function normalizarNome(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// ---------- Seções ----------
function analisarVendas(r) {
  const resumo = r.vendas_resumo?.[0] ?? {};
  const valores = r.vendas_valores ?? [];
  const plausiveis = valores.filter((v) => dataPlausivel(v.data));
  const datas = plausiveis.map((v) => dia(v.data)).sort();
  const antes = valores.filter((v) => dia(v.data) < MARCOS.controlePagamento);
  const depois = valores.filter((v) => dia(v.data) >= MARCOS.controlePagamento);
  const antesProducao = plausiveis.filter((v) => dia(v.data) < MARCOS.inicioProducao);
  const implausiveis = valores.filter((v) => !dataPlausivel(v.data));
  return {
    total_vendas: num(resumo.total_vendas),
    vendas_com_data_implausivel: implausiveis.length,
    unidades_com_data_implausivel: implausiveis.reduce((s, v) => s + num(v.quantidade), 0),
    primeira_venda_registrada: dia(resumo.primeira_venda),
    primeira_venda: datas[0] ?? null,
    ultima_venda: datas[datas.length - 1] ?? null,
    periodo_dias: diasEntre(datas[0], datas[datas.length - 1]),
    dias_com_venda: num(resumo.dias_com_venda),
    unidades_vendidas: num(resumo.unidades_vendidas),
    itens_venda_sabor: num(r.itens_vendidos?.[0]?.itens),
    valor_por_venda: estatisticas(valores.map((v) => v.valor)),
    unidades_por_venda: estatisticas(valores.map((v) => v.quantidade)),
    vendas_antes_de_03_03: antesProducao.length,
    unidades_antes_de_03_03: antesProducao.reduce((s, v) => s + num(v.quantidade), 0),
    vendas_antes_de_14_08: antes.length,
    vendas_desde_14_08: depois.length,
    vendas_via_automacao: num(resumo.vendas_via_automacao),
    consistencia: r.vendas_consistencia?.[0] ?? {},
  };
}

function analisarSeries(r) {
  const diarias = (r.vendas_diarias ?? [])
    .filter((d) => dataPlausivel(d.dia))
    .map((d) => ({ dia: dia(d.dia), unidades: num(d.unidades), vendas: num(d.vendas) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  if (diarias.length === 0) return { observacao: "sem vendas" };

  const porSemana = new Map();
  for (const d of diarias) {
    const s = segundaFeira(d.dia);
    porSemana.set(s, (porSemana.get(s) ?? 0) + d.unidades);
  }
  const semanas = [];
  let s = segundaFeira(diarias[0].dia);
  const ultimaSemana = segundaFeira(diarias[diarias.length - 1].dia);
  while (s <= ultimaSemana) {
    semanas.push(porSemana.get(s) ?? 0);
    const x = new Date(`${s}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 7);
    s = x.toISOString().slice(0, 10);
  }

  const porMes = new Map((r.vendas_por_mes ?? []).map((m) => [m.mes, num(m.unidades)]));
  const meses = mesesNoIntervalo(diarias[0].dia.slice(0, 7), diarias[diarias.length - 1].dia.slice(0, 7));
  const serieMensal = meses.map((m) => ({ mes: m, unidades: porMes.get(m) ?? 0 }));

  const diasCorridos = diasEntre(diarias[0].dia, diarias[diarias.length - 1].dia) + 1;
  return {
    dias_corridos: diasCorridos,
    dias_com_venda: diarias.length,
    percentual_dias_com_venda: arred((100 * diarias.length) / diasCorridos, 1),
    semanas_no_periodo: semanas.length,
    semanas_sem_venda: semanas.filter((u) => u === 0).length,
    unidades_por_semana: estatisticas(semanas),
    meses_no_periodo: meses.length,
    meses_sem_venda: serieMensal.filter((m) => m.unidades === 0).length,
    unidades_por_mes: estatisticas(serieMensal.map((m) => m.unidades)),
    serie_mensal: serieMensal,
  };
}

function analisarClientes(r) {
  const resumo = r.clientes_resumo?.[0] ?? {};
  const porCliente = r.vendas_por_cliente ?? [];
  const nomes = (r.clientes_nomes ?? []).map((c) => ({ id: c.id, n: normalizarNome(c.nome), primeiro: normalizarNome(String(c.nome).trim().split(/\s+/)[0] ?? "") }));

  // Duplicados após normalização
  const contagem = new Map();
  for (const c of nomes) contagem.set(c.n, (contagem.get(c.n) ?? 0) + 1);
  const duplicados = [...contagem.values()].filter((q) => q > 1).length;

  // Colisão com a regra "contém" do resolverCliente
  let paresContencao = 0;
  const comColisao = new Set();
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      const a = nomes[i].n;
      const b = nomes[j].n;
      if (a && b && a !== b && (a.includes(b) || b.includes(a))) {
        paresContencao += 1;
        comColisao.add(nomes[i].id);
        comColisao.add(nomes[j].id);
      }
    }
  }

  // Consultas pela primeira palavra (ex.: "Frutaria") que casam com >1 cliente
  const porPrimeiro = new Map();
  for (const c of nomes) if (c.primeiro) porPrimeiro.set(c.primeiro, (porPrimeiro.get(c.primeiro) ?? 0) + 1);
  const gruposPrimeiraPalavra = [...porPrimeiro.values()].filter((q) => q > 1);

  // Clientes cuja primeira compra tem data implausível ficam fora dos intervalos
  const intervalos = porCliente
    .filter((c) => num(c.vendas) >= 2 && dataPlausivel(c.primeira))
    .map((c) => diasEntre(c.primeira, c.ultima) / (num(c.vendas) - 1));
  const ultimaVendaGeral = dia(r.vendas_resumo?.[0]?.ultima_venda);

  return {
    clientes_cadastrados: num(resumo.clientes),
    clientes_com_venda: num(resumo.clientes_com_venda),
    clientes_sem_venda: num(resumo.clientes) - num(resumo.clientes_com_venda),
    clientes_ativos_90_dias: num(resumo.clientes_ativos_90_dias),
    vendas_por_cliente: estatisticas(porCliente.map((c) => c.vendas)),
    unidades_por_cliente: estatisticas(porCliente.map((c) => c.unidades)),
    clientes_com_2_ou_mais_vendas: porCliente.filter((c) => num(c.vendas) >= 2).length,
    clientes_com_compra_em_3_ou_mais_meses: porCliente.filter((c) => num(c.meses_com_compra) >= 3).length,
    intervalo_medio_entre_compras_dias: estatisticas(intervalos),
    clientes_sem_compra_ha_60_dias_ou_mais: ultimaVendaGeral
      ? porCliente.filter((c) => diasEntre(c.ultima, ultimaVendaGeral) >= 60).length
      : null,
    concentracao_top5_percentual_unidades: (() => {
      const u = porCliente.map((c) => num(c.unidades)).sort((a, b) => b - a);
      const total = u.reduce((s, x) => s + x, 0);
      return total > 0 ? arred((100 * u.slice(0, 5).reduce((s, x) => s + x, 0)) / total, 1) : null;
    })(),
    ambiguidade_resolucao_textual: {
      nomes_duplicados_apos_normalizacao: duplicados,
      pares_em_que_um_nome_contem_o_outro: paresContencao,
      clientes_envolvidos_nesses_pares: comColisao.size,
      grupos_com_mesma_primeira_palavra: gruposPrimeiraPalavra.length,
      clientes_nesses_grupos: gruposPrimeiraPalavra.reduce((s, q) => s + q, 0),
      maior_grupo_mesma_primeira_palavra: gruposPrimeiraPalavra.length ? Math.max(...gruposPrimeiraPalavra) : 0,
    },
  };
}

function eventosPorSabor(r) {
  const ev = new Map(); // saborId -> Map(dia -> {p, v})
  const add = (id, d, campo, q) => {
    if (!ev.has(id)) ev.set(id, new Map());
    const m = ev.get(id);
    const e = m.get(d) ?? { p: 0, v: 0 };
    e[campo] += q;
    m.set(d, e);
  };
  for (const l of r.producao_sabor_dia ?? []) add(num(l.sabor_id), dia(l.dia), "p", num(l.unidades));
  for (const l of r.vendas_sabor_dia ?? []) add(num(l.sabor_id), dia(l.dia), "v", num(l.unidades));
  return ev;
}

/**
 * Simula o saldo de produto acabado a partir de uma data de corte.
 * Saldo = Σprodução(dia >= corte) − Σvenda(dia >= corte).
 * `inventario_minimo` = menor estoque inicial que evitaria saldo negativo em
 * qualquer dia após o corte (produção do dia contada antes das vendas do dia).
 */
export function simularCorte(eventos, corte) {
  let produzido = 0;
  let vendido = 0;
  let saldo = 0;
  let minimo = 0;
  const dias = [...eventos.keys()].filter((d) => corte == null || d >= corte).sort();
  for (const d of dias) {
    const e = eventos.get(d);
    produzido += e.p;
    vendido += e.v;
    saldo += e.p - e.v;
    minimo = Math.min(minimo, saldo);
  }
  return { produzido, vendido, saldo, inventario_minimo: minimo < 0 ? -minimo : 0 };
}

function analisarEstoque(r) {
  const eventos = eventosPorSabor(r);
  const sabores = r.sabores_produzido_vendido ?? [];
  const primeiraProducaoGeral =
    (r.producao_sabor_dia ?? []).map((l) => dia(l.dia)).filter((d) => dataPlausivel(d)).sort()[0] ?? null;

  const vazio = new Map();
  const porSabor = sabores.map((s) => {
    const ev = eventos.get(num(s.id)) ?? vazio;
    const historico = simularCorte(ev, null);
    const antesProducao = simularCorte(ev, null).vendido - simularCorte(ev, MARCOS.inicioProducao).vendido;
    const desde0303 = simularCorte(ev, MARCOS.inicioProducao);
    const desdePropria = s.primeira_producao ? simularCorte(ev, dia(s.primeira_producao)) : null;
    return {
      sabor: s.nome,
      ativo: Boolean(s.ativo),
      produzido: historico.produzido,
      vendido: historico.vendido,
      saldo_historico: historico.saldo,
      vendido_antes_de_03_03: antesProducao,
      saldo_desde_03_03: desde0303.saldo,
      inventario_minimo_desde_03_03: desde0303.inventario_minimo,
      primeira_producao: dia(s.primeira_producao),
      saldo_desde_propria_1a_producao: desdePropria?.saldo ?? null,
      inventario_minimo_desde_propria_1a_producao: desdePropria?.inventario_minimo ?? null,
    };
  });

  const candidatas = [
    { corte: null, rotulo: "sem corte (regra atual)" },
    { corte: MARCOS.inicioProducao, rotulo: "início do módulo de produção (03/03/2026)" },
    ...(primeiraProducaoGeral && primeiraProducaoGeral !== MARCOS.inicioProducao
      ? [{ corte: primeiraProducaoGeral, rotulo: "primeira produção registrada" }]
      : []),
    { corte: MARCOS.moduloEstoque, rotulo: "módulo de estoque/MP (15/04/2026)" },
    { corte: "2026-06-01", rotulo: "01/06/2026" },
    { corte: MARCOS.controlePagamento, rotulo: "controle de pagamento (14/08/2026)" },
  ].sort((a, b) => (a.corte ?? "").localeCompare(b.corte ?? ""));

  const simulacoes = candidatas.map(({ corte, rotulo }) => {
    const res = sabores.map((s) => simularCorte(eventos.get(num(s.id)) ?? vazio, corte));
    const negativos = res.filter((x) => x.saldo < 0);
    return {
      corte: corte ?? "—",
      rotulo,
      unidades_produzidas: res.reduce((a, x) => a + x.produzido, 0),
      unidades_vendidas: res.reduce((a, x) => a + x.vendido, 0),
      sabores_com_saldo_negativo: negativos.length,
      soma_saldos_negativos: negativos.reduce((a, x) => a + x.saldo, 0),
      sabores_que_ficam_negativos_em_algum_dia: res.filter((x) => x.inventario_minimo > 0).length,
      inventario_inicial_minimo_total: res.reduce((a, x) => a + x.inventario_minimo, 0),
    };
  });

  return {
    primeira_producao_registrada: primeiraProducaoGeral,
    sabores_vendidos_sem_nenhuma_producao: porSabor.filter((s) => s.vendido > 0 && s.produzido === 0).length,
    sabores_com_saldo_historico_negativo: porSabor.filter((s) => s.saldo_historico < 0).length,
    simulacoes_de_corte: simulacoes,
    por_sabor: porSabor,
  };
}

function analisarMateriaPrima(r) {
  const mps = r.materias_primas_saldo ?? [];
  return {
    materias_primas: mps.length,
    ativas: mps.filter((m) => m.ativo).length,
    sem_movimentacao: mps.filter((m) => num(m.movimentacoes) === 0).length,
    com_saldo_negativo: mps.filter((m) => num(m.saldo) < 0).length,
    saldo_baixo_regra_atual_0_a_200: mps.filter((m) => num(m.saldo) > 0 && num(m.saldo) < 200).length,
    movimentacoes_por_tipo: r.movimentacoes_por_tipo ?? [],
    unidades_base: r.materias_primas_por_unidade_base ?? [],
    custos_com_unidade_sem_conversao: r.custos_unidade_sem_conversao ?? [],
    por_item: mps.map((m) => ({
      nome: m.nome,
      unidade_base: m.unidade_base,
      ativo: Boolean(m.ativo),
      entradas: num(m.n_entradas),
      qtd_entradas: arred(num(m.q_entradas), 3),
      saidas: num(m.n_saidas),
      qtd_saidas: arred(num(m.q_saidas), 3),
      ajustes: num(m.n_ajustes),
      saldo: arred(num(m.saldo), 3),
      ultima_movimentacao: dia(m.ultima_movimentacao),
    })),
  };
}

function fatorConversao(unidade, base) {
  if (unidade === base) return 1;
  if (unidade === "kg" && base === "g") return 1000;
  if (unidade === "L" && base === "ml") return 1000;
  return null; // mesma regra de custosController.converterParaBase; demais não convertem
}

function analisarReceitasECustos(r) {
  const sabores = r.sabores_produzido_vendido ?? [];
  const itens = r.receita_itens ?? [];

  // Custo unitário médio por matéria-prima (só compras com unidade convertível)
  const custoMp = new Map();
  const naoConvertivel = new Set();
  for (const c of r.compras_por_materia_prima ?? []) {
    const f = fatorConversao(c.unidade, c.unidade_base);
    const id = num(c.materia_prima_id);
    if (f == null) { naoConvertivel.add(id); continue; }
    const acc = custoMp.get(id) ?? { valor: 0, qtd: 0 };
    acc.valor += num(c.valor);
    acc.qtd += num(c.quantidade) * f;
    custoMp.set(id, acc);
  }

  const itensPorSabor = new Map();
  for (const i of itens) {
    const id = num(i.sabor_id);
    if (!itensPorSabor.has(id)) itensPorSabor.set(id, []);
    itensPorSabor.get(id).push(i);
  }

  const receitas = sabores.map((s) => {
    const its = itensPorSabor.get(num(s.id)) ?? [];
    const temReceita = its.length > 0 && s.rendimento_base != null;
    let custoLote = 0;
    let faltando = 0;
    for (const i of its) {
      const c = custoMp.get(num(i.materia_prima_id));
      if (!c || c.qtd === 0) { faltando += 1; continue; }
      custoLote += num(i.quantidade_base) * (c.valor / c.qtd);
    }
    const calculavel = temReceita && faltando === 0;
    const custoUnidade = calculavel ? custoLote / num(s.rendimento_base) : null;
    return {
      sabor: s.nome,
      ativo: Boolean(s.ativo),
      preco_unitario: num(s.preco_unitario),
      rendimento_base: s.rendimento_base == null ? null : num(s.rendimento_base),
      itens_receita: its.length,
      produzido: num(s.produzido),
      insumos_sem_custo_convertivel: faltando,
      custo_estimado_por_unidade: arred(custoUnidade),
      margem_estimada_por_unidade: custoUnidade == null ? null : arred(num(s.preco_unitario) - custoUnidade),
    };
  });

  const custos = r.custos_resumo?.[0] ?? {};
  return {
    receitas: {
      sabores: sabores.length,
      com_receita: receitas.filter((x) => x.itens_receita > 0 && x.rendimento_base != null).length,
      sem_receita: receitas.filter((x) => !(x.itens_receita > 0 && x.rendimento_base != null)).length,
      produzidos_sem_receita: receitas.filter((x) => x.produzido > 0 && !(x.itens_receita > 0 && x.rendimento_base != null)).length,
      itens_por_receita: estatisticas(receitas.filter((x) => x.itens_receita > 0).map((x) => x.itens_receita)),
    },
    custos: {
      custos: num(custos.custos),
      primeiro: dia(custos.primeiro),
      ultimo: dia(custos.ultimo),
      valor_total: arred(num(custos.valor_total)),
      vinculados_a_materia_prima: num(custos.vinculados_a_materia_prima),
      nao_vinculados: num(custos.custos) - num(custos.vinculados_a_materia_prima),
      materia_prima_sem_vinculo: num(custos.materia_prima_sem_vinculo),
      por_categoria: r.custos_por_categoria ?? [],
      por_unidade: r.custos_por_unidade ?? [],
      materias_primas_com_custo_unitario: custoMp.size,
      materias_primas_com_compra_nao_convertivel: naoConvertivel.size,
      sabores_com_custo_de_receita_calculavel: receitas.filter((x) => x.custo_estimado_por_unidade != null).length,
    },
    custo_por_sabor: receitas,
  };
}

function analisarPagamentos(r) {
  const periodos = r.pagamentos_antes_depois ?? [];
  const datas = r.pagamentos_datas_backfill?.[0] ?? {};
  return {
    resumo: r.pagamentos_resumo ?? [],
    antes_e_depois_de_14_08: periodos,
    datas: {
      pagas_dp_igual_data: num(datas.pagas_dp_igual_data),
      primeira_venda_dp_igual: dia(datas.primeira_venda_dp_igual),
      ultima_venda_dp_igual: datas.ultima_venda_dp_igual ?? null,
      pagas_dp_diferente: num(datas.pagas_dp_diferente),
      primeiro_registro_pagamento_manual: datas.primeiro_registro_pagamento_manual ?? null,
      ultimo_registro_pagamento_manual: datas.ultimo_registro_pagamento_manual ?? null,
    },
    dias_com_mais_registros_manuais: r.pagamentos_dias_de_registro ?? [],
    por_mes: r.pagamentos_por_mes ?? [],
    pendentes_por_idade: r.pendentes_por_idade ?? [],
    desde_14_08: r.pagamentos_desde_funcionalidade?.[0] ?? {},
  };
}

function analisarProducao(r) {
  const p = r.producao_resumo?.[0] ?? {};
  const dias = (r.producao_sabor_dia ?? []).map((l) => dia(l.dia));
  const plausiveis = dias.filter((d) => dataPlausivel(d)).sort();
  const implausiveis = (r.producao_sabor_dia ?? []).filter((l) => !dataPlausivel(l.dia));
  return {
    registros: num(p.registros_producao),
    unidades_com_data_implausivel: implausiveis.reduce((s, l) => s + num(l.unidades), 0),
    primeira_registrada: dia(p.primeira_producao),
    primeira: plausiveis[0] ?? null,
    ultima: plausiveis[plausiveis.length - 1] ?? null,
    periodo_dias: diasEntre(plausiveis[0], plausiveis[plausiveis.length - 1]),
    dias_com_producao: num(p.dias_com_producao),
    unidades_produzidas: num(p.unidades_produzidas),
    por_mes: r.producao_por_mes ?? [],
  };
}

export function analisar(r) {
  return {
    vendas: analisarVendas(r),
    series_de_vendas: analisarSeries(r),
    clientes: analisarClientes(r),
    producao: analisarProducao(r),
    estoque_acabado: analisarEstoque(r),
    materia_prima: analisarMateriaPrima(r),
    ...analisarReceitasECustos(r),
    pagamentos: analisarPagamentos(r),
  };
}
