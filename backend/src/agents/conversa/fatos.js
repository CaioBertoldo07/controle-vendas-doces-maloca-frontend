// Proteção contra alucinação factual (Etapa 5). Puras.
//
// Estratégia: todo NÚMERO que aparece no texto redigido pelo LLM (quantidade,
// dinheiro, percentual, data) precisa existir nos fatos que os especialistas
// produziram, ou na própria mensagem do gestor. Se algum não existir, a
// redação é descartada e a resposta sai do TEMPLATE determinístico (que só
// usa os fatos). Não é verificação semântica: é uma trava simples e
// auditável para que valores críticos não surjam do nada.

/** Inteiros pequenos sempre aceitos ("2 sabores", "1 cliente"): risco baixo, evita falsos bloqueios. */
const SEMPRE_ACEITOS = new Set([0, 1, 2, 3, 4]);

const DATA_BR = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const DATA_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const NUMERO = /\d+(?:[.,]\d+)*/g;

/** Interpretações possíveis de um número escrito (pt-BR "1.234,5" ou "66,7"; ou "66.7"). */
export function valoresDe(bruto) {
  const v = new Set();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(bruto)) v.add(Number(bruto.replace(/\./g, "").replace(",", ".")));
  if (/^\d+,\d+$/.test(bruto)) v.add(Number(bruto.replace(",", ".")));
  if (/^\d+(\.\d+)?$/.test(bruto)) v.add(Number(bruto));
  if (v.size === 0) for (const parte of bruto.split(/[.,]/)) v.add(Number(parte));
  return [...v].filter(Number.isFinite);
}

/** Números citados num texto. Datas "30/08" e "2026-08-30" viram dia/mês/ano (comparados como datas). */
export function extrairNumeros(texto) {
  const itens = [];
  let t = String(texto ?? "");
  t = t.replace(DATA_ISO, (_, a, m, d) => {
    itens.push({ bruto: `${a}-${m}-${d}`, data: { dia: Number(d), mes: Number(m), ano: Number(a) } });
    return " ";
  });
  t = t.replace(DATA_BR, (_, d, m, a) => {
    itens.push({ bruto: `${d}/${m}${a ? `/${a}` : ""}`, data: { dia: Number(d), mes: Number(m), ano: a ? Number(a.length === 2 ? `20${a}` : a) : null } });
    return " ";
  });
  for (const bruto of t.match(NUMERO) ?? []) itens.push({ bruto, valores: valoresDe(bruto) });
  return itens;
}

/** Números e datas presentes num objeto de fatos (valores numéricos e números dentro de textos). */
export function catalogarFatos(...fontes) {
  const numeros = new Set();
  const datas = new Set();
  const visitar = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) numeros.add(v);
    else if (typeof v === "string") {
      for (const it of extrairNumeros(v)) {
        if (it.data) {
          datas.add(`${it.data.dia}/${it.data.mes}`);
          if (it.data.ano) numeros.add(it.data.ano);
        } else it.valores.forEach((x) => numeros.add(x));
      }
    } else if (Array.isArray(v)) v.forEach(visitar);
    else if (v && typeof v === "object") Object.values(v).forEach(visitar);
  };
  fontes.forEach(visitar);
  return { numeros: [...numeros], datas };
}

const casasDecimais = (x) => (String(x).split(".")[1] ?? "").length;

/** `citado` corresponde a algum número dos fatos, com o arredondamento que o texto usou (inclui |x| para "-20" escrito "20"). */
function suportado(citado, numeros) {
  if (SEMPRE_ACEITOS.has(citado)) return true;
  const casas = casasDecimais(citado);
  return numeros.some((n) => [n, Math.abs(n)].some((c) => Number(c.toFixed(casas)) === citado || c === citado));
}

/**
 * Verifica o texto redigido contra os fatos. Devolve { aprovada, naoSuportados }.
 * `extras`: outros textos confiáveis (ex.: a mensagem do gestor, que pode citar "8 semanas").
 */
export function verificarNumeros(texto, fatos, extras = []) {
  const { numeros, datas } = catalogarFatos(fatos, extras);
  const naoSuportados = [];
  for (const it of extrairNumeros(texto)) {
    if (it.data) {
      if (!datas.has(`${it.data.dia}/${it.data.mes}`)) naoSuportados.push(it.bruto);
    } else if (!it.valores.some((v) => suportado(v, numeros))) naoSuportados.push(it.bruto);
  }
  return { aprovada: naoSuportados.length === 0, naoSuportados };
}

/** Normalização de nomes para conferir que o LLM não "inventou" uma entidade que o gestor não citou. */
export const normalizarNome = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** O texto extraído pelo LLM aparece na mensagem original? (nomes de cliente/sabor) */
export const citadoNaMensagem = (trecho, mensagem) => {
  const t = normalizarNome(trecho);
  return t.length > 0 && normalizarNome(mensagem).includes(t);
};

/** O número extraído pelo LLM aparece na mensagem original? (quantidade, valor, vendaId) */
export const numeroNaMensagem = (valor, mensagem) => extrairNumeros(mensagem).some((it) => it.valores?.some((v) => v === valor));
