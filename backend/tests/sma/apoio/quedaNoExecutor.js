// Etapa 6 — processo-filho usado por acoesAtomicas.test.js: começa a executar
// uma ação, grava a venda DENTRO da transação e morre (process.exit) antes do
// commit, como uma queda real do servidor. Só roda contra o banco de TESTE.
import * as servicoAcoes from "../../../src/agents/acoes/servicoAcoes.js";
import * as vendasService from "../../../src/services/vendasService.js";

if (!process.env.DATABASE_URL?.split("?")[0].endsWith("_test")) {
  console.error("recusado: só no banco de teste");
  process.exit(2);
}
const acaoId = Number(process.argv[2]);
await servicoAcoes.executarAcaoAprovada(acaoId, {
  contratos: {
    REGISTRAR_VENDA: {
      async executar(p, tx) {
        const quantidade = p.sabores.reduce((s, i) => s + i.quantidade, 0);
        await vendasService.criarVenda({ ...p, quantidade }, tx); // escrito, ainda sem commit
        console.log("VENDA_GRAVADA_SEM_COMMIT");
        process.exit(17); // queda do processo no meio da transação
      },
    },
  },
});
