// Contrato de cooperação Estoque → Inteligência (preparado na Etapa 2, usado na
// Etapa 3). Só o formato: o Agente de Inteligência ainda é stub e NÃO responde
// a DEMANDA_MEDIA. O Agente de Estoque não envia esta mensagem nesta etapa.
//
//   contexto.enviarMensagem({ para: "inteligencia", tipo: "DEMANDA_MEDIA", dados: <pedido> })
//   → <resposta>
//
// Método previsto: média simples do histórico recente (sem previsão
// estatística), calculada deterministicamente pelo Agente de Inteligência.
import { z } from "zod";
import { diaCivil, idPositivo } from "../tools/formato.js";

export const DEMANDA_MEDIA = Object.freeze({
  tipo: "DEMANDA_MEDIA",
  de: "estoque",
  para: "inteligencia",
  pedido: z
    .object({
      dataReferencia: diaCivil,
      janelaDias: z.number().int().min(7).max(90),
      saborIds: z.array(idPositivo).min(1).optional(),
    })
    .strict(),
  resposta: z
    .object({
      dataReferencia: diaCivil,
      janelaDias: z.number().int(),
      metodo: z.literal("MEDIA_SIMPLES_HISTORICA"),
      sabores: z.array(
        z
          .object({
            saborId: idPositivo,
            sabor: z.string(),
            unidadesVendidas: z.number().int().min(0),
            diasComVenda: z.number().int().min(0),
            mediaDiaria: z.number().min(0),
          })
          .strict(),
      ),
    })
    .strict(),
});
