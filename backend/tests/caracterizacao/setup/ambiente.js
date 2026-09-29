/**
 * Proteção da suíte de caracterização.
 *
 * Antes de qualquer acesso ao banco, exige:
 *   - APP_ENV=development no .env (máquina de desenvolvimento declarada);
 *   - DATABASE_URL_TEST local, terminada em "_test" e diferente de DATABASE_URL;
 *   - nenhum indício de produção (NODE_ENV/APP_ENV=production, variáveis
 *     RAILWAY_*, host do Railway).
 * As regras vêm de scripts/ambiente/guardas.js (Etapa 0.1).
 */
import {
  avaliarAcessoAoBanco,
  carregarEnv,
  descreverBanco,
} from "../../../scripts/ambiente/guardas.js";

// Segredos fictícios, usados só pela suíte (servidor de teste e fixtures).
export const JWT_SECRET_TESTE = "segredo-ficticio-da-suite-de-caracterizacao";
export const API_KEY_TESTE = "chave-ficticia-da-suite-de-caracterizacao";
export const TZ_TESTE = "UTC";

const MARCADOR = "MALOCA_SUITE_URL_TESTE";

/** Valida o ambiente e devolve a URL do banco de teste. Lança erro se inseguro. */
export function prepararAmbienteDeTeste() {
  // Já preparado neste processo: só confere que nada mudou.
  if (process.env[MARCADOR]) {
    if (process.env.DATABASE_URL !== process.env[MARCADOR]) {
      throw new Error("⛔ DATABASE_URL mudou depois da preparação da suíte. Abortando.");
    }
    return { url: process.env[MARCADOR] };
  }

  carregarEnv();
  const motivos = [];
  if (process.env.APP_ENV !== "development") {
    motivos.push(
      `APP_ENV deve ser "development" no backend/.env (atual: ${process.env.APP_ENV ?? "não definido"})`,
    );
  }
  const avaliacao = avaliarAcessoAoBanco("teste", process.env);
  motivos.push(...avaliacao.motivos);

  if (motivos.length > 0) {
    throw new Error(
      `⛔ Suíte de testes bloqueada — ambiente inseguro:\n   - ${motivos.join("\n   - ")}\n` +
        "   Veja docs/tcc/etapa-0-ambientes-e-baseline.md.",
    );
  }
  return { url: process.env.DATABASE_URL_TEST, descricao: descreverBanco(avaliacao.info) };
}

/** Faz este processo usar exclusivamente o banco de teste. */
export function ativarBancoDeTeste(url) {
  process.env[MARCADOR] = url;
  process.env.DATABASE_URL = url;
  process.env.APP_ENV = "test";
  process.env.TZ = TZ_TESTE;
  process.env.JWT_SECRET = JWT_SECRET_TESTE;
  process.env.N8N_API_KEY = API_KEY_TESTE;
}
