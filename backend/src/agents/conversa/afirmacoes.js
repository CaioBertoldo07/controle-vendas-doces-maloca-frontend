// Verificação factual por AFIRMAÇÕES (Etapa 6). Puras.
//
// A Etapa 5 só conferia se cada número do texto existia em ALGUM fato: não
// pegava número trocado entre sabores, percentual de participação apresentado
// como crescimento, saldo contábil chamado de estoque físico, média vendida
// como previsão nem pendência chamada de inadimplência. Agora:
//
//   1. os fatos compactos dos especialistas viram um CATÁLOGO, em que cada fato
//      tem id (F1, F2...), entidade, métrica, valor e unidade;
//   2. o LLM devolve AFIRMAÇÕES estruturadas, cada uma citando os ids dos fatos
//      em que se apoia;
//   3. o código valida cada afirmação, deterministicamente: as referências
//      existem; cada número bate com um fato CITADO da entidade a que o texto o
//      atribui, na mesma unidade (%, R$, un...) e com a mesma natureza
//      (variação × participação × média); datas e sabores citados existem nos
//      fatos citados; guardas semânticas (estoque físico, previsão,
//      inadimplência, MRP, margem/custo por sabor) com tratamento de negação;
//   4. afirmação inválida é descartada e nunca chega ao gestor; se nenhuma
//      sobra, a resposta sai do template determinístico;
//   5. fatos críticos não numéricos (estoque não reconciliado, MRP
//      indisponível, pagamentos com ressalva) entram como RESSALVA
//      determinística quando nenhuma afirmação aceita os cita.
//
// Continua sendo uma trava conservadora, não compreensão de linguagem: na
// dúvida, a afirmação é descartada (falso negativo custa uma frase; falso
// positivo custaria um número errado na tela do gestor).
import { z } from "zod";
import { valoresDe } from "./fatos.js";

export const LIMITE_FATOS_POR_RESULTADO = 90;
export const MAX_AFIRMACOES = 6;
const SEMPRE_ACEITOS = new Set([0, 1, 2, 3, 4]); // contagens pequenas ("2 sabores"), como na Etapa 5
// Etapa 6.1 (validação com o provider real): um número com unidade de PERÍODO nunca é
// "contagem pequena": "4 meses" para uma janela de 4 semanas chegou ao gestor. Ele
// precisa bater com um fato de período (citado ou o período da própria consulta).
const PERIODOS = new Set(["semanas", "dias", "meses", "anos"]);

/** Minúsculas sem acento, preservando o comprimento (posições valem no texto original). */
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ISO = /^\d{4}-\d{2}-\d{2}/;

// ---------------------------------------------------------------- catálogo

/** "ritmo.sabores.demandaMediaSemanal" → "ritmo sabores demanda media semanal" (casa palavras inteiras: "mediaSemanal" não é "dias"). */
const palavrasDa = (metrica) => metrica.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\./g, " ").toLowerCase();

function unidadeDaMetrica(metrica, irmaos) {
  const m = palavrasDa(metrica);
  if (/\b(percentual|participacao|duas maiores|maior participacao)\b/.test(m)) return "%";
  if (/\b(faturamento|valor|ticket|custo)\b/.test(m)) return "R$";
  if (/\bfaixas\b/.test(m)) return "vendas";
  if (/\bsemanas\b/.test(m)) return "semanas";
  if (/\b(dias|tempo em aberto|intervalo)\b/.test(m)) return "dias";
  if (/\b(quantidade vendas|vendas pendentes|compras)\b|^recebiveis quantidade$/.test(m)) return "vendas";
  if (/\b(clientes|fora do padrao)\b/.test(m)) return "clientes";
  if (/\bcontagem\b/.test(m)) return "sabores";
  if (typeof irmaos?.unidade === "string") return irmaos.unidade; // matérias-primas: g, ml...
  if (/\b(unidades|produzido|vendido|saldo|demanda|producao|media|pode produzir)\b/.test(m)) return "un";
  return "numero";
}

/**
 * Base de cada percentual do catálogo ("X% DE QUÊ"), pela última chave da métrica. Etapa 6.1.
 * O FATO carrega a base; o checker compara a base escrita na afirmação com a dos fatos citados.
 * Métrica nova com outra base (ex.: CLIENTES) entra aqui; percentual fora da tabela tem base
 * desconhecida (null) e não sustenta afirmação que declare base.
 */
export const BASE_DO_PERCENTUAL = Object.freeze({
  participacao: "UNIDADES", //                     mix, tendências, perfil por dia
  participacaoClientesRecorrentes: "UNIDADES", //  fatia das UNIDADES do sabor compradas por recorrentes
  duasMaiores: "UNIDADES",
  maiorParticipacao: "UNIDADES",
  variacaoPercentual: "UNIDADES",
  unidadesPercentual: "UNIDADES",
  faturamentoPercentual: "FATURAMENTO",
  sobreFaturamentoPercentual: "FATURAMENTO",
});
const baseDaMetrica = (metrica) => BASE_DO_PERCENTUAL[metrica.split(".").at(-1)] ?? null;

/** Base declarada na afirmação logo depois do percentual ("66,7% das unidades", "11,1% dos clientes"). */
function baseNoTexto(t, fim) {
  const m = /^\s*(%|por cento)\s*(d[eoa]s?\s+)?((seus|suas|os|as|o|a)\s+)?(\p{L}+)/u.exec(t.slice(fim, fim + 40));
  if (!m) return null;
  if (/^(clientes?|compradores?)$/.test(m[5])) return "CLIENTES";
  if (/^(unidades?|volume)$/.test(m[5])) return "UNIDADES";
  if (/^(faturamento|receita)$/.test(m[5])) return "FATURAMENTO";
  return null; // base não declarada (ou ambígua): não há o que conferir
}

function familiaDaMetrica(metrica) {
  const m = palavrasDa(metrica);
  if (/\bcusto\b/.test(m)) return "CUSTO";
  if (/\b(participacao|duas maiores|maior participacao)\b/.test(m)) return "PARTICIPACAO";
  if (/\b(variacao|percentual)\b/.test(m)) return "VARIACAO";
  if (/\bmedia\b/.test(m)) return "MEDIA";
  return null;
}

const CRITICOS = {
  ESTOQUE_NAO_RECONCILIADO: "O saldo de estoque acabado é contábil (produção menos vendas registradas), não reconciliado por contagem física: não é o estoque físico.",
  MRP_INDISPONIVEL: "A simulação de produção por receitas (MRP) está indisponível com os dados atuais.",
  PAGAMENTOS_COM_RESSALVA: "Parte do período tem status de pagamento vindo de um backfill: não reflete o comportamento real de pagamento.",
};

function codigoCritico(f) {
  if (/estoqueAcabado\.natureza$/.test(f.metrica) && f.valor === "SALDO_CONTABIL_HISTORICO") return "ESTOQUE_NAO_RECONCILIADO";
  if (/qualidade\.estoqueAcabado$/.test(f.metrica) && f.valor === "NAO_RECONCILIADO") return "ESTOQUE_NAO_RECONCILIADO";
  if (/mrp\.disponivel$/.test(f.metrica) && f.valor === false) return "MRP_INDISPONIVEL";
  if (/qualidadePagamento$/.test(f.metrica) && f.valor === "COM_RESSALVA") return "PAGAMENTOS_COM_RESSALVA";
  return null;
}

/** Fatos de um resultado (folhas do JSON compacto), com a entidade do objeto mais próximo que tem `sabor`/`nome`/`dia`. */
function folhas(fatos) {
  const saida = [];
  const visitar = (v, caminho, entidade, irmaos) => {
    if (Array.isArray(v)) {
      const deSabores = /sabores/i.test(caminho.at(-1) ?? "");
      return v.forEach((x) => visitar(x, caminho, deSabores && typeof x === "string" ? x : entidade, null));
    }
    if (v && typeof v === "object") {
      const propria = [v.sabor, v.nome, v.dia].find((x) => typeof x === "string");
      for (const [k, x] of Object.entries(v)) {
        if (["sabor", "nome", "dia", "unidade", "fonte"].includes(k) && typeof x === "string") continue;
        visitar(x, [...caminho, k], propria ?? entidade, v);
      }
      return undefined;
    }
    const metrica = caminho.join(".");
    if (typeof v === "number" && Number.isFinite(v)) {
      const unidade = unidadeDaMetrica(metrica, irmaos);
      saida.push({ entidade, metrica, valor: v, unidade, ...(unidade === "%" && { base: baseDaMetrica(metrica) }) });
    }
    else if (typeof v === "boolean") saida.push({ entidade, metrica, valor: v, unidade: null });
    else if (typeof v === "string") saida.push({ entidade, metrica, valor: v, unidade: ISO.test(v) ? "data" : v.length > 40 ? "texto" : null });
    return undefined;
  };
  visitar(fatos, [], null, null);
  return saida;
}

/**
 * Catálogo dos resultados da consulta ao Coordenador. Cada fato:
 * { id, intencao, entidade (sabor/matéria-prima/dia ou null = geral), metrica, valor, unidade, critico? }.
 * Frases e limitações dos especialistas também são fatos (unidade "texto").
 */
export function montarCatalogo(resultados, limitePorResultado = LIMITE_FATOS_POR_RESULTADO) {
  const fatos = [];
  const omitidos = {};
  for (const r of resultados) {
    let lista;
    if (r.status !== "OK") lista = [{ entidade: null, metrica: "disponibilidade", valor: "AGENTE_NAO_RESPONDEU", unidade: null }];
    else {
      lista = [
        ...folhas(r.fatos ?? {}),
        ...(r.textos ?? []).map((t) => ({ entidade: null, metrica: "frase", valor: t, unidade: "texto" })),
        ...(r.limitacoes ?? []).map((t) => ({ entidade: null, metrica: "limitacao", valor: t, unidade: "texto" })),
      ];
    }
    if (lista.length > limitePorResultado) {
      // corte estrutural: críticos ficam sempre; o resto, na ordem (métricas antes de listas longas de alertas)
      const criticos = lista.filter((f) => codigoCritico(f));
      const resto = lista.filter((f) => !codigoCritico(f)).slice(0, limitePorResultado - criticos.length);
      omitidos[r.intencao] = lista.length - criticos.length - resto.length;
      lista = [...criticos, ...resto];
    }
    for (const f of lista) {
      const critico = codigoCritico(f);
      fatos.push({ id: `F${fatos.length + 1}`, intencao: r.intencao, ...f, ...(critico && { critico }) });
    }
  }

  const nomes = new Set();
  for (const r of resultados) if (r.sabor) nomes.add(r.sabor);
  for (const f of fatos) if (f.entidade) nomes.add(f.entidade);
  const entidades = [...nomes].map((nome) => ({ nome, norm: norm(nome) })).filter((e) => e.norm.length >= 2).sort((a, b) => b.norm.length - a.norm.length);

  const catalogo = { fatos, porId: new Map(fatos.map((f) => [f.id, f])), entidades, omitidos };
  // frases: números e sabores citados dentro delas viram "átomos" atribuíveis, como numa afirmação
  for (const f of fatos) {
    if (f.unidade !== "texto") continue;
    const a = analisarTexto(f.valor, catalogo);
    f.atomos = a.atomos;
    f.entidadesCitadas = a.mencoes.map((m) => m.entidade);
  }
  return catalogo;
}

/** O catálogo no formato enviado ao LLM: uma linha por fato, sem campos internos. */
export function catalogoParaLLM(catalogo) {
  return catalogo.fatos
    .map((f) => `${f.id} | ${f.intencao} | ${f.entidade ?? "geral"} | ${f.metrica} | ${typeof f.valor === "string" ? f.valor : JSON.stringify(f.valor)}${f.unidade && f.unidade !== "texto" && f.unidade !== "numero" ? ` | ${f.unidade}` : ""}`)
    .join("\n");
}

// ---------------------------------------------------------------- análise de texto

const DATA_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const DATA_BR = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const NUMERO = /\d+(?:[.,]\d+)*/g;
// fim de frase: ; ! ? quebra de linha, ou ponto seguido de espaço + maiúscula / fim (não "1.100" nem "un./semana")
const FIM_DE_FRASE = /[;!?\n]|\.(?=\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]|\s*$)/g;
const FIM_DE_ORACAO = /,\s|[;!?\n]|\.(?=\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]|\s*$)/g; // vírgula + espaço também separa ("1.100,00" não)

const PALAVRAS_FAMILIA = [
  ["VARIACAO", /cresc|caiu|\bcai\b|queda|aument|reduz|redu[cç]|subiu|\bsobe|desceu|variac|recuo|recuou|avanc/g],
  ["PARTICIPACAO", /represent|participac|das unidades|do total|fatia|respondem? por|somam|concentr|dos clientes|de clientes|das vendas/g],
  ["MEDIA", /media|por semana|\/semana|semanal|por dia|diaria/g],
];

function unidadeNoTexto(t, inicio, fim) {
  const depois = t.slice(fim, fim + 20);
  if (/r\$\s*-?\s*$/.test(t.slice(Math.max(0, inicio - 6), inicio))) return "R$";
  if (/^\s*(%|por cento)/.test(depois)) return "%";
  if (/^\s*reais/.test(depois)) return "R$";
  if (/^\s*(un\b|un\.|unid)/.test(depois)) return "un";
  if (/^\s*semanas?\b/.test(depois)) return "semanas";
  if (/^\s*dias?\b/.test(depois)) return "dias";
  if (/^\s*(mes|meses)\b/.test(depois)) return "meses";
  if (/^\s*anos?\b/.test(depois)) return "anos";
  if (/^\s*(vendas?|pedidos?)\b/.test(depois)) return "vendas";
  if (/^\s*clientes?\b/.test(depois)) return "clientes";
  if (/^\s*sabores?\b/.test(depois)) return "sabores";
  return null;
}

/** Limites [ini, fim) da frase (ou oração) que contém a posição. */
function frase(original, pos, re = FIM_DE_FRASE) {
  let ini = 0;
  let fim = original.length;
  for (const m of original.matchAll(re)) {
    if (m.index < pos) ini = m.index + 1;
    else { fim = m.index; break; }
  }
  return [ini, fim];
}

/** O mais próximo ANTES da posição dentro dos limites; se não houver, o mais próximo depois. */
function maisProximo(itens, pos, [ini, fim], { antesMax = Infinity, depoisMax = 40 } = {}) {
  const antes = itens.filter((x) => x.fim <= pos && x.inicio >= ini && pos - x.fim <= antesMax).sort((a, b) => b.fim - a.fim)[0];
  if (antes) return antes;
  return itens.filter((x) => x.inicio >= pos && x.inicio < fim && x.inicio - pos <= depoisMax).sort((a, b) => a.inicio - b.inicio)[0] ?? null;
}

/** Menções a entidades do catálogo, números (com unidade, entidade e natureza atribuídas) e datas de um texto. */
function analisarTexto(original, catalogo) {
  const t = norm(original);
  const mascara = t.split("");
  const mencoes = [];
  for (const e of catalogo.entidades) {
    for (const m of t.matchAll(new RegExp(`(?<![a-z0-9])${escapar(e.norm)}(?![a-z0-9])`, "g"))) {
      if (mencoes.some((x) => m.index < x.fim && m.index + e.norm.length > x.inicio)) continue;
      mencoes.push({ entidade: e.nome, inicio: m.index, fim: m.index + e.norm.length });
      for (let i = m.index; i < m.index + e.norm.length; i++) mascara[i] = " "; // "Tradicional 500g" não vira número
    }
  }
  const datas = [];
  let s = mascara.join("");
  s = s.replace(DATA_ISO, (bruto, a, m, d, pos) => {
    datas.push({ bruto, chave: `${Number(d)}/${Number(m)}`, inicio: pos });
    return " ".repeat(bruto.length);
  });
  s = s.replace(DATA_BR, (bruto, d, m, a, pos) => {
    datas.push({ bruto, chave: `${Number(d)}/${Number(m)}`, ano: a ? Number(a.length === 2 ? `20${a}` : a) : null, inicio: pos });
    return " ".repeat(bruto.length);
  });
  const palavras = PALAVRAS_FAMILIA.flatMap(([familia, re]) => [...t.matchAll(re)].map((m) => ({ familia, inicio: m.index, fim: m.index + m[0].length })));
  const atomos = [];
  for (const m of s.matchAll(NUMERO)) {
    const inicio = m.index;
    const fim = inicio + m[0].length;
    atomos.push({
      bruto: m[0],
      valores: valoresDe(m[0]),
      unidade: unidadeNoTexto(t, inicio, fim),
      // Etapa 6.1: a base declarada ("11,1% dos compradores") é conferida com a base do fato citado
      base: baseNoTexto(t, fim),
      // entidade: o sabor mais próximo antes do número na frase ("Tradicional teve 30"); senão, logo depois ("30 do Tradicional")
      entidade: maisProximo(mencoes, inicio, frase(original, inicio))?.entidade ?? null,
      // natureza: a palavra-chave mais próxima na mesma oração ("cresceu 25%" × "representa 66,7%"; "média de 22,5")
      familia: maisProximo(palavras, inicio, frase(original, inicio, FIM_DE_ORACAO), { antesMax: 45, depoisMax: 16 })?.familia ?? null,
    });
  }
  return { t, mencoes, atomos, datas };
}

// ---------------------------------------------------------------- validação

const casas = (x) => (String(x).split(".")[1] ?? "").length;
/** `citado` corresponde a `n` com o arredondamento que o texto usou (inclui |n| para "-20" escrito "20"). */
const bate = (citado, n) => [n, Math.abs(n)].some((c) => c === citado || Number(c.toFixed(casas(citado))) === citado);

const unidadeCompativel = (doTexto, doFato) => {
  if (!doTexto || !doFato) return true;
  if (doTexto === "%" || doTexto === "R$" || doFato === "%" || doFato === "R$") return doTexto === doFato;
  return doFato === "numero" || doTexto === doFato;
};

const NEGACAO = /\b(nao|nem|sem|nunca|jamais)\b[^.;,]{0,16}$/;

/** Ocorrência do padrão que não está logo depois de uma negação ("não é atraso", "não é previsão"). */
function afirmaSemNegar(t, re) {
  for (const m of t.matchAll(re)) {
    if (!NEGACAO.test(t.slice(Math.max(0, m.index - 30), m.index))) return m[0];
  }
  return null;
}

const GUARDAS = [
  { codigo: "ESTOQUE_FISICO", re: /estoque (fisico|real|efetivo)|fisicamente|em maos|na prateleira/g },
  { codigo: "PREVISAO", re: /previs|previst|projec|projet|vai vender|vao vender|vendera|venderao|deve(ra|rao|m)? vender|espera-se|tende a vender|proxim[oa]s? (semana|mes|meses|dias)|no futuro/g },
  { codigo: "INADIMPLENCIA", re: /inadimpl|atrasad|atraso|vencid|calote|devedor|maus? pagador/g },
  { codigo: "MARGEM_LUCRO", re: /margem|lucro|lucrativ|rentab/g },
  { codigo: "MRP_DISPONIVEL", critico: "MRP_INDISPONIVEL", re: /podem? (ser )?produzi|possivel produzir|da para produzir|consegue produzir|insumos? suficientes?|materias?[- ]primas? suficientes?/g },
  { codigo: "PAGAMENTO_CONFIAVEL", critico: "PAGAMENTOS_COM_RESSALVA", re: /em dia|pontua|sempre pag|pagam (bem|certo)|pagamentos? confiave/g },
];

const ANAFORA = /\b(mesm[oa]|ness[ea]|nest[ea]|ess[ea]|est[ea]|dess[ea]|dest[ea])\s+(mesm[oa]\s+)?(periodo|janela|intervalo|saldo|valor|media|numero)\b/g;

function guardaSemantica(analise, citados, catalogo) {
  const criticos = new Set(catalogo.fatos.filter((f) => f.critico).map((f) => f.critico));
  for (const g of GUARDAS) {
    if (g.critico && !criticos.has(g.critico)) continue;
    const trecho = afirmaSemNegar(analise.t, g.re);
    if (trecho) return { motivo: `SEMANTICA_${g.codigo}`, detalhe: trecho };
  }
  if (analise.mencoes.length && afirmaSemNegar(analise.t, /custo/g)) return { motivo: "SEMANTICA_CUSTO_POR_SABOR", detalhe: "custo" }; // custo só existe agregado
  // Etapa 6.1: cada afirmação é validada SOZINHA, então uma referência a outra ("no mesmo
  // período", "esse saldo") não é verificável: com o provider real, "a produção no mesmo
  // período foi de 10/semana" herdou o período de 8 semanas da frase anterior (eram 4).
  // Só passa se o antecedente estiver na própria afirmação.
  for (const m of analise.t.matchAll(ANAFORA)) {
    const antes = analise.t.slice(0, m.index);
    const temAntecedente = /periodo|janela|intervalo/.test(m[3]) ? /\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|\d+\s+semanas?/.test(antes) : antes.includes(m[3]);
    if (!temAntecedente) return { motivo: "SEMANTICA_REFERENCIA_EXTERNA", detalhe: m[0] };
  }
  // saldo contábil apresentado como "estoque" sem a qualificação (contábil/histórico/não reconciliado)
  const citaSaldo = citados.some((f) => /estoqueAcabado\..*saldo|divergencias\.saldo/i.test(f.metrica));
  if (citaSaldo && /estoque/.test(analise.t) && !/contabil|historic|registr|reconcil|contagem/.test(analise.t)) return { motivo: "SEMANTICA_SALDO_COMO_ESTOQUE", detalhe: "estoque" };
  return null;
}

/** Candidatos que sustentam um número: fatos numéricos citados e números dentro das frases citadas. */
function candidatos(citados) {
  const lista = [];
  for (const f of citados) {
    if (typeof f.valor === "number") lista.push({ id: f.id, valores: [f.valor], unidade: f.unidade, entidade: f.entidade, familia: familiaDaMetrica(f.metrica), base: f.base ?? null });
    for (const a of f.atomos ?? []) lista.push({ id: f.id, valores: a.valores, unidade: a.unidade, entidade: a.entidade ?? f.entidade, familia: a.familia, base: a.base });
  }
  return lista;
}

/** Por que o número não é sustentado (o filtro que eliminou o último candidato), para a auditoria. */
function conferirNumero(atomo, citados, extras, doPeriodo) {
  const v = atomo.valores;
  const periodo = PERIODOS.has(atomo.unidade);
  if (v.some((x) => extras.includes(x))) return null; // número que o próprio gestor escreveu ("8 semanas")
  if (v.some((x) => SEMPRE_ACEITOS.has(x)) && !periodo && atomo.unidade !== "%" && atomo.unidade !== "R$") return null;
  const cands = periodo ? [...citados, ...doPeriodo] : citados;
  let resto = cands.filter((c) => c.valores.some((n) => v.some((x) => bate(x, n))));
  if (!resto.length) return "VALOR";
  if (atomo.base) {
    // a afirmação declara a base do percentual: algum fato citado com esse valor precisa ter essa base
    resto = resto.filter((c) => c.base === atomo.base);
    if (!resto.length) return "BASE";
  }
  resto = resto.filter((c) => unidadeCompativel(atomo.unidade, c.unidade));
  if (!resto.length) return "UNIDADE";
  if (atomo.entidade) {
    resto = resto.filter((c) => c.entidade === null || c.entidade === atomo.entidade);
    if (!resto.length) return "ENTIDADE";
  }
  const exige = atomo.familia === "MEDIA" || (atomo.unidade === "%" && (atomo.familia === "VARIACAO" || atomo.familia === "PARTICIPACAO")) ? atomo.familia : null;
  if (exige) {
    resto = resto.filter((c) => c.familia === exige);
    if (!resto.length) return "NATUREZA";
  }
  return null;
}

/** Valida UMA afirmação { texto, factIds } contra o catálogo. Devolve { valida, motivo?, detalhe? }. */
export function validarAfirmacao(afirmacao, catalogo, { extras = [] } = {}) {
  const ids = [...new Set(afirmacao.factIds ?? [])];
  if (!ids.length) return { valida: false, motivo: "SEM_REFERENCIA" };
  const inexistentes = ids.filter((id) => !catalogo.porId.has(id));
  if (inexistentes.length) return { valida: false, motivo: "REFERENCIA_INEXISTENTE", detalhe: inexistentes.join(",") };
  const citados = ids.map((id) => catalogo.porId.get(id));
  const analise = analisarTexto(afirmacao.texto, catalogo);

  const semantica = guardaSemantica(analise, citados, catalogo);
  if (semantica) return { valida: false, ...semantica };

  const entidadesCitadas = new Set(citados.flatMap((f) => [f.entidade, ...(f.entidadesCitadas ?? [])]).filter(Boolean));
  const estranha = analise.mencoes.find((m) => !entidadesCitadas.has(m.entidade));
  if (estranha) return { valida: false, motivo: "ENTIDADE_NAO_REFERENCIADA", detalhe: estranha.entidade };

  const datasValidas = new Set();
  const contexto = [...citados, ...catalogo.fatos.filter((f) => /periodo|janela|metodologia|dataReferencia/.test(f.metrica))];
  for (const f of contexto) {
    if (f.unidade === "data") datasValidas.add(`${Number(f.valor.slice(8, 10))}/${Number(f.valor.slice(5, 7))}`);
    if (f.unidade === "texto") analisarTexto(f.valor, catalogo).datas.forEach((d) => datasValidas.add(d.chave));
  }
  const data = analise.datas.find((d) => !datasValidas.has(d.chave));
  if (data) return { valida: false, motivo: "DATA_NAO_SUPORTADA", detalhe: data.bruto };

  const extrasNum = extras.flatMap((e) => analisarTexto(e, { entidades: [] }).atomos.flatMap((a) => a.valores));
  const cands = candidatos(citados);
  const doPeriodo = candidatos(contexto.filter((f) => /periodo|janela|metodologia/.test(f.metrica)));
  for (const atomo of analise.atomos) {
    const falha = conferirNumero(atomo, cands, extrasNum, doPeriodo);
    if (falha) return { valida: false, motivo: `NUMERO_${falha}`, detalhe: atomo.bruto };
  }
  return { valida: true };
}

/** Separa as afirmações em aceitas e descartadas (com o motivo, para a auditoria). */
export function verificarAfirmacoes(afirmacoes, catalogo, opcoes) {
  const aceitas = [];
  const descartadas = [];
  for (const a of afirmacoes) {
    const v = validarAfirmacao(a, catalogo, opcoes);
    if (v.valida) aceitas.push(a);
    else descartadas.push({ ...a, motivo: v.motivo, ...(v.detalhe && { detalhe: v.detalhe }) });
  }
  return { aceitas, descartadas };
}

/** Fatos críticos presentes no catálogo que nenhuma afirmação aceita citou → ressalvas determinísticas. */
export function ressalvasPendentes(catalogo, aceitas = []) {
  const citados = new Set(aceitas.flatMap((a) => a.factIds));
  const porCodigo = new Map();
  for (const f of catalogo.fatos) {
    if (!f.critico) continue;
    if (!porCodigo.has(f.critico)) porCodigo.set(f.critico, false);
    if (citados.has(f.id)) porCodigo.set(f.critico, true);
  }
  return [...porCodigo].filter(([, citado]) => !citado).map(([codigo]) => ({ codigo, texto: CRITICOS[codigo] }));
}

// ---------------------------------------------------------------- contrato da síntese

export const ESQUEMA_SINTESE = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["afirmacoes"],
  properties: {
    afirmacoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["texto", "factIds"],
        properties: { texto: { type: "string" }, factIds: { type: "array", items: { type: "string" } } },
      },
    },
  },
});

const SINTESE = z.object({
  afirmacoes: z.array(z.object({ texto: z.string().trim().min(1).max(600), factIds: z.array(z.string().max(10)).max(15) }).strict()).min(1),
}).strict();

/** Texto JSON do provedor → afirmações (no máximo MAX_AFIRMACOES), ou { erro }. Nunca lança. */
export function lerSintese(texto) {
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { valida: false, erro: "JSON_INVALIDO" };
  }
  const r = SINTESE.safeParse(bruto);
  if (!r.success) return { valida: false, erro: "FORA_DO_CONTRATO" };
  return { valida: true, afirmacoes: r.data.afirmacoes.slice(0, MAX_AFIRMACOES), excedentes: Math.max(0, r.data.afirmacoes.length - MAX_AFIRMACOES) };
}
