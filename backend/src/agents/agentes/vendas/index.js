// Agente de Vendas (Etapa 4): terceiro agente funcional. Indicadores,
// recebíveis (tempo em aberto, nunca atraso), recorrência de clientes, mix e
// exposição de clientes por sabor; tudo determinístico, sem LLM, só por tools.
// Escreve apenas pela infraestrutura SMA: recomendações agregadas e
// propostas PENDENTES (nunca aprova, nunca executa, nunca marca pagamento).
//
//   ANALISAR_VENDAS               → diagnóstico            { dataReferencia?, janelaSemanas? }
//   EXPOSICAO_CLIENTES_POR_SABOR  → contrato com o Estoque (contratos/exposicaoClientes.js)
//   PROPOR_VENDA                  → AcaoProposta REGISTRAR_VENDA PENDENTE  { clienteId, sabores, valor, desconto?, data?, pago?, descricao? }
//   PROPOR_MARCAR_VENDA_PAGA      → AcaoProposta MARCAR_VENDA_PAGA PENDENTE { vendaId, dataPagamento?, descricao? }
//   DIAGNOSTICO / PING / PERGUNTA → verificação técnica / resposta imediata / LLM (só testes)
//
// As propostas recebem IDS explícitos: não há resolução de nomes nem leitura
// de texto livre aqui (isso é do Atendimento, numa etapa futura).
import { z } from "zod";
import { erro } from "../../../lib/erros.js";
import { hojeCivilISO } from "../../../lib/periodos.js";
import { JANELA_SEMANAS, diaExistente } from "../../contratos/demandaMedia.js";
import { EXPOSICAO_CLIENTES } from "../../contratos/exposicaoClientes.js";
import { analisarVendas, calcularExposicao, proporPagamento, proporVenda } from "./analise.js";

const parametrosAnalise = z
  .object({ dataReferencia: diaExistente.optional(), janelaSemanas: z.number().int().min(JANELA_SEMANAS.MIN).max(JANELA_SEMANAS.MAX).optional() })
  .strict();
// O payload da ação é validado pelo contrato da ação (tool proporAcao); aqui só o envelope.
const envelopeProposta = z.object({ descricao: z.string().min(5).max(500).optional() }).passthrough();

function validar(esquema, dados) {
  const r = esquema.safeParse(dados ?? {});
  if (!r.success) throw erro(400, `Parâmetros inválidos: ${r.error.issues.map((i) => `${i.path.join(".") || "dados"} ${i.message}`).join("; ")}`);
  return r.data;
}

export const vendas = {
  nome: "vendas",
  descricao:
    "Agente de Vendas: indicadores, recebíveis por tempo em aberto (sem vencimento), recorrência de clientes, mix e exposição de clientes por sabor; propõe vendas e pagamentos para aprovação.",
  tools: ["consultarVendasPeriodo", "consultarVendasDiariasPorSabor", "consultarRecebiveis", "consultarComprasClientes", "consultarUnidadesClienteSabor", "proporAcao"],
  async executar(contexto) {
    const { tipo, dados = {} } = contexto.entrada ?? {};
    switch (tipo) {
      case "ANALISAR_VENDAS":
        return analisarVendas(contexto, validar(parametrosAnalise, dados));
      case "EXPOSICAO_CLIENTES_POR_SABOR":
        return calcularExposicao(contexto, validar(EXPOSICAO_CLIENTES.pedido, dados));
      case "PROPOR_VENDA":
        return proporVenda(contexto, validar(envelopeProposta, dados));
      case "PROPOR_MARCAR_VENDA_PAGA":
        return proporPagamento(contexto, validar(envelopeProposta, dados));
      case "PING":
        return { agente: "vendas", pong: true };
      case "DIAGNOSTICO": {
        const tools = {};
        for (const [tool, entrada] of [["consultarRecebiveis", { limite: 1 }], ["consultarComprasClientes", { dataFim: hojeCivilISO() }]]) {
          const r = await contexto.usarTool(tool, entrada);
          tools[tool] = r.ok ? "ok" : r.erro.codigo;
        }
        return { agente: "vendas", toolsOk: Object.values(tools).every((v) => v === "ok"), tools };
      }
      case "PERGUNTA": {
        if (typeof dados.pergunta !== "string" || !dados.pergunta.trim()) throw erro(400, "PERGUNTA exige dados.pergunta");
        const r = await contexto.raciocinar({
          sistema: 'Você é o agente "vendas" do Doces da Maloca. Use apenas as tools disponíveis; todos os números vêm delas. Não preveja compras nem chame clientes de inadimplentes.',
          mensagens: [{ papel: "usuario", conteudo: dados.pergunta }],
        });
        return { agente: "vendas", resposta: r.texto, passos: r.passos, chamadas: r.chamadas };
      }
      default:
        throw erro(400, `Tipo de execução não suportado pelo agente vendas: "${tipo}"`);
    }
  },
};
