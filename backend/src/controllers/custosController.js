import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Converte quantidade da unidade informada para a unidade base da matéria-prima
function converterParaBase(quantidade, unidade, unidadeBase) {
  const q = parseFloat(quantidade);
  if (unidade === "kg" && unidadeBase === "g") return q * 1000;
  if (unidade === "L" && unidadeBase === "ml") return q * 1000;
  return q;
}

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
      include: { materiaPrima: { select: { id: true, nome: true, unidadeBase: true } } },
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
      materiaPrimaId,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ error: "Nome é obrigatório" });
    if (!quantidade || parseFloat(quantidade) <= 0)
      return res.status(400).json({ error: "Quantidade inválida" });
    if (!unidade?.trim())
      return res.status(400).json({ error: "Unidade é obrigatória" });
    if (!valorTotal || parseFloat(valorTotal) <= 0)
      return res.status(400).json({ error: "Valor inválido" });

    const mpId = materiaPrimaId ? parseInt(materiaPrimaId) : null;

    // Validar matéria-prima se informada
    let mp = null;
    if (mpId) {
      mp = await prisma.materiaPrima.findUnique({ where: { id: mpId } });
      if (!mp) return res.status(400).json({ error: "Matéria-prima não encontrada" });
    }

    const custo = await prisma.$transaction(async (tx) => {
      const c = await tx.custo.create({
        data: {
          nome: nome.trim(),
          categoria: categoria || "Matéria Prima",
          quantidade: parseFloat(quantidade),
          unidade: unidade.trim(),
          valorTotal: parseFloat(valorTotal),
          data: data ? new Date(data) : new Date(),
          observacao: observacao?.trim() || null,
          materiaPrimaId: mpId,
        },
      });

      // Gerar movimentação de entrada se vinculado a uma matéria-prima
      if (mpId && mp) {
        const qtdBase = converterParaBase(quantidade, unidade, mp.unidadeBase);
        await tx.movimentacaoMateriaPrima.create({
          data: {
            materiaPrimaId: mpId,
            tipo: "ENTRADA",
            origem: "CUSTO",
            quantidade: qtdBase,
            custoId: c.id,
            data: data ? new Date(data) : new Date(),
            observacao: `Compra: ${nome.trim()}`,
          },
        });
      }

      return c;
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
      materiaPrimaId,
    } = req.body;

    const existe = await prisma.custo.findUnique({
      where: { id: parseInt(id) },
      include: { materiaPrima: { select: { unidadeBase: true } } },
    });
    if (!existe) return res.status(404).json({ error: "Custo não encontrado" });

    const mpId = materiaPrimaId !== undefined
      ? (materiaPrimaId ? parseInt(materiaPrimaId) : null)
      : existe.materiaPrimaId;

    let mp = null;
    if (mpId) {
      mp = await prisma.materiaPrima.findUnique({ where: { id: mpId } });
      if (!mp) return res.status(400).json({ error: "Matéria-prima não encontrada" });
    }

    const novaQtd = quantidade !== undefined ? parseFloat(quantidade) : parseFloat(existe.quantidade);
    const novaUnidade = unidade !== undefined ? unidade.trim() : existe.unidade;
    const novaData = data !== undefined ? new Date(data) : existe.data;

    const custo = await prisma.$transaction(async (tx) => {
      // Remover movimentação anterior vinculada a este custo
      await tx.movimentacaoMateriaPrima.deleteMany({ where: { custoId: parseInt(id) } });

      const c = await tx.custo.update({
        where: { id: parseInt(id) },
        data: {
          ...(nome && { nome: nome.trim() }),
          ...(categoria && { categoria }),
          ...(quantidade && { quantidade: parseFloat(quantidade) }),
          ...(unidade && { unidade: unidade.trim() }),
          ...(valorTotal && { valorTotal: parseFloat(valorTotal) }),
          ...(data && { data: new Date(data) }),
          ...(observacao !== undefined && { observacao: observacao?.trim() || null }),
          materiaPrimaId: mpId,
        },
      });

      // Recriar movimentação se vinculado a matéria-prima
      if (mpId && mp) {
        const qtdBase = converterParaBase(novaQtd, novaUnidade, mp.unidadeBase);
        await tx.movimentacaoMateriaPrima.create({
          data: {
            materiaPrimaId: mpId,
            tipo: "ENTRADA",
            origem: "CUSTO",
            quantidade: qtdBase,
            custoId: parseInt(id),
            data: novaData,
            observacao: `Compra: ${c.nome}`,
          },
        });
      }

      return c;
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

    await prisma.$transaction(async (tx) => {
      // Remover movimentações vinculadas antes de deletar o custo
      await tx.movimentacaoMateriaPrima.deleteMany({ where: { custoId: parseInt(id) } });
      await tx.custo.delete({ where: { id: parseInt(id) } });
    });

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
