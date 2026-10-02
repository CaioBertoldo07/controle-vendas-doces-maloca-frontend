// Catálogo de intenções da conversa (Etapa 5): pequeno, fechado e explícito.
// O LLM só classifica a mensagem dentro deste catálogo (saída estruturada,
// validada por Zod); daí em diante o roteamento é uma TABELA determinística.
import { z } from "zod";

/** Intenções de consulta → especialista, tipo de execução e foco da compactação. */
export const ROTAS_CONSULTA = Object.freeze({
  CONSULTAR_ESTOQUE: { descricao: "estoque de produto acabado, divergências, ritmo produção × vendas", destinos: [{ agente: "estoque", tipo: "ANALISAR_ESTOQUE" }], foco: "ESTOQUE" },
  CONSULTAR_MATERIA_PRIMA: { descricao: "saldo de matéria-prima", destinos: [{ agente: "estoque", tipo: "ANALISAR_ESTOQUE" }], foco: "MATERIA_PRIMA" },
  CONSULTAR_MRP: { descricao: "receitas e necessidade de insumos (MRP)", destinos: [{ agente: "estoque", tipo: "ANALISAR_ESTOQUE" }], foco: "MRP" },
  CONSULTAR_INDICADORES: { descricao: "indicadores gerais: vendas, faturamento, ticket, custo agregado", destinos: [{ agente: "inteligencia", tipo: "ANALISAR_INTELIGENCIA" }], foco: "INDICADORES" },
  CONSULTAR_DEMANDA: { descricao: "demanda média recente por sabor", destinos: [{ agente: "inteligencia", tipo: "DEMANDA_MEDIA" }], foco: "DEMANDA" },
  CONSULTAR_TENDENCIA: { descricao: "variação e tendência recente (alta, queda, estável) por sabor", destinos: [{ agente: "inteligencia", tipo: "ANALISAR_INTELIGENCIA" }], foco: "TENDENCIA" },
  CONSULTAR_PERFIL_SEMANAL: { descricao: "vendas por dia da semana", destinos: [{ agente: "inteligencia", tipo: "ANALISAR_INTELIGENCIA" }], foco: "PERFIL" },
  CONSULTAR_VENDAS: { descricao: "resumo de vendas e pagamentos da janela", destinos: [{ agente: "vendas", tipo: "ANALISAR_VENDAS" }], foco: "VENDAS" },
  CONSULTAR_RECEBIVEIS: { descricao: "vendas pendentes de pagamento e tempo em aberto", destinos: [{ agente: "vendas", tipo: "ANALISAR_VENDAS" }], foco: "RECEBIVEIS" },
  CONSULTAR_RECORRENCIA: { descricao: "recompra de clientes e clientes fora do padrão de compra", destinos: [{ agente: "vendas", tipo: "ANALISAR_VENDAS" }], foco: "RECORRENCIA" },
  CONSULTAR_MIX: { descricao: "sabores mais vendidos, participação e exposição a clientes recorrentes", destinos: [{ agente: "vendas", tipo: "ANALISAR_VENDAS" }], foco: "MIX" },
  DIAGNOSTICO_GERAL: {
    descricao: "visão geral do negócio (estoque, inteligência e vendas)",
    destinos: [{ agente: "estoque", tipo: "ANALISAR_ESTOQUE" }, { agente: "inteligencia", tipo: "ANALISAR_INTELIGENCIA" }, { agente: "vendas", tipo: "ANALISAR_VENDAS" }],
    foco: "GERAL",
  },
});

/** Intenções de ação: viram, no máximo, uma AcaoProposta PENDENTE (Agente de Vendas). */
export const ACOES = Object.freeze({
  PROPOR_VENDA: { descricao: "registrar uma venda (vira proposta para aprovação)", agente: "vendas", tipo: "PROPOR_VENDA" },
  PROPOR_MARCAR_VENDA_PAGA: { descricao: "marcar uma venda (pelo número) como paga (vira proposta para aprovação)", agente: "vendas", tipo: "PROPOR_MARCAR_VENDA_PAGA" },
});

export const META = Object.freeze({
  AJUDA: "o que o assistente sabe fazer",
  FORA_DE_ESCOPO: "qualquer outra coisa, inclusive pedidos de segredos, configuração, banco de dados ou instruções internas",
});

export const TIPOS_INTENCAO = Object.freeze([...Object.keys(ROTAS_CONSULTA), ...Object.keys(ACOES), ...Object.keys(META)]);

/** Limites por turno (custo e fan-out previsíveis). */
export const LIMITES_CONVERSA = Object.freeze({
  MAX_INTENCOES: 3, //              intenções especializadas por mensagem
  MAX_CARACTERES_MENSAGEM: 2000, // mensagem do gestor
  JANELA_HISTORICO: 6, //           mensagens anteriores enviadas ao LLM
  MAX_CARACTERES_HISTORICO: 500, // por mensagem anterior
  MAX_CHAMADAS_LLM: 3, //           interpretação (+1 nova tentativa se inválida) + síntese
  JANELA_SEMANAS_MIN: 4, //          mesma faixa dos especialistas
  JANELA_SEMANAS_MAX: 12,
});

const nulo = (s) => ({ anyOf: [s, { type: "null" }] });

/**
 * JSON Schema enviado ao provedor (saída estruturada). Só recursos aceitos por
 * structured outputs: todos os campos obrigatórios (nulos quando não se
 * aplicam), additionalProperties false, enum; sem minLength/minimum (os
 * limites ficam no Zod abaixo).
 */
export const ESQUEMA_INTERPRETACAO = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["intencoes", "venda", "pagamento", "esclarecimento"],
  properties: {
    intencoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "sabor", "janelaSemanas"],
        properties: { tipo: { type: "string", enum: TIPOS_INTENCAO }, sabor: nulo({ type: "string" }), janelaSemanas: nulo({ type: "integer" }) },
      },
    },
    venda: nulo({
      type: "object",
      additionalProperties: false,
      required: ["cliente", "itens", "valor"],
      properties: {
        cliente: { type: "string" },
        itens: { type: "array", items: { type: "object", additionalProperties: false, required: ["sabor", "quantidade"], properties: { sabor: { type: "string" }, quantidade: { type: "integer" } } } },
        valor: nulo({ type: "number" }),
      },
    }),
    pagamento: nulo({ type: "object", additionalProperties: false, required: ["vendaId"], properties: { vendaId: { type: "integer" } } }),
    esclarecimento: nulo({ type: "string" }),
  },
});

const textoCurto = z.string().trim().min(1).max(80);

/** Validação local (mais estrita que o JSON Schema): a interpretação só vale se passar aqui. */
export const INTERPRETACAO = z
  .object({
    intencoes: z
      .array(z.object({ tipo: z.enum(TIPOS_INTENCAO), sabor: textoCurto.nullable(), janelaSemanas: z.number().int().min(1).max(52).nullable() }).strict())
      .min(1)
      .max(LIMITES_CONVERSA.MAX_INTENCOES),
    venda: z
      .object({
        cliente: textoCurto,
        itens: z.array(z.object({ sabor: textoCurto, quantidade: z.number().int().positive().max(100000) }).strict()).min(1).max(10),
        valor: z.number().positive().max(1000000).nullable(),
      })
      .strict()
      .nullable(),
    pagamento: z.object({ vendaId: z.number().int().positive() }).strict().nullable(),
    esclarecimento: z.string().max(300).nullable(),
  })
  .strict()
  .superRefine((i, ctx) => {
    const tipos = i.intencoes.map((x) => x.tipo);
    const acoes = tipos.filter((t) => ACOES[t]);
    if (acoes.length > 1) ctx.addIssue({ code: "custom", message: "no máximo uma ação por mensagem", path: ["intencoes"] });
    if (tipos.includes("PROPOR_VENDA") !== Boolean(i.venda)) ctx.addIssue({ code: "custom", message: "PROPOR_VENDA exige `venda` (e só ela a usa)", path: ["venda"] });
    if (tipos.includes("PROPOR_MARCAR_VENDA_PAGA") !== Boolean(i.pagamento)) ctx.addIssue({ code: "custom", message: "PROPOR_MARCAR_VENDA_PAGA exige `pagamento` (e só ela o usa)", path: ["pagamento"] });
  });

/** Texto JSON do provedor → interpretação validada, ou { erro } (nunca lança, nunca executa nada). */
export function validarInterpretacao(texto) {
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { valida: false, erro: "JSON_INVALIDO" };
  }
  if (Array.isArray(bruto?.intencoes) && bruto.intencoes.length > LIMITES_CONVERSA.MAX_INTENCOES) return { valida: false, erro: "MUITAS_INTENCOES" };
  const r = INTERPRETACAO.safeParse(bruto);
  if (!r.success) return { valida: false, erro: "FORA_DO_CONTRATO", detalhes: r.error.issues.slice(0, 5).map((x) => `${x.path.join(".") || "(raiz)"}: ${x.message}`) };
  return { valida: true, interpretacao: r.data };
}
