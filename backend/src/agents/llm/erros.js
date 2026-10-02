// Erros do provedor de LLM (Etapa 5), independentes de fornecedor. Mensagens
// sem segredos: nunca incluem chave, prompt ou corpo da requisição.
export const CODIGOS_LLM = Object.freeze({
  CONFIGURACAO: "CONFIGURACAO", //    provedor selecionado sem credencial ou desconhecido
  CREDENCIAL: "CREDENCIAL", //        chave recusada pelo fornecedor (401/403)
  INDISPONIVEL: "INDISPONIVEL", //    rede, limite de taxa, sobrecarga ou 5xx (transitório)
  TEMPO_ESGOTADO: "TEMPO_ESGOTADO", // passou do tempo limite (transitório)
  RECUSA: "RECUSA", //                o modelo recusou responder
  LIMITE_TOKENS: "LIMITE_TOKENS", //  resposta cortada por max_tokens
  REQUISICAO: "REQUISICAO", //        requisição rejeitada (400/404): erro do adaptador ou do modelo configurado
  RESPOSTA_INVALIDA: "RESPOSTA_INVALIDA",
});

const TRANSITORIOS = new Set([CODIGOS_LLM.INDISPONIVEL, CODIGOS_LLM.TEMPO_ESGOTADO]);

export class ErroLLM extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = "ErroLLM";
    this.codigo = codigo;
    this.transitorio = TRANSITORIOS.has(codigo);
  }
}
