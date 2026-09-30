/**
 * Erro de domínio: um service sinaliza uma situação prevista (validação,
 * registro inexistente, estoque insuficiente...) sem conhecer HTTP.
 *
 * `status` e `corpo` guardam exatamente o que a API respondia antes da
 * extração, para que o contrato HTTP permaneça idêntico. Um chamador sem HTTP
 * (ex.: futura tool de agente) pode usar `corpo.error` e os demais campos.
 */
export class ErroDominio extends Error {
  constructor(status, corpo) {
    super(corpo?.error ?? "Erro de domínio");
    this.name = "ErroDominio";
    this.status = status;
    this.corpo = corpo;
  }
}

/** Atalho para o formato mais comum: { error: mensagem }. */
export const erro = (status, mensagem, extras = {}) =>
  new ErroDominio(status, { error: mensagem, ...extras });

/**
 * Nos controllers: responde um ErroDominio e devolve true; para qualquer outro
 * erro devolve false e o controller mantém o seu tratamento 500 original.
 */
export function responderErroDominio(res, error) {
  if (error instanceof ErroDominio) {
    res.status(error.status).json(error.corpo);
    return true;
  }
  return false;
}
