// Agente de Inteligência (Etapa 3): segundo agente funcional. Indicadores
// descritivos, demanda média recente, média móvel, variação, tendência
// recente e perfil por dia da semana; tudo determinístico, sem LLM, só por
// tools de leitura. Não escreve nada (nem recomendações, nesta etapa).
//
//   ANALISAR_INTELIGENCIA → resumo gerencial   { dataReferencia?, janelaSemanas?, perfilPorSabor? }
//   DEMANDA_MEDIA         → contrato com o Estoque (contratos/demandaMedia.js)
//   DIAGNOSTICO           → verificação técnica das tools (usada pelo Coordenador)
//   PING                  → resposta imediata
//   PERGUNTA              → raciocínio com LLM (só com provedor configurado; hoje só testes)
import { z } from "zod";
import { erro } from "../../../lib/erros.js";
import { deslocarDiaISO, hojeCivilISO } from "../../../lib/periodos.js";
import { DEMANDA_MEDIA, JANELA_SEMANAS } from "../../contratos/demandaMedia.js";
import { analisarInteligencia, calcularDemandaMedia } from "./analise.js";

const parametrosAnalise = z
  .object({
    dataReferencia: DEMANDA_MEDIA.pedido.shape.dataReferencia,
    janelaSemanas: z.number().int().min(JANELA_SEMANAS.MIN).max(JANELA_SEMANAS.MAX).optional(),
    perfilPorSabor: z.boolean().optional(),
  })
  .strict();

function validar(esquema, dados) {
  const r = esquema.safeParse(dados ?? {});
  if (!r.success) throw erro(400, `Parâmetros inválidos: ${r.error.issues.map((i) => `${i.path.join(".") || "dados"} ${i.message}`).join("; ")}`);
  return r.data;
}

export const inteligencia = {
  nome: "inteligencia",
  descricao:
    "Agente de Inteligência: indicadores de vendas, demanda média recente por sabor, média móvel de 4 semanas, variação e tendência recente (não previsão) e perfil por dia da semana.",
  tools: ["consultarVendasDiariasPorSabor", "consultarVendasPeriodo", "consultarCustosPeriodo"],
  async executar(contexto) {
    const { tipo, dados = {} } = contexto.entrada ?? {};
    switch (tipo) {
      case "ANALISAR_INTELIGENCIA":
        return analisarInteligencia(contexto, validar(parametrosAnalise, dados));
      case "DEMANDA_MEDIA":
        return calcularDemandaMedia(contexto, validar(DEMANDA_MEDIA.pedido, dados));
      case "PING":
        return { agente: "inteligencia", pong: true };
      case "DIAGNOSTICO": {
        const hoje = hojeCivilISO();
        const r = await contexto.usarTool("consultarVendasDiariasPorSabor", { dataInicio: deslocarDiaISO(hoje, -6), dataFim: hoje });
        const tools = { consultarVendasDiariasPorSabor: r.ok ? "ok" : r.erro.codigo };
        return { agente: "inteligencia", toolsOk: r.ok, tools };
      }
      case "PERGUNTA": {
        if (typeof dados.pergunta !== "string" || !dados.pergunta.trim()) throw erro(400, "PERGUNTA exige dados.pergunta");
        const r = await contexto.raciocinar({
          sistema: 'Você é o agente "inteligencia" do Doces da Maloca. Use apenas as tools disponíveis; todos os números vêm delas. Não faça previsões.',
          mensagens: [{ papel: "usuario", conteudo: dados.pergunta }],
        });
        return { agente: "inteligencia", resposta: r.texto, passos: r.passos, chamadas: r.chamadas };
      }
      default:
        throw erro(400, `Tipo de execução não suportado pelo agente inteligencia: "${tipo}"`);
    }
  },
};
