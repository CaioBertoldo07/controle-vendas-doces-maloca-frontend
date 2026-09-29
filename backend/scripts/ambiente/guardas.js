/**
 * Guardas de ambiente de banco de dados (Etapa 0 do TCC).
 *
 * Impedem que ferramentas de desenvolvimento/teste (seed, db push, reset do
 * banco de teste, backfill, servidor de desenvolvimento) sejam executadas
 * contra o banco de produção.
 *
 * Regra geral: negar por padrão. Uma operação só é liberada quando o ambiente
 * foi declarado explicitamente (APP_ENV) e o banco é local.
 *
 * As funções `avaliar*` são puras (recebem `env` por parâmetro) para poderem
 * ser testadas com `node --test`. As funções `garantir*` carregam o `.env`,
 * avaliam e encerram o processo com código 1 quando a operação é negada.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const DIR_BACKEND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const HOSTS_LOCAIS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

// Hosts de banco usados pelo Railway (proxy público e rede privada).
const PADROES_HOST_PRODUCAO = [
  /\.rlwy\.net$/i,
  /\.railway\.app$/i,
  /\.railway\.internal$/i,
];

// Variáveis que o Railway injeta nos serviços (build e runtime).
const VARIAVEIS_RAILWAY = [
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
];

export const FINALIDADES = Object.freeze({
  DESENVOLVIMENTO: "desenvolvimento",
  TESTE: "teste",
});

/** Carrega backend/.env sem sobrescrever variáveis já definidas no shell. */
export function carregarEnv() {
  dotenv.config({ path: path.join(DIR_BACKEND, ".env") });
}

/** Extrai host/porta/banco de uma URL mysql://. Nunca expõe a senha. */
export function analisarUrlBanco(url) {
  if (!url || typeof url !== "string") {
    return { valida: false, motivo: "URL ausente" };
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    return { valida: false, motivo: "URL malformada" };
  }
  if (u.protocol !== "mysql:") {
    return { valida: false, motivo: `protocolo "${u.protocol}" não é mysql:` };
  }
  const host = u.hostname.toLowerCase();
  return {
    valida: true,
    host,
    porta: u.port || "3306",
    banco: decodeURIComponent(u.pathname.replace(/^\//, "")),
    local: HOSTS_LOCAIS.has(host),
    hostDeProducao: PADROES_HOST_PRODUCAO.some((re) => re.test(host)),
  };
}

/** Representação segura (sem usuário/senha) para logs. */
export function descreverBanco(info) {
  if (!info?.valida) return "(URL inválida)";
  return `${info.host}:${info.porta}/${info.banco}`;
}

function indicadoresDeProducao(env, info) {
  const motivos = [];
  if (env.NODE_ENV === "production") motivos.push("NODE_ENV=production");
  if (env.APP_ENV === "production") motivos.push("APP_ENV=production");
  const railway = VARIAVEIS_RAILWAY.filter((v) => env[v]);
  if (railway.length > 0) {
    motivos.push(`executando dentro do Railway (${railway.join(", ")})`);
  }
  if (info?.hostDeProducao) {
    motivos.push(`host do banco é do Railway (${info.host})`);
  }
  return motivos;
}

function mesmoBanco(a, b) {
  return (
    a?.valida &&
    b?.valida &&
    a.host === b.host &&
    a.porta === b.porta &&
    a.banco === b.banco
  );
}

/**
 * Decide se uma operação de desenvolvimento/teste pode acessar o banco.
 *
 * - desenvolvimento: usa DATABASE_URL; exige APP_ENV=development.
 * - teste: usa DATABASE_URL_TEST; exige banco terminado em "_test" e
 *   diferente do banco de desenvolvimento.
 *
 * Em ambos: bloqueia qualquer indício de produção e exige host local, a não
 * ser que ALLOW_NON_LOCAL_DEV_DATABASE=true (hosts do Railway continuam
 * bloqueados mesmo assim).
 */
export function avaliarAcessoAoBanco(finalidade, env = process.env) {
  const motivos = [];
  let info;

  if (finalidade === FINALIDADES.DESENVOLVIMENTO) {
    info = analisarUrlBanco(env.DATABASE_URL);
    if (env.APP_ENV !== "development") {
      motivos.push(
        `APP_ENV deve ser "development" (atual: ${env.APP_ENV ? `"${env.APP_ENV}"` : "não definido"})`,
      );
    }
    if (!info.valida) motivos.push(`DATABASE_URL: ${info.motivo}`);
  } else if (finalidade === FINALIDADES.TESTE) {
    info = analisarUrlBanco(env.DATABASE_URL_TEST);
    if (!info.valida) motivos.push(`DATABASE_URL_TEST: ${info.motivo}`);
    if (info.valida && !info.banco.endsWith("_test")) {
      motivos.push(
        `o banco de teste deve terminar em "_test" (atual: "${info.banco}")`,
      );
    }
    if (mesmoBanco(info, analisarUrlBanco(env.DATABASE_URL))) {
      motivos.push("DATABASE_URL_TEST aponta para o mesmo banco de DATABASE_URL");
    }
  } else {
    return {
      permitido: false,
      motivos: [`finalidade desconhecida: "${finalidade}"`],
      info: null,
    };
  }

  motivos.push(...indicadoresDeProducao(env, info));

  if (
    info.valida &&
    !info.local &&
    env.ALLOW_NON_LOCAL_DEV_DATABASE !== "true"
  ) {
    motivos.push(
      `o banco não é local (${info.host}); defina ALLOW_NON_LOCAL_DEV_DATABASE=true se for um banco de desenvolvimento remoto`,
    );
  }

  return { permitido: motivos.length === 0, motivos, info };
}

/**
 * Avalia e, se negado, imprime o motivo e encerra o processo com código 1.
 * Retorna o resultado da avaliação quando permitido.
 */
export function garantirAcessoAoBanco(finalidade, { operacao, env } = {}) {
  if (!env) {
    carregarEnv();
    env = process.env;
  }
  const resultado = avaliarAcessoAoBanco(finalidade, env);
  const rotulo = operacao ? ` [${operacao}]` : "";

  if (!resultado.permitido) {
    console.error(
      `\n⛔ Operação bloqueada${rotulo}: ambiente de ${finalidade} não é seguro.`,
    );
    for (const m of resultado.motivos) console.error(`   - ${m}`);
    console.error(
      "   Veja docs/tcc/etapa-0-ambientes-e-baseline.md (seção de proteção).\n",
    );
    process.exit(1);
  }

  console.log(
    `✅ Ambiente de ${finalidade} verificado${rotulo}: ${descreverBanco(resultado.info)}`,
  );
  return resultado;
}
