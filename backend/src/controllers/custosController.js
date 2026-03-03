import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const listarCustos = async (req, res) => {
  try {
    const { mes, ano, categoria } = req.query;
    let where = {};

    if (mes && ano) {
      const startDate = new Date(ano, mes - 1, 1);
      const endDate = new Date(ano, mes, 0, 23, 59, 59);
      where.data = { gte: startDate, lte: endDate };
    }
    if (categoria) where.categoria = categoria;

    const custos = await prisma.custo.findMany({
      where,
      orderBy: { data: "desc" },
    });
    res.json(custos);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar custos" });
  }
};

export const criarCusto = async (req, res) => {
  try {
    const {
      nome,
      categoria,
      quantidade,
      unidade,
      valorTotal,
      data,
      observacao,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ error: "Nome é obrigatório" });
    if (!quantidade || parseFloat(quantidade) <= 0)
      return res.status(400).json({ error: "Quantidade inválida" });
    if (!unidade?.trim())
      return res.status(400).json({ error: "Unidade é obrigatória" });
    if (!valorTotal || parseFloat(valorTotal) <= 0)
      return res.status(400).json({ error: "Valor inválido" });

    const custo = await prisma.custo.create({
      data: {
        nome: nome.trim(),
        categoria: categoria || "Matéria Prima",
        quantidade: parseFloat(quantidade),
        unidade: unidade.trim(),
        valorTotal: parseFloat(valorTotal),
        data: data ? new Date(data) : new Date(),
        observacao: observacao?.trim() || null,
      },
    });
    res.status(201).json(custo);
  } catch (error) {
    res.status(500).json({ error: "Erro ao criar custo: " + error.message });
  }
};

export const atualizarCusto = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome,
      categoria,
      quantidade,
      unidade,
      valorTotal,
      data,
      observacao,
    } = req.body;

    const existe = await prisma.custo.findUnique({
      where: { id: parseInt(id) },
    });
    if (!existe) return res.status(404).json({ error: "Custo não encontrado" });

    const custo = await prisma.custo.update({
      where: { id: parseInt(id) },
      data: {
        ...(nome && { nome: nome.trim() }),
        ...(categoria && { categoria }),
        ...(quantidade && { quantidade: parseFloat(quantidade) }),
        ...(unidade && { unidade: unidade.trim() }),
        ...(valorTotal && { valorTotal: parseFloat(valorTotal) }),
        ...(data && { data: new Date(data) }),
        ...(observacao !== undefined && {
          observacao: observacao?.trim() || null,
        }),
      },
    });
    res.json(custo);
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar custo" });
  }
};

export const deletarCusto = async (req, res) => {
  try {
    const { id } = req.params;
    const existe = await prisma.custo.findUnique({
      where: { id: parseInt(id) },
    });
    if (!existe) return res.status(404).json({ error: "Custo não encontrado" });
    await prisma.custo.delete({ where: { id: parseInt(id) } });
    res.json({ message: "Custo deletado com sucesso" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao deletar custo" });
  }
};

export const resumoCustos = async (req, res) => {
  try {
    const { mes, ano } = req.query;
    const anoAtual = ano ? parseInt(ano) : new Date().getFullYear();
    const mesAtual = mes ? parseInt(mes) : new Date().getMonth() + 1;

    const startDate = new Date(anoAtual, mesAtual - 1, 1);
    const endDate = new Date(anoAtual, mesAtual, 0, 23, 59, 59);

    const custos = await prisma.custo.findMany({
      where: { data: { gte: startDate, lte: endDate } },
    });

    const totalGeral = custos.reduce(
      (sum, c) => sum + parseFloat(c.valorTotal),
      0,
    );
    const porCategoria = custos.reduce((acc, c) => {
      acc[c.categoria] = (acc[c.categoria] || 0) + parseFloat(c.valorTotal);
      return acc;
    }, {});

    // Resumo dos 12 meses
    const meses = [];
    for (let m = 1; m <= 12; m++) {
      const s = new Date(anoAtual, m - 1, 1);
      const e = new Date(anoAtual, m, 0, 23, 59, 59);
      const cm = await prisma.custo.findMany({
        where: { data: { gte: s, lte: e } },
      });
      const total = cm.reduce((sum, c) => sum + parseFloat(c.valorTotal), 0);
      meses.push({
        mes: m,
        nomeMes: s.toLocaleString("pt-BR", { month: "long" }),
        total: total.toFixed(2),
        quantidade: cm.length,
      });
    }

    res.json({
      totalGeral: totalGeral.toFixed(2),
      totalItens: custos.length,
      porCategoria,
      meses,
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao gerar resumo" });
  }
};
