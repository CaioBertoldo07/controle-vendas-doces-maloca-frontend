import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const listarSabores = async (req, res) => {
  try {
    const sabores = await prisma.sabor.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
    });
    res.json(sabores);
  } catch (error) {
    console.error("Erro ao listar sabores:", error);
    res.status(500).json({ error: "Erro ao buscar sabores" });
  }
};
