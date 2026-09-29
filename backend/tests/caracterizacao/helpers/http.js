// Cliente HTTP (Supertest) contra o src/server.js real iniciado no globalSetup.
import request from "supertest";
import { inject } from "vitest";

/**
 * api()            -> requisições sem autenticação
 * api(token)       -> Authorization: Bearer <token>
 * api(token, key)  -> também envia x-api-key
 */
export function api(token, apiKey) {
  const base = request(inject("baseUrl"));
  const metodo = (m) => (caminho) => {
    let r = base[m](caminho);
    if (token) r = r.set("Authorization", `Bearer ${token}`);
    if (apiKey) r = r.set("x-api-key", apiKey);
    return r;
  };
  return {
    get: metodo("get"),
    post: metodo("post"),
    put: metodo("put"),
    patch: metodo("patch"),
    delete: metodo("delete"),
  };
}

/** Requisição crua, para montar cabeçalhos fora do padrão. */
export const cru = () => request(inject("baseUrl"));
