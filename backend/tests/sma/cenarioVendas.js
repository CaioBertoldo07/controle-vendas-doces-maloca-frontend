// Etapa 4 — cenário acadêmico de Vendas e da cooperação entre três especialistas
// (docs/tcc/etapa-4-agente-vendas.md §20). Sintético, reprodutível, 100% fictício.
//
// Referência: quarta 30/09/2026. Janela canônica (4 semanas completas): 30/08–26/09.
//
//   Cliente A (Mercearia): Tradicional 10 un. a cada 10 dias (06/08, 16/08, 26/08, 05/09);
//                          última há 25 dias > 2 × 10 → FORA_DO_PADRAO_HISTORICO
//   Cliente B (Quiosque):  Maracujá 15 un. em 08/09 e 22/09 → só 2 compras: DADOS_INSUFICIENTES
//   Cliente C (Padaria):   Tradicional 20 un. toda segunda (03/08 … 21/09) + Maracujá 5 un. em 14/09
//                          (mesmo dia de uma compra: uma ocasião só) → DENTRO_DO_PADRAO
//   Cliente D (Lanchonete): Maracujá 10 un. em 15/09 (1 compra)
//
//   Tradicional: 90 un. na janela, 100% de clientes recorrentes (A e C) → alta exposição
//                produção 40 na janela (10/sem) × demanda 22,5/sem → PRODUCAO_ABAIXO_DA_DEMANDA
//                saldo histórico 180 − 200 = −20 → SALDO_NEGATIVO
//   Maracujá:    45 un. na janela, 5 de recorrentes (11,1%) → baixa exposição;
//                primeira venda 08/09 → DADOS_INSUFICIENTES na demanda; saldo 0
//
//   Pendentes (todo o resto pago): A 06/08 (55 dias, antes de 14/08), B 08/09 (22 dias), C 21/09 (9 dias)
import { criarCliente, criarProducao, criarSabor, criarVenda } from "../caracterizacao/helpers/fixtures.js";

export const REF = "2026-09-30";
const em = (dia) => new Date(`${dia}T12:00:00.000Z`); // relógio de Manaus
const SEGUNDAS = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"];

export async function cenarioVendas() {
  const a = await criarCliente("Mercearia Fictícia Aurora");
  const b = await criarCliente("Quiosque Fictício Boreal");
  const c = await criarCliente("Padaria Fictícia Cometa");
  const d = await criarCliente("Lanchonete Fictícia Delta");
  const tradicional = await criarSabor({ nome: "Tradicional" });
  const maracuja = await criarSabor({ nome: "Maracujá" });
  const vender = (cliente, sabor, quantidade, dia, pago = true) => criarVenda({ clienteId: cliente.id, itens: [{ saborId: sabor.id, quantidade }], data: em(dia), pago });

  const pendentes = {};
  for (const dia of ["2026-08-06", "2026-08-16", "2026-08-26", "2026-09-05"]) {
    const v = await vender(a, tradicional, 10, dia, dia !== "2026-08-06");
    if (dia === "2026-08-06") pendentes.a = v;
  }
  for (const dia of SEGUNDAS) {
    const v = await vender(c, tradicional, 20, dia, dia !== "2026-09-21");
    if (dia === "2026-09-21") pendentes.c = v;
  }
  await vender(c, maracuja, 5, "2026-09-14"); // 2ª venda no mesmo dia: mesma ocasião de compra
  pendentes.b = await vender(b, maracuja, 15, "2026-09-08", false);
  await vender(b, maracuja, 15, "2026-09-22");
  await vender(d, maracuja, 10, "2026-09-15");

  await criarProducao({ itens: [{ saborId: tradicional.id, quantidade: 140 }], data: em("2026-08-02") });
  for (const dia of ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"]) await criarProducao({ itens: [{ saborId: tradicional.id, quantidade: 10 }], data: em(dia) });
  await criarProducao({ itens: [{ saborId: maracuja.id, quantidade: 45 }], data: em("2026-09-07") });
  return { clientes: { a, b, c, d }, tradicional, maracuja, pendentes };
}
