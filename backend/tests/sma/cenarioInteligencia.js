// Etapa 3 — cenário acadêmico multiagente, sintético e reprodutível
// (docs/tcc/etapa-3-agente-inteligencia.md §17). Dados 100% fictícios.
//
// Referência: quarta 30/09/2026. Semanas completas (domingo a sábado):
//   anteriores 02/08–29/08 · recentes 30/08–26/09 · parcial 27/09–30/09.
//
//   Tradicional: vendas 20/semana → 30/semana (80 → 120, +50%)
//                produção 40/semana → 20/semana; saldo histórico −20
//   Maracujá:    vendas 25/semana → 20/semana (100 → 80, −20%)
//                produção 25/semana → 20/semana; saldo histórico 0
// Os dois já vendiam em julho (15/07): as 8 semanas são observadas por inteiro.
// Produção às terças: alinhada às semanas e também à janela de 30 dias do Estoque.
// Venda de 50 Tradicional na semana parcial (28/09): fora de toda média.
import { prisma } from "../caracterizacao/helpers/db.js";
import { criarCliente, criarProducao, criarSabor, criarVenda } from "../caracterizacao/helpers/fixtures.js";

export const REF = "2026-09-30";
export const SEMANAS = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20"];
const dia = (domingo, deslocamento, h = 12) => {
  const d = new Date(`${domingo}T${String(h).padStart(2, "0")}:00:00.000Z`); // relógio de Manaus
  d.setUTCDate(d.getUTCDate() + deslocamento);
  return d;
};

export async function cenarioMultiagente() {
  const cliente = await criarCliente("Mercearia Fictícia Aurora");
  const outro = await criarCliente("Padaria Fictícia Boreal");
  const tradicional = await criarSabor({ nome: "Tradicional" });
  const maracuja = await criarSabor({ nome: "Maracujá" });
  const vender = (c, saborId, quantidade, data, pago = false) => criarVenda({ clienteId: c.id, itens: [{ saborId, quantidade }], data, pago });

  await vender(cliente, tradicional.id, 10, new Date("2026-07-15T12:00:00Z"), true);
  await vender(outro, maracuja.id, 10, new Date("2026-07-15T12:00:00Z"), true);
  await criarProducao({ itens: [{ saborId: maracuja.id, quantidade: 10 }], data: new Date("2026-07-14T12:00:00Z") });

  for (const [i, domingo] of SEMANAS.entries()) {
    const recente = i >= 4;
    const t = recente ? 15 : 10; // segunda + sexta
    await vender(cliente, tradicional.id, t, dia(domingo, 1), true);
    await vender(outro, tradicional.id, t, dia(domingo, 5), i < 6);
    await vender(outro, maracuja.id, recente ? 20 : 25, dia(domingo, 2), true); // terça
    await criarProducao({ itens: [{ saborId: tradicional.id, quantidade: recente ? 20 : 40 }, { saborId: maracuja.id, quantidade: recente ? 20 : 25 }], data: dia(domingo, 2, 8) }); // terça cedo
  }
  await vender(cliente, tradicional.id, 50, new Date("2026-09-28T12:00:00Z")); // semana parcial
  return { cliente, outro, tradicional, maracuja };
}

/** Contagem das tabelas de domínio (prova de que a análise não escreve nada). */
export const contagemDominio = () =>
  Promise.all([prisma.venda.count(), prisma.producao.count(), prisma.custo.count(), prisma.movimentacaoMateriaPrima.count(), prisma.sabor.count(), prisma.acaoProposta.count()]);
