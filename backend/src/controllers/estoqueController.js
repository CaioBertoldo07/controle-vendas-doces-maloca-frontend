import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const listarEstoque = async (req, res) => {
  try {
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

    res.json({ itens, totalProduzido, totalVendido, totalSaldo });
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar estoque" });
  }
};
