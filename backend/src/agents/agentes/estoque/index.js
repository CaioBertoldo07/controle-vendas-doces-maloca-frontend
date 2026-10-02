// Agente de Estoque (Etapa 2): primeiro agente funcional. Análise
// determinística, sem LLM; escreve só recomendações (infraestrutura SMA),
// nunca dados do negócio, e não propõe ações nesta etapa (estoque não
// reconciliado, sem demanda média da Inteligência, sem receitas reais).
//
//   ANALISAR_ESTOQUE → análise completa (analise.js)  { dataReferencia?: "AAAA-MM-DD" }
//   DIAGNOSTICO      → verificação técnica das tools (usada pelo Coordenador)
//   PING             → resposta imediata
//   PERGUNTA         → raciocínio com LLM (só com provedor configurado; hoje só testes)
import { erro } from "../../../lib/erros.js";
import { analisarEstoque } from "./analise.js";

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const estoque = {
  nome: "estoque",
  descricao: "Agente de Estoque: qualidade dos dados de estoque, divergências do saldo histórico, matéria-prima, disponibilidade do MRP e ritmo produção × vendas.",
  tools: [
    "consultarEstoqueAcabado",
    "consultarSaldoMateriasPrimas",
    "consultarReceitas",
    "consultarProducaoVendasPeriodo",
    "calcularNecessidadesProducao",
    "consultarResumoProducao",
    "proporAcao",
  ],
  async executar(contexto) {
    const { tipo, dados = {} } = contexto.entrada ?? {};
    switch (tipo) {
      case "ANALISAR_ESTOQUE": {
        if (dados.dataReferencia !== undefined && !DIA_ISO.test(String(dados.dataReferencia))) {
          throw erro(400, "dataReferencia deve estar no formato AAAA-MM-DD (dia civil de Manaus)");
        }
        return analisarEstoque(contexto, { dataReferencia: dados.dataReferencia });
      }
      case "PING":
        return { agente: "estoque", pong: true };
      case "DIAGNOSTICO": {
        const resultados = {};
        for (const tool of ["consultarEstoqueAcabado", "consultarSaldoMateriasPrimas"]) {
          const r = await contexto.usarTool(tool, {});
          resultados[tool] = r.ok ? "ok" : r.erro.codigo;
        }
        return { agente: "estoque", toolsOk: Object.values(resultados).every((v) => v === "ok"), tools: resultados };
      }
      case "PERGUNTA": {
        if (typeof dados.pergunta !== "string" || !dados.pergunta.trim()) throw erro(400, "PERGUNTA exige dados.pergunta");
        const r = await contexto.raciocinar({
          sistema: 'Você é o agente "estoque" do Doces da Maloca. Use apenas as tools disponíveis; todos os números vêm delas.',
          mensagens: [{ papel: "usuario", conteudo: dados.pergunta }],
        });
        return { agente: "estoque", resposta: r.texto, passos: r.passos, chamadas: r.chamadas };
      }
      default:
        throw erro(400, `Tipo de execução não suportado pelo agente estoque: "${tipo}"`);
    }
  },
};
