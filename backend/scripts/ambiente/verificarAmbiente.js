/**
 * Verifica se o ambiente local é seguro antes de subir o servidor de
 * desenvolvimento ou executar ferramentas de banco.
 *
 * Uso:
 *   node scripts/ambiente/verificarAmbiente.js            # desenvolvimento
 *   node scripts/ambiente/verificarAmbiente.js teste
 */
import { FINALIDADES, garantirAcessoAoBanco } from "./guardas.js";

const finalidade = process.argv[2] || FINALIDADES.DESENVOLVIMENTO;

garantirAcessoAoBanco(finalidade, { operacao: "verificação de ambiente" });
