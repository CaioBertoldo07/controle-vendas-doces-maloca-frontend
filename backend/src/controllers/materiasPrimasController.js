import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const listarMateriasPrimas = async (req, res) => {
  try {
    const { todos } = req.query;
    const where = todos === "true" ? {} : { ativo: true };
    const materias = await prisma.materiaPrima.findMany({
      where,
      orderBy: { nome: "asc" },
    });
    res.json(materias);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar matérias-primas" });
  }
};

export const criarMateriaPrima = async (req, res) => {
  try {
    const { nome, unidadeBase } = req.body;
    if (!nome?.trim())
      return res.status(400).json({ error: "Nome é obrigatório" });
    if (!unidadeBase?.trim())
      return res.status(400).json({ error: "Unidade base é obrigatória" });

    const existe = await prisma.materiaPrima.findFirst({
      where: { nome: { equals: nome.trim() } },
    });

    if (existe && existe.ativo) {
      return res
        .status(400)
        .json({ error: "Já existe uma matéria-prima com este nome" });
    }

    let mp;
    if (existe && !existe.ativo) {
      mp = await prisma.materiaPrima.update({
        where: { id: existe.id },
        data: { ativo: true, unidadeBase: unidadeBase.trim() },
      });
    } else {
      mp = await prisma.materiaPrima.create({
        data: { nome: nome.trim(), unidadeBase: unidadeBase.trim() },
      });
    }
    res.status(201).json(mp);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Erro ao criar matéria-prima: " + error.message });
  }
};

export const atualizarMateriaPrima = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, unidadeBase, ativo } = req.body;

    const existe = await prisma.materiaPrima.findUnique({
      where: { id: parseInt(id) },
    });
    if (!existe)
      return res.status(404).json({ error: "Matéria-prima não encontrada" });

    const data = {};
    if (nome !== undefined) data.nome = nome.trim();
    if (unidadeBase !== undefined) data.unidadeBase = unidadeBase.trim();
    if (ativo !== undefined) data.ativo = Boolean(ativo);

    const mp = await prisma.materiaPrima.update({
      where: { id: parseInt(id) },
      data,
    });
    res.json(mp);
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar matéria-prima" });
  }
};

export const deletarMateriaPrima = async (req, res) => {
  try {
    const { id } = req.params;
    const existe = await prisma.materiaPrima.findUnique({
      where: { id: parseInt(id) },
    });
    if (!existe)
      return res.status(404).json({ error: "Matéria-prima não encontrada" });

    await prisma.materiaPrima.update({
      where: { id: parseInt(id) },
      data: { ativo: false },
    });
    res.json({ message: "Matéria-prima desativada com sucesso" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao desativar matéria-prima" });
  }
};

export const resumoMateriasPrimas = async (req, res) => {
  try {
    const materias = await prisma.materiaPrima.findMany({
      where: { ativo: true },
      include: {
        movimentacoes: {
          select: { tipo: true, quantidade: true },
        },
      },
      orderBy: { nome: "asc" },
    });

    const resumo = materias.map((mp) => {
      let saldo = 0;
      mp.movimentacoes.forEach((mov) => {
        const q = parseFloat(mov.quantidade);
        if (mov.tipo === "ENTRADA") saldo += q;
        else if (mov.tipo === "SAIDA") saldo -= q;
        else if (mov.tipo === "AJUSTE") saldo += q;
      });
      return {
        id: mp.id,
        nome: mp.nome,
        unidadeBase: mp.unidadeBase,
        saldo: parseFloat(saldo.toFixed(3)),
        saldoBaixo: saldo > 0 && saldo < 200,
        saldoNegativo: saldo < 0,
      };
    });

    res.json(resumo);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Erro ao gerar resumo de matérias-primas" });
  }
};
