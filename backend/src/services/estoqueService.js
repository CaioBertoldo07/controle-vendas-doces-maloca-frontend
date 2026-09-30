/**
 * Estoque: produto acabado (derivado) e acesso ao saldo de insumos.
 *
 * Produto acabado: saldo = Σ produção − Σ vendas, por sabor, desde sempre.
 * KNOWN_BEHAVIOR: sem data de corte nem inventário; inclui sabores inativos e
 * datas futuras. A Etapa 0.2 recomendou reconciliação por contagem física
 * (Opção C), a implementar depois. Aqui só está a regra atual.
 */
import { prisma } from "../lib/prisma.js";

export { obterSaldoMateriaPrima, resumoMateriasPrimas } from "./materiaPrimaService.js";

/**
 * Saldo de produto acabado por sabor, com totais. Só aparecem sabores que
 * tiveram produção ou venda; ordem alfabética.
 */
export async function obterEstoqueAcabado() {
  const [producaoSabores, vendasSabores] = await Promise.all([
    prisma.producaoSabor.findMany({
      include: { sabor: { select: { id: true, nome: true } } },
    }),
    prisma.vendaSabor.findMany({
      include: { sabor: { select: { id: true, nome: true } } },
    }),
  ]);

  const porSabor = {};

  producaoSabores.forEach((ps) => {
    const { id, nome } = ps.sabor;
    if (!porSabor[id]) porSabor[id] = { id, nome, produzido: 0, vendido: 0 };
    porSabor[id].produzido += ps.quantidade;
  });

  vendasSabores.forEach((vs) => {
    const { id, nome } = vs.sabor;
    if (!porSabor[id]) porSabor[id] = { id, nome, produzido: 0, vendido: 0 };
    porSabor[id].vendido += vs.quantidade;
  });

  const itens = Object.values(porSabor)
    .map((s) => ({ ...s, saldo: s.produzido - s.vendido }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const totalProduzido = itens.reduce((s, i) => s + i.produzido, 0);
  const totalVendido = itens.reduce((s, i) => s + i.vendido, 0);
  const totalSaldo = totalProduzido - totalVendido;

  return { itens, totalProduzido, totalVendido, totalSaldo };
}
