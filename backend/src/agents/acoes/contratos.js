// Contratos das ações que um agente pode PROPOR (Etapa 1). Allowlist fechada:
// cada tipo tem payload validado, verificação de referências (só leitura) e o
// executor determinístico, que chama o service já testado. O executor nunca é
// exposto ao LLM: só roda depois da aprovação do gestor (servicoAcoes.js).
// Etapa 6: `executar(payload, tx)` recebe o cliente da TRANSAÇÃO do executor:
// o efeito de domínio e o status EXECUTADA confirmam (ou desfazem) juntos.
import { z } from "zod";
import { erro } from "../../lib/erros.js";
import * as clientesService from "../../services/clientesService.js";
import * as producaoService from "../../services/producaoService.js";
import * as saboresService from "../../services/saboresService.js";
import * as vendasService from "../../services/vendasService.js";
import { dataHoraCivil, idPositivo, itemSabor, numero } from "../tools/formato.js";

/** Sabores precisam existir e estar ativos para entrar numa proposta. */
async function verificarSabores(sabores) {
  for (const { saborId } of sabores) {
    const sabor = await saboresService.buscarSabor(saborId);
    if (!sabor.ativo) throw erro(409, `Sabor inativo: "${sabor.nome}" (id ${saborId})`);
  }
}

export const CONTRATOS = Object.freeze({
  /**
   * Cliente e sabores identificados por id (nunca por nome: a resolução por
   * texto e a desambiguação acontecem antes, com o gestor). `valor` vem do que
   * o gestor informou (KNOWN_BEHAVIOR K7: não é calculado pelo preço).
   */
  REGISTRAR_VENDA: {
    payload: z
      .object({
        clienteId: idPositivo,
        sabores: z.array(itemSabor).min(1).max(30),
        valor: z.number().positive(),
        desconto: z.number().min(0).optional(),
        data: dataHoraCivil.optional(),
        pago: z.boolean().optional(),
      })
      .strict(),
    async verificar(p) {
      await clientesService.buscarCliente(p.clienteId); // 404 se não existe
      await verificarSabores(p.sabores);
    },
    async executar(p, tx) {
      const quantidade = p.sabores.reduce((s, i) => s + i.quantidade, 0);
      const venda = await vendasService.criarVenda({ ...p, quantidade }, tx);
      return { vendaId: venda.id, quantidade: venda.quantidade, valor: numero(venda.valor) };
    },
  },

  REGISTRAR_PRODUCAO: {
    payload: z
      .object({
        sabores: z.array(itemSabor).min(1).max(30),
        data: dataHoraCivil.optional(),
        observacao: z.string().max(255).optional(),
      })
      .strict(),
    async verificar(p) {
      await verificarSabores(p.sabores);
    },
    async executar(p, tx) {
      const producao = await producaoService.criarProducao(p, tx); // 422 se faltar insumo
      return { producaoId: producao.id };
    },
  },

  MARCAR_VENDA_PAGA: {
    payload: z.object({ vendaId: idPositivo, dataPagamento: dataHoraCivil.optional() }).strict(),
    async verificar(p) {
      const venda = await vendasService.buscarVenda(p.vendaId); // 404 se não existe
      if (venda.pago) throw erro(409, `Venda ${p.vendaId} já está paga`);
    },
    async executar(p, tx) {
      const antes = await vendasService.buscarVenda(p.vendaId, tx);
      const venda = await vendasService.atualizarPagamento(p.vendaId, { pago: true, dataPagamento: p.dataPagamento }, tx);
      return { vendaId: venda.id, jaEstavaPaga: antes.pago };
    },
  },
});

export const TIPOS_ACAO = Object.freeze(Object.keys(CONTRATOS));
