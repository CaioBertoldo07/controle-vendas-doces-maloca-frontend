import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const listarSabores = async (req, res) => {
  try {
    const { todos } = req.query;
    const where = todos === "true" ? {} : { ativo: true };

    const sabores = await prisma.sabor.findMany({
      where,
      orderBy: { nome: "asc" },
      include: {
        _count: { select: { vendaSabores: true } },
      },
    });
    res.json(sabores);
  } catch (error) {
    console.error("Erro ao listar sabores:", error);
    res.status(500).json({ error: "Erro ao buscar sabores" });
  }
};

export const buscarSabor = async (req, res) => {
  try {
    const { id } = req.params;
    const sabor = await prisma.sabor.findUnique({
      where: { id: parseInt(id) },
      include: {
        _count: { select: { vendaSabores: true } },
      },
    });

    if (!sabor) return res.status(404).json({ error: "Sabor não encontrado" });

    res.json(sabor);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar sabor" });
  }
};

export const criarSabor = async (req, res) => {
  try {
    const { nome, precoUnitario } = req.body;

    if (!nome || nome.trim() === "") {
      return res.status(400).json({ error: "Nome do sabor é obrigatório" });
    }

    if (
      !precoUnitario ||
      isNaN(precoUnitario) ||
      parseFloat(precoUnitario) <= 0
    ) {
      return res.status(400).json({ error: "Preço unitário inválido" });
    }

    const existe = await prisma.sabor.findFirst({
      where: { nome: { equals: nome.trim() } },
    });

    if (existe) {
      return res
        .status(400)
        .json({ error: "Já existe um sabor com este nome" });
    }

    const sabor = await prisma.sabor.create({
      data: {
        nome: nome.trim(),
        precoUnitario: parseFloat(precoUnitario),
        ativo: true,
      },
    });

    console.log("✅ Sabor criado:", sabor);
    res.status(201).json(sabor);
  } catch (error) {
    console.error("❌ Erro ao criar sabor:", error);
    res.status(500).json({ error: "Erro ao criar sabor: " + error.message });
  }
};

export const atualizarSabor = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, precoUnitario, ativo } = req.body;

    const existe = await prisma.sabor.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existe) return res.status(404).json({ error: "Sabor não encontrado" });

    const data = {};
    if (nome !== undefined) data.nome = nome.trim();
    if (precoUnitario !== undefined)
      data.precoUnitario = parseFloat(precoUnitario);
    if (ativo !== undefined) data.ativo = Boolean(ativo);

    const sabor = await prisma.sabor.update({
      where: { id: parseInt(id) },
      data,
    });

    console.log("✅ Sabor atualizado:", sabor);
    res.json(sabor);
  } catch (error) {
    console.error("❌ Erro ao atualizar sabor:", error);
    res
      .status(500)
      .json({ error: "Erro ao atualizar sabor: " + error.message });
  }
};

export const deletarSabor = async (req, res) => {
  try {
    const { id } = req.params;

    const sabor = await prisma.sabor.findUnique({
      where: { id: parseInt(id) },
      include: { _count: { select: { vendaSabores: true } } },
    });

    if (!sabor) return res.status(404).json({ error: "Sabor não encontrado" });

    if (sabor._count.vendaSabores > 0) {
      const atualizado = await prisma.sabor.update({
        where: { id: parseInt(id) },
        data: { ativo: false },
      });
      return res.json({
        message: "Sabor desativado pois possui vendas vinculadas",
        sabor: atualizado,
        desativado: true,
      });
    }

    await prisma.sabor.delete({ where: { id: parseInt(id) } });
    res.json({ message: "Sabor deletado com sucesso" });
  } catch (error) {
    console.error("❌ Erro ao deletar sabor:", error);
    res.status(500).json({ error: "Erro ao deletar sabor: " + error.message });
  }
};
