/**
 * Intervalo [primeiro dia 00:00:00, último dia 23:59:59] de um mês, no fuso
 * do processo (em produção, UTC).
 *
 * Mantém exatamente a expressão usada antes nos controllers, inclusive o fim
 * em 23:59:59.000 (KNOWN_BEHAVIOR: 23:59:59,5 do último dia fica fora de
 * qualquer mês) e a coerção de strings ("3" → 3) feita pelo construtor Date.
 */
export function intervaloDoMes(ano, mes) {
  return {
    inicio: new Date(ano, mes - 1, 1),
    fim: new Date(ano, mes, 0, 23, 59, 59),
  };
}
