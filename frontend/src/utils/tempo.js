// Relógio do negócio (Etapa 0.5): datas e horas são as de Manaus, qualquer que
// seja o fuso do aparelho. A API recebe a data-hora civil de Manaus SEM "Z"
// ("2026-09-29T14:37:05"); o "Z" dizia UTC sem ser.
// Política: docs/tcc/etapa-0-5-politica-temporal.md
export const FUSO_NEGOCIO = 'America/Manaus';

const formato = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_NEGOCIO,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Componentes do relógio de Manaus agora: { ano, mes, dia, hh, mm, ss } (strings). */
function agoraEmManaus() {
  const p = {};
  for (const { type, value } of formato.formatToParts(new Date())) p[type] = value;
  return { ano: p.year, mes: p.month, dia: p.day, hh: p.hour, mm: p.minute, ss: p.second };
}

/** "dd/mm/aaaa" de hoje em Manaus. */
export function hojeFormatado() {
  const { dia, mes, ano } = agoraEmManaus();
  return `${dia}/${mes}/${ano}`;
}

/** Data escolhida ("aaaa-mm-dd") + hora atual de Manaus, sem fuso: "aaaa-mm-ddTHH:MM:SS". */
export function comHoraAtual(dataIso) {
  const { hh, mm, ss } = agoraEmManaus();
  return `${dataIso}T${hh}:${mm}:${ss}`;
}

/** Mês (1–12) e ano correntes em Manaus, para os filtros padrão. */
export function mesEAnoAtuais() {
  const { mes, ano } = agoraEmManaus();
  return { mes: Number(mes), ano: Number(ano) };
}
