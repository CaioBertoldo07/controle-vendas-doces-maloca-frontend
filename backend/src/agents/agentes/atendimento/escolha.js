// Resolução determinística da escolha numa desambiguação pendente (Etapa 5).
// Pura. Aceita a posição ("a segunda", "2", "opção 2", "a última") ou o nome
// completo de UMA das opções. Qualquer outra coisa → null (nada é adivinhado).
import { normalizarNome } from "../../conversa/fatos.js";

const ORDINAIS = [
  [/\b(primeir[oa]|1[ºªoa]?|um|uma)\b/, 1],
  [/\b(segund[oa]|2[ºªoa]?|dois|duas)\b/, 2],
  [/\b(terceir[oa]|3[ºªoa]?|tres)\b/, 3],
  [/\b(quart[oa]|4[ºªoa]?|quatro)\b/, 4],
  [/\b(quint[oa]|5[ºªoa]?|cinco)\b/, 5],
];

const semAcento = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function resolverEscolha(mensagem, opcoes) {
  if (!Array.isArray(opcoes) || opcoes.length === 0) return null;
  const msg = semAcento(mensagem).trim();
  if (/\bultim[oa]\b/.test(msg)) return opcoes.at(-1);
  const posicoes = ORDINAIS.filter(([re]) => re.test(msg)).map(([, n]) => n);
  if (posicoes.length === 1 && posicoes[0] <= opcoes.length) return opcoes[posicoes[0] - 1];
  const alvo = normalizarNome(mensagem);
  if (!alvo) return null;
  const exatas = opcoes.filter((o) => normalizarNome(o.nome) === alvo);
  if (exatas.length === 1) return exatas[0];
  const contidas = opcoes.filter((o) => alvo.includes(normalizarNome(o.nome)));
  return contidas.length === 1 ? contidas[0] : null;
}

export const ehCancelamento = (mensagem) => /^\s*(cancel|deixa|esquece|nenhum|nenhuma)/i.test(semAcento(mensagem));
