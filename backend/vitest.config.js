// Suíte de caracterização (Etapa 0.3 do TCC).
// Guia: docs/tcc/etapa-0-3-testes-caracterizacao.md
import { defineConfig } from "vitest/config";
import { TZ_TESTE } from "./tests/caracterizacao/setup/ambiente.js";

export default defineConfig({
  test: {
    // Caracterização (Etapa 0) e camada SMA (Etapa 1). tests/api.test.js é o
    // smoke test manual antigo e não faz parte da suíte.
    include: ["tests/caracterizacao/**/*.test.js", "tests/sma/**/*.test.js"],
    // Recria o banco doces_maloca_test e sobe o src/server.js real apontando
    // para ele.
    globalSetup: ["tests/caracterizacao/setup/globalSetup.js"],
    // Em cada processo de teste: guardas, banco de teste e limpeza antes de
    // cada teste.
    setupFiles: ["tests/caracterizacao/setup/porArquivo.js"],
    // Um único banco de teste: arquivos rodam um de cada vez, num único
    // processo de longa duração. Com um processo por arquivo (isolate: true),
    // observamos no Windows execuções em que os últimos resultados de um
    // arquivo não chegavam ao Vitest (testes "pending" e a execução ainda
    // reportada como sucesso). O isolamento entre testes vem da limpeza do
    // banco em setup/porArquivo.js, não do processo.
    fileParallelism: false,
    pool: "forks",
    isolate: false,
    maxWorkers: 1,
    // Fuso do processo: UTC por padrão (container de produção); ver
    // MALOCA_TZ_TESTE em setup/ambiente.js.
    // Etapa 5: sem provedor de LLM real nem chave nos processos de teste.
    env: { TZ: TZ_TESTE, LLM_PROVIDER: "", ANTHROPIC_API_KEY: "" },
    testTimeout: 20000,
    hookTimeout: 120000,
  },
});
