// Contrato de cooperação Estoque → Inteligência: DEMANDA_MEDIA (preparado na
// Etapa 2, formalizado e em uso desde a Etapa 3).
//
//   contexto.enviarMensagem({ para: "inteligencia", tipo: "DEMANDA_MEDIA", dados: <pedido> })
//   → <resposta>
//
// Os dois lados validam: a Inteligência rejeita pedido inválido (400) e o
// Estoque descarta resposta fora do contrato (modo degradado). Método: média
// histórica RECENTE de semanas completas (domingo a sábado, Manaus); não é
// previsão. Sabor sem todas as semanas observadas não recebe média.
import { z } from "zod";
import { diaCivilISO, lerDataCivil } from "../../lib/periodos.js";
import { diaCivil, idPositivo } from "../tools/formato.js";

/** Janela em semanas completas: 4 é o padrão (e o mínimo, igual à média móvel de 4 semanas); 12 ≈ um trimestre. */
export const JANELA_SEMANAS = Object.freeze({ PADRAO: 4, MIN: 4, MAX: 12 });

const QUALIDADE = ["SUFICIENTE", "DADOS_INSUFICIENTES", "SEM_HISTORICO"];
// O Zod 4 roda o refine mesmo quando o regex já falhou: a data inválida não pode lançar.
const existe = (d) => {
  const data = lerDataCivil(d);
  return Number.isFinite(data.getTime()) && diaCivilISO(data) === d;
};
const diaExistente = diaCivil.refine(existe, "dia inexistente no calendário");
const periodo = z.object({ dataInicio: diaCivil, dataFim: diaCivil }).strict();
const nulo = (s) => s.nullable();

export const DEMANDA_MEDIA = Object.freeze({
  tipo: "DEMANDA_MEDIA",
  de: "estoque",
  para: "inteligencia",
  pedido: z
    .object({
      dataReferencia: diaExistente.optional(), // padrão: hoje em Manaus
      janelaSemanas: z.number().int().min(JANELA_SEMANAS.MIN).max(JANELA_SEMANAS.MAX).optional(),
      saborIds: z.array(idPositivo).min(1).max(50).optional(), // padrão: sabores ativos
    })
    .strict(),
  resposta: z
    .object({
      dataReferencia: diaCivil,
      metodologia: z
        .object({
          tipo: z.literal("MEDIA_HISTORICA_RECENTE"),
          janelaSemanas: z.number().int().min(JANELA_SEMANAS.MIN).max(JANELA_SEMANAS.MAX),
          unidade: z.literal("UNIDADES_POR_SEMANA"),
          semana: z.literal("DOMINGO_A_SABADO"),
          periodo,
          semanaParcialExcluida: periodo,
          criterioSuficiencia: z.string(),
          observacao: z.string(),
        })
        .strict(),
      sabores: z.array(
        z
          .object({
            saborId: idPositivo,
            sabor: z.string(),
            qualidade: z.enum(QUALIDADE),
            primeiraVenda: nulo(z.string()),
            semanasObservadas: z.number().int().min(0),
            unidadesVendidas: z.number().int().min(0),
            diasComVenda: z.number().int().min(0),
            mediaSemanal: nulo(z.number().min(0)),
            mediaDiaria: nulo(z.number().min(0)),
          })
          .strict()
          .refine((s) => (s.qualidade === "SUFICIENTE") === (s.mediaSemanal !== null), "só SUFICIENTE tem média"),
      ),
    })
    .strict(),
});
