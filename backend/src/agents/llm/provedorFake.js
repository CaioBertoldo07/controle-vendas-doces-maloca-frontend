// Provedor de LLM falso e determinístico para testes (Etapa 1). Segue um
// roteiro de passos; cada chamada a gerar() consome um passo:
//   { texto: "..." }                                  → resposta textual
//   { json: {...} }                                   → resposta JSON (pedidos com formato; Etapa 5)
//   { chamadas: [{ nome, entrada }, ...] }            → tool call(s)
//   { erro: "mensagem" }                              → o provedor falha
//   { atrasoMs: n, ...passo }                         → demora n ms (timeout lógico)
//   { uso: { tokensEntrada, tokensSaida }, ...passo } → uso informado (como um provedor real)
//   (requisicao) => passo                             → passo calculado
// `requisicoes` guarda exatamente o que o provedor recebeu, para asserções.
let sequencia = 0;

export function criarProvedorFake(roteiro = []) {
  const passos = [...roteiro];
  const requisicoes = [];

  return {
    nome: "fake",
    requisicoes,
    async gerar(requisicao) {
      requisicoes.push(JSON.parse(JSON.stringify(requisicao)));
      if (passos.length === 0) throw new Error("Roteiro do provedor fake esgotado");
      let passo = passos.shift();
      if (typeof passo === "function") passo = passo(requisicao);
      if (passo.atrasoMs) await new Promise((r) => setTimeout(r, passo.atrasoMs));
      if (passo.erroLLM) throw passo.erroLLM; // ErroLLM pronto (ex.: indisponível, recusa)
      if (passo.erro) throw new Error(passo.erro);
      const uso = passo.uso ? { modelo: "fake", ...passo.uso } : undefined;
      if (passo.chamadas) {
        return {
          tipo: "tools",
          texto: passo.texto ?? "",
          chamadas: passo.chamadas.map((c) => ({ id: c.id ?? `fake-${++sequencia}`, nome: c.nome, entrada: c.entrada ?? {} })),
          ...(uso && { uso }),
        };
      }
      const texto = passo.json !== undefined ? JSON.stringify(passo.json) : (passo.texto ?? "");
      return { tipo: "texto", texto, ...(uso && { uso }) };
    },
  };
}
