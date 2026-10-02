// Contrato de cooperação Estoque → Vendas: EXPOSICAO_CLIENTES_POR_SABOR (Etapa 4).
//
//   contexto.enviarMensagem({ para: "vendas", tipo: "EXPOSICAO_CLIENTES_POR_SABOR", dados: <pedido> })
//   → <resposta>
//
// Semântica: "estes sabores tiveram, nas semanas completas recentes, compras de
// clientes que historicamente apresentam recompra". Só fatos observados: não
// diz que esses clientes vão comprar de novo. Resposta AGREGADA (contagens e
// participação), sem nomes nem ids de clientes: protege a privacidade e
// mantém a MensagemAgente pequena (limite de auditoria de 8 KB).
import { z } from "zod";
import { idPositivo } from "../tools/formato.js";
import { JANELA_SEMANAS, diaExistente } from "./demandaMedia.js";

const periodo = z.object({ dataInicio: z.string(), dataFim: z.string() }).strict();
const contagem = z.number().int().min(0);

export const EXPOSICAO_CLIENTES = Object.freeze({
  tipo: "EXPOSICAO_CLIENTES_POR_SABOR",
  de: "estoque",
  para: "vendas",
  pedido: z
    .object({
      dataReferencia: diaExistente.optional(), // padrão: hoje em Manaus
      janelaSemanas: z.number().int().min(JANELA_SEMANAS.MIN).max(JANELA_SEMANAS.MAX).optional(),
      saborIds: z.array(idPositivo).min(1).max(50),
    })
    .strict(),
  resposta: z
    .object({
      dataReferencia: z.string(),
      metodologia: z
        .object({
          tipo: z.literal("EXPOSICAO_HISTORICA_RECENTE"),
          janelaSemanas: z.number().int(),
          semana: z.literal("DOMINGO_A_SABADO"),
          periodo,
          semanaParcialExcluida: periodo,
          criterioRecorrencia: z.string(),
          observacao: z.string(),
        })
        .strict(),
      sabores: z.array(
        z
          .object({
            saborId: idPositivo,
            sabor: z.string(),
            qualidade: z.enum(["COM_VENDAS_NA_JANELA", "SEM_VENDAS_NA_JANELA"]),
            unidadesRecentes: contagem,
            clientesComCompraRecente: contagem,
            clientesRecorrentes: contagem,
            clientesSemHistoricoSuficiente: contagem,
            unidadesDeClientesRecorrentes: contagem,
            participacaoClientesRecorrentes: z.number().min(0).max(100).nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
});
