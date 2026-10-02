/**
 * Política temporal do Doces da Maloca (Etapa 0.5).
 * Documento: docs/tcc/etapa-0-5-politica-temporal.md
 *
 * Fuso do negócio: America/Manaus.
 *
 * Os campos de negócio (Venda.data, Venda.dataPagamento, Producao.data,
 * Custo.data, MovimentacaoMateriaPrima.data) guardam a DATA-HORA CIVIL DE
 * MANAUS: o DATETIME do MySQL contém o relógio de parede de Manaus. É a
 * convenção que o histórico já segue (o frontend sempre gravou o horário de
 * Manaus nesses campos).
 *
 * No código, esse valor é um Date "civil": os componentes UTC dele
 * (getUTCFullYear, getUTCHours...) SÃO o relógio de Manaus. Toda aritmética de
 * calendário deste módulo usa Date.UTC/getUTC* e o Intl com timeZone
 * explícito, nunca o fuso do processo. Por isso o resultado é o mesmo com
 * TZ=UTC ou TZ=America/Manaus.
 *
 * Intervalos são semiabertos [inicio, fimExclusivo): use `gte`/`lt`. Assim
 * nenhum instante fica entre um período e o seguinte, como acontecia com o
 * fim em 23:59:59.000 (KNOWN_BEHAVIOR K16, corrigido na 0.5).
 */

export const FUSO_NEGOCIO = "America/Manaus";

/** Campos serializados como data-hora civil de Manaus nas respostas HTTP. */
export const CAMPOS_CIVIS = new Set(["data", "dataPagamento"]);

const formatoManaus = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_NEGOCIO,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/**
 * Date civil a partir de componentes do calendário de Manaus. Aceita
 * transbordo como o construtor Date (mes 13 → janeiro do ano seguinte,
 * dia 0 → último dia do mês anterior) e anos < 100 sem o salto para 19xx.
 */
export function civil(ano, mes, dia = 1, hora = 0, minuto = 0, segundo = 0, ms = 0) {
  const d = new Date(0);
  d.setUTCFullYear(Number(ano), Number(mes) - 1, Number(dia));
  d.setUTCHours(Number(hora), Number(minuto), Number(segundo), Number(ms));
  return d;
}

/** Instante real → Date civil (relógio de Manaus naquele instante). */
export function paraCivil(instante) {
  const t = instante instanceof Date ? instante.getTime() : Number(instante);
  if (!Number.isFinite(t)) return new Date(NaN);
  const p = {};
  for (const { type, value } of formatoManaus.formatToParts(new Date(t))) p[type] = value;
  return civil(p.year, p.month, p.day, p.hour, p.minute, p.second, new Date(t).getUTCMilliseconds());
}

/** Relógio de Manaus agora, como Date civil. */
export const agoraCivil = () => paraCivil(new Date());

/** Date civil → instante real (resolve o deslocamento de Manaus naquela data). */
export function civilParaInstante(dataCivil) {
  const c = dataCivil.getTime();
  if (!Number.isFinite(c)) return new Date(NaN);
  let t = c;
  for (let i = 0; i < 2; i++) t = c - (paraCivil(new Date(t)).getTime() - t);
  return new Date(t);
}

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATA_HORA_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Lê uma data recebida pela API ou por um chamador interno e devolve o Date
 * civil a gravar:
 *   "2026-09-29"                    → data civil (00:00 de Manaus);
 *   "2026-09-29T14:37[:05[.123]]"   → data-hora civil de Manaus (formato do frontend);
 *   "...Z" ou "...±hh:mm"           → instante real, convertido para Manaus;
 *   Date ou número (ms)             → instante real, convertido para Manaus.
 * Qualquer outra coisa → Invalid Date (o Prisma rejeita, como antes).
 */
export function lerDataCivil(valor) {
  if (valor instanceof Date || typeof valor === "number") return paraCivil(valor);
  if (typeof valor !== "string") return new Date(NaN);

  const soData = DATA_ISO.exec(valor);
  if (soData) {
    const [, a, m, d] = soData.map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? civil(a, m, d) : new Date(NaN);
  }

  const dh = DATA_HORA_ISO.exec(valor);
  if (!dh) return new Date(NaN);
  const [, a, m, d, h, mi, s = "0", frac = "0", fuso] = dh;
  const [A, M, D, H, MI, S] = [a, m, d, h, mi, s].map(Number);
  if (M < 1 || M > 12 || D < 1 || D > 31 || H > 23 || MI > 59 || S > 59) return new Date(NaN);
  const ms = Number(frac.padEnd(3, "0").slice(0, 3));
  const componentes = civil(A, M, D, H, MI, S, ms);
  if (!fuso) return componentes; // sem fuso: já é o relógio de Manaus

  let deslocamentoMin = 0;
  if (fuso !== "Z") {
    const [, sinal, hh, mm] = /^([+-])(\d{2}):?(\d{2})$/.exec(fuso);
    deslocamentoMin = (sinal === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm));
  }
  return paraCivil(new Date(componentes.getTime() - deslocamentoMin * 60000));
}

// ---------- Períodos de negócio (todos em Manaus, semiabertos) ----------

/**
 * Mês civil de Manaus: [1º dia 00:00, 1º dia do mês seguinte 00:00).
 * `ano`/`mes` podem vir como string da query ("3" → 3).
 */
export function intervaloDoMes(ano, mes) {
  return { inicio: civil(ano, mes, 1), fimExclusivo: civil(ano, Number(mes) + 1, 1) };
}

/** Dia civil que contém a data civil informada. */
export function intervaloDoDia(dataCivil) {
  const [a, m, d] = [dataCivil.getUTCFullYear(), dataCivil.getUTCMonth() + 1, dataCivil.getUTCDate()];
  return { inicio: civil(a, m, d), fimExclusivo: civil(a, m, d + 1) };
}

/** Semana civil (domingo a sábado) que contém a data civil informada. */
export function intervaloDaSemana(dataCivil) {
  const [a, m, d] = [dataCivil.getUTCFullYear(), dataCivil.getUTCMonth() + 1, dataCivil.getUTCDate()];
  const domingo = d - dataCivil.getUTCDay();
  return { inicio: civil(a, m, domingo), fimExclusivo: civil(a, m, domingo + 7) };
}

/** Dias civis de dataInicio a dataFim, os dois inclusive ("AAAA-MM-DD"). */
export function intervaloEntreDatas(dataInicio, dataFim) {
  const ini = lerDataCivil(dataInicio);
  const fim = lerDataCivil(dataFim);
  return { inicio: intervaloDoDia(ini).inicio, fimExclusivo: intervaloDoDia(fim).fimExclusivo };
}

/** "AAAA-MM-DD" do dia civil de uma data civil. */
export const diaCivilISO = (dataCivil) => dataCivil.toISOString().slice(0, 10);

/** "AAAA-MM-DD" de hoje em Manaus. */
export const hojeCivilISO = () => diaCivilISO(agoraCivil());

/** Dia civil deslocado em n dias ("2026-03-01", -1 → "2026-02-28"). */
export function deslocarDiaISO(diaISO, dias) {
  const [a, m, d] = diaISO.split("-").map(Number);
  return diaCivilISO(civil(a, m, d + dias));
}

/** Ano e mês correntes em Manaus. */
export function mesAtualCivil() {
  const agora = agoraCivil();
  return { ano: agora.getUTCFullYear(), mes: agora.getUTCMonth() + 1 };
}

// ---------- Rótulos (calendário civil, independentes do fuso do processo) ----------

/** "31/03/2026" */
export const formatarDiaCivil = (dataCivil) =>
  dataCivil.toLocaleDateString("pt-BR", { timeZone: "UTC" });

/** "março" */
export const nomeDoMes = (dataCivil) =>
  dataCivil.toLocaleString("pt-BR", { month: "long", timeZone: "UTC" });

/** "março de 2026" */
export const rotuloMesAno = (dataCivil) =>
  dataCivil.toLocaleString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

// ---------- Serialização HTTP ----------

/**
 * "2026-03-31T23:30:00.000-04:00": relógio de Manaus + deslocamento real
 * daquele momento. É ao mesmo tempo um instante ISO 8601 correto e legível
 * como horário local (sem o antigo "Z" que dizia UTC sem ser).
 */
export function serializarCivil(dataCivil) {
  if (!Number.isFinite(dataCivil.getTime())) return null;
  const deslocamentoMin = Math.round((dataCivil.getTime() - civilParaInstante(dataCivil).getTime()) / 60000);
  const sinal = deslocamentoMin < 0 ? "-" : "+";
  const abs = Math.abs(deslocamentoMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${dataCivil.toISOString().slice(0, 23)}${sinal}${hh}:${mm}`;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Replacer de JSON do Express (server.js): os campos civis, que o Date
 * serializaria com "Z", saem com o deslocamento de Manaus. Os demais campos
 * de data (ex.: criadoEm, instante técnico em UTC) não são alterados.
 */
export function replacerJsonTemporal(chave, valor) {
  if (CAMPOS_CIVIS.has(chave) && typeof valor === "string" && ISO_UTC.test(valor)) {
    return serializarCivil(new Date(valor));
  }
  return valor;
}
