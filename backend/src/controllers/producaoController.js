import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const listarProducao = async (req, res) => {
  try {
    const { mes, ano } = req.query;
    let where = {};

    if (mes && ano) {
      const startDate = new Date(ano, mes - 1, 1);
      const endDate = new Date(ano, mes, 0, 23, 59, 59);
      where.data = { gte: startDate, lte: endDate };
    }

    const producao = await prisma.producao.findMany({
      where,
      orderBy: { data: "desc" },
    });
    res.json(producao);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar produção" });
  }
};

export const criarProducao = async (req, res) => {
  try {
    const { quantidade, data, observacao } = req.body;

    if (!quantidade || parseInt(quantidade) <= 0)
      return res.status(400).json({ error: "Quantidade inválida" });

    const producao = await prisma.producao.create({
      data: {
        quantidade: parseInt(quantidade),
        data: data ? new Date(data) : new Date(),
        observacao: observacao?.trim() || null,
      },
    });
    res.status(201).json(producao);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Erro ao registrar produção: " + error.message });
  }
};

export const atualizarProducao = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantidade, data, observacao } = req.body;

    const existe = await prisma.producao.findUnique({
      where: { id: parseInt(id) },
    });
    if (!existe)
      return res.status(404).json({ error: "Registro não encontrado" });

    const producao = await prisma.producao.update({
      where: { id: parseInt(id) },
      data: {
        ...(quantidade && { quantidade: parseInt(quantidade) }),
        ...(data && { data: new Date(data) }),
        ...(observacao !== undefined && {
          observacao: observacao?.trim() || null,
        }),
      },
    });
    res.json(producao);
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar produção" });
  }
};

export const deletarProducao = async (req, res) => {
  try {
    const { id } = req.params;
    const existe = await prisma.producao.findUnique({
      where: { id: parseInt(id) },
    });
    if (!existe)
      return res.status(404).json({ error: "Registro não encontrado" });
    await prisma.producao.delete({ where: { id: parseInt(id) } });
    res.json({ message: "Registro deletado com sucesso" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao deletar registro" });
  }
};

export const resumoProducao = async (req, res) => {
  try {
    const { mes, ano } = req.query;
    const anoAtual = ano ? parseInt(ano) : new Date().getFullYear();
    const mesAtual = mes ? parseInt(mes) : new Date().getMonth() + 1;

    const startDate = new Date(anoAtual, mesAtual - 1, 1);
    const endDate = new Date(anoAtual, mesAtual, 0, 23, 59, 59);

    // Total do mês
    const producaoMes = await prisma.producao.findMany({
      where: { data: { gte: startDate, lte: endDate } },
      orderBy: { data: "asc" },
    });

    const totalMes = producaoMes.reduce((sum, p) => sum + p.quantidade, 0);

    // Esta semana
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    const inicioSemana = new Date(hoje);
    inicioSemana.setDate(hoje.getDate() - diaSemana);
    inicioSemana.setHours(0, 0, 0, 0);
    const fimSemana = new Date(inicioSemana);
    fimSemana.setDate(inicioSemana.getDate() + 6);
    fimSemana.setHours(23, 59, 59);

    const producaoSemana = await prisma.producao.findMany({
      where: { data: { gte: inicioSemana, lte: fimSemana } },
    });
    const totalSemana = producaoSemana.reduce(
      (sum, p) => sum + p.quantidade,
      0,
    );

    // Hoje
    const inicioDia = new Date(hoje);
    inicioDia.setHours(0, 0, 0, 0);
    const fimDia = new Date(hoje);
    fimDia.setHours(23, 59, 59);

    const producaoHoje = await prisma.producao.findMany({
      where: { data: { gte: inicioDia, lte: fimDia } },
    });
    const totalHoje = producaoHoje.reduce((sum, p) => sum + p.quantidade, 0);

    // Resumo anual
    const meses = [];
    for (let m = 1; m <= 12; m++) {
      const s = new Date(anoAtual, m - 1, 1);
      const e = new Date(anoAtual, m, 0, 23, 59, 59);
      const pm = await prisma.producao.findMany({
        where: { data: { gte: s, lte: e } },
      });
      const total = pm.reduce((sum, p) => sum + p.quantidade, 0);
      meses.push({
        mes: m,
        nomeMes: s.toLocaleString("pt-BR", { month: "long" }),
        total,
        registros: pm.length,
      });
    }

    // Comparar produção vs vendas do mês
    const vendas = await prisma.venda.findMany({
      where: { data: { gte: startDate, lte: endDate } },
    });
    const totalVendido = vendas.reduce((sum, v) => sum + v.quantidade, 0);

    res.json({
      totalHoje,
      totalSemana,
      totalMes,
      totalVendidoMes: totalVendido,
      saldoEstoque: totalMes - totalVendido,
      registros: producaoMes,
      meses,
    });
  } catch (error) {
    console.error("Erro no resumo de produção:", error);
    res.status(500).json({ error: "Erro ao gerar resumo" });
  }
};
