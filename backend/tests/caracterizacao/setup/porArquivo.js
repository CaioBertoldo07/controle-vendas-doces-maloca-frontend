// Executado em cada processo de teste antes dos arquivos de teste:
// valida o ambiente, fixa o banco de teste e limpa as tabelas antes de cada teste.
import { beforeEach } from "vitest";
import { ativarBancoDeTeste, prepararAmbienteDeTeste } from "./ambiente.js";

const { url } = prepararAmbienteDeTeste();

// Etapa 5: a suíte não usa rede externa (o LLM é sempre o provedor fake). Qualquer
// fetch fora da máquina local falha na hora; o SDK da Anthropic usa fetch.
const fetchOriginal = globalThis.fetch;
const LOCAIS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
globalThis.fetch = (entrada, opcoes) => {
  const alvo = new URL(typeof entrada === "string" || entrada instanceof URL ? entrada : entrada.url);
  if (!LOCAIS.has(alvo.hostname)) return Promise.reject(new Error(`Rede externa bloqueada na suíte de testes: ${alvo.hostname}`));
  return fetchOriginal(entrada, opcoes);
};
ativarBancoDeTeste(url);

// Import dinâmico: o PrismaClient da suíte só é criado depois da ativação.
const { limparBanco } = await import("../helpers/db.js");

beforeEach(async () => {
  await limparBanco();
});

// Sem $disconnect() por arquivo: com um único processo para todos os arquivos
// (vitest.config.js), a conexão vive até o Vitest encerrar o processo.
// Obs.: remover o desconectar/reconectar entre arquivos NÃO eliminou a queda
// nativa intermitente do processo de teste (0xC0000409) investigada na
// Etapa 0.4; ela é tratada em scripts/testes/executarSuite.js.
// Detalhes: docs/tcc/etapa-0-4-extracao-servicos.md.
