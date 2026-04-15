import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Calcula saldo atual de uma matéria-prima (dentro ou fora de transação)
async function getSaldoMateriaPrima(client, materiaPrimaId) {
  const movs = await client.movimentacaoMateriaPrima.findMany({
    where: { materiaPrimaId },
    select: { tipo: true, quantidade: true },
  });
  let saldo = 0;
  movs.forEach((m) => {
    const q = parseFloat(m.quantidade);
    if (m.tipo === "ENTRADA") saldo += q;
    else if (m.tipo === "SAIDA") saldo -= q;
    else if (m.tipo === "AJUSTE") saldo += q;
  });
  return saldo;
}

// Calcula necessidade de matéria-prima para uma lista de sabores
async function calcularNecessidades(saboresReq) {
  const saborIds = saboresReq.map((s) => parseInt(s.saborId));
  const saborData = await prisma.sabor.findMany({
    where: { id: { in: saborIds } },
    include: { receita: { include: { materiaPrima: true } } },
  });

  const necessidades = {}; // materiaPrimaId -> { quantidade, nome, unidadeBase }

  for (const s of saboresReq) {
    const sId = parseInt(s.saborId);
    const qtd = parseInt(s.quantidade);
    const sabor = saborData.find((sd) => sd.id === sId);
    if (!sabor) throw new Error(`Sabor ${s.saborId} não encontrado`);

    if (!sabor.rendimentoBase || sabor.receita.length === 0) continue;

    const fator = qtd / sabor.rendimentoBase;
    for (const item of sabor.receita) {
      const mpId = item.materiaPrimaId;
      const qtdNecessaria = parseFloat(item.quantidadeBase) * fator;
      if (!necessidades[mpId]) {
        necessidades[mpId] = {
          quantidade: 0,
          nome: item.materiaPrima.nome,
          unidadeBase: item.materiaPrima.unidadeBase,
        };
      }
      necessidades[mpId].quantidade += qtdNecessaria;
    }
  }

  return necessidades;
}

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
      include: {
        sabores: {
          include: { sabor: true },
        },
      },
    });
    res.json(producao);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar produção" });
  }
};

export const criarProducao = async (req, res) => {
  try {
    const { data, observacao, sabores } = req.body;

    if (!sabores || sabores.length === 0)
      return res.status(400).json({ error: "Informe ao menos um sabor" });

    for (const s of sabores) {
      if (!s.saborId || !s.quantidade || parseInt(s.quantidade) <= 0)
        return res
          .status(400)
          .json({ error: "Quantidade inválida para um dos sabores" });
    }

    // Calcular necessidades de matéria-prima
    const necessidades = await calcularNecessidades(sabores);

    // Verificar saldo de cada matéria-prima necessária
    const erros = [];
    for (const [mpId, need] of Object.entries(necessidades)) {
      const saldo = await getSaldoMateriaPrima(prisma, parseInt(mpId));
      if (saldo < need.quantidade) {
        const falta = need.quantidade - saldo;
        erros.push(
          `${need.nome}: necessário ${need.quantidade.toFixed(1)}${need.unidadeBase}, disponível ${Math.max(0, saldo).toFixed(1)}${need.unidadeBase} (falta ${falta.toFixed(1)}${need.unidadeBase})`
        );
      }
    }

    if (erros.length > 0) {
      return res.status(422).json({
        error: "Estoque insuficiente de matéria-prima",
        faltantes: erros,
      });
    }

    const producao = await prisma.$transaction(async (tx) => {
      const prod = await tx.producao.create({
        data: {
          data: data ? new Date(data) : new Date(),
          observacao: observacao?.trim() || null,
          sabores: {
            create: sabores.map((s) => ({
              saborId: parseInt(s.saborId),
              quantidade: parseInt(s.quantidade),
            })),
          },
        },
        include: {
          sabores: { include: { sabor: true } },
        },
      });

      // Gerar saídas de matéria-prima
      for (const [mpId, need] of Object.entries(necessidades)) {
        await tx.movimentacaoMateriaPrima.create({
          data: {
            materiaPrimaId: parseInt(mpId),
            tipo: "SAIDA",
            origem: "PRODUCAO",
            quantidade: parseFloat(need.quantidade.toFixed(3)),
            producaoId: prod.id,
            data: data ? new Date(data) : new Date(),
            observacao: `Produção #${prod.id}`,
          },
        });
      }

      return prod;
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
    const { data, observacao, sabores } = req.body;

    const existe = await prisma.producao.findUnique({
      where: { id: parseInt(id) },
    });
    if (!existe)
      return res.status(404).json({ error: "Registro não encontrado" });

    // Calcular novas necessidades
    let necessidades = {};
    if (sabores && sabores.length > 0) {
      necessidades = await calcularNecessidades(sabores);
    }

    const producao = await prisma.$transaction(async (tx) => {
      // Reverter movimentações anteriores desta produção
      await tx.movimentacaoMateriaPrima.deleteMany({
        where: { producaoId: parseInt(id) },
      });

      // Verificar novo saldo após reversão
      const erros = [];
      for (const [mpId, need] of Object.entries(necessidades)) {
        const saldo = await getSaldoMateriaPrima(tx, parseInt(mpId));
        if (saldo < need.quantidade) {
          const falta = need.quantidade - saldo;
          erros.push(
            `${need.nome}: necessário ${need.quantidade.toFixed(1)}${need.unidadeBase}, disponível ${Math.max(0, saldo).toFixed(1)}${need.unidadeBase} (falta ${falta.toFixed(1)}${need.unidadeBase})`
          );
        }
      }

      if (erros.length > 0) {
        throw Object.assign(new Error("Estoque insuficiente"), {
          statusCode: 422,
          faltantes: erros,
        });
      }

      // Deletar sabores antigos e recriar
      if (sabores) {
        await tx.producaoSabor.deleteMany({ where: { producaoId: parseInt(id) } });
      }

      const prod = await tx.producao.update({
        where: { id: parseInt(id) },
        data: {
          ...(data && { data: new Date(data) }),
          ...(observacao !== undefined && {
            observacao: observacao?.trim() || null,
          }),
          ...(sabores && {
            sabores: {
              create: sabores.map((s) => ({
                saborId: parseInt(s.saborId),
                quantidade: parseInt(s.quantidade),
              })),
            },
          }),
        },
        include: {
          sabores: { include: { sabor: true } },
        },
      });

      // Recriar movimentações
      for (const [mpId, need] of Object.entries(necessidades)) {
        await tx.movimentacaoMateriaPrima.create({
          data: {
            materiaPrimaId: parseInt(mpId),
            tipo: "SAIDA",
            origem: "PRODUCAO",
            quantidade: parseFloat(need.quantidade.toFixed(3)),
            producaoId: prod.id,
            data: data ? new Date(data) : existe.data,
            observacao: `Produção #${prod.id}`,
          },
        });
      }

      return prod;
    });

    res.json(producao);
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        error: "Estoque insuficiente de matéria-prima",
        faltantes: error.faltantes,
      });
    }
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

    await prisma.$transaction(async (tx) => {
      // Reverter movimentações antes de deletar
      await tx.movimentacaoMateriaPrima.deleteMany({
        where: { producaoId: parseInt(id) },
      });
      await tx.producao.delete({ where: { id: parseInt(id) } });
    });

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

    const producaoMes = await prisma.producao.findMany({
      where: { data: { gte: startDate, lte: endDate } },
      orderBy: { data: "asc" },
      include: { sabores: { include: { sabor: true } } },
    });

    const totalMes = producaoMes.reduce(
      (sum, p) => sum + p.sabores.reduce((s2, ps) => s2 + ps.quantidade, 0),
      0,
    );

    // Por sabor no mês
    const porSabor = {};
    producaoMes.forEach((p) => {
      p.sabores.forEach((ps) => {
        const nome = ps.sabor.nome;
        porSabor[nome] = (porSabor[nome] || 0) + ps.quantidade;
      });
    });

    // Esta semana
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    const inicioSemana = new Date(hoje);
    inicioSemana.setDate(hoje.getDate() - diaSemana);
    inicioSemana.setHours(0, 0, 0, 0);
    const fimSemana = new Date(inicioSemana);
    fimSemana.setDate(inicioSemana.getDate() + 6);
    fimSemana.setHours(23, 59, 59);

    const producaoSemana = await prisma.producaoSabor.aggregate({
      where: { producao: { data: { gte: inicioSemana, lte: fimSemana } } },
      _sum: { quantidade: true },
    });
    const totalSemana = producaoSemana._sum.quantidade || 0;

    // Hoje
    const inicioDia = new Date(hoje);
    inicioDia.setHours(0, 0, 0, 0);
    const fimDia = new Date(hoje);
    fimDia.setHours(23, 59, 59);

    const producaoHoje = await prisma.producaoSabor.aggregate({
      where: { producao: { data: { gte: inicioDia, lte: fimDia } } },
      _sum: { quantidade: true },
    });
    const totalHoje = producaoHoje._sum.quantidade || 0;

    // Resumo anual
    const meses = [];
    for (let m = 1; m <= 12; m++) {
      const s = new Date(anoAtual, m - 1, 1);
      const e = new Date(anoAtual, m, 0, 23, 59, 59);
      const agg = await prisma.producaoSabor.aggregate({
        where: { producao: { data: { gte: s, lte: e } } },
        _sum: { quantidade: true },
      });
      meses.push({
        mes: m,
        nomeMes: s.toLocaleString("pt-BR", { month: "long" }),
        total: agg._sum.quantidade || 0,
      });
    }

    // Vendas do mês para comparação
    const vendasSabores = await prisma.vendaSabor.findMany({
      where: { venda: { data: { gte: startDate, lte: endDate } } },
      include: { sabor: true },
    });

    const vendidoPorSabor = {};
    vendasSabores.forEach((vs) => {
      const nome = vs.sabor.nome;
      vendidoPorSabor[nome] = (vendidoPorSabor[nome] || 0) + vs.quantidade;
    });

    const totalVendido = Object.values(vendidoPorSabor).reduce(
      (s, q) => s + q,
      0,
    );

    const todosSabores = new Set([
      ...Object.keys(porSabor),
      ...Object.keys(vendidoPorSabor),
    ]);

    const saldoPorSabor = {};
    todosSabores.forEach((nome) => {
      const produzido = porSabor[nome] || 0;
      const vendido = vendidoPorSabor[nome] || 0;
      saldoPorSabor[nome] = { produzido, vendido, saldo: produzido - vendido };
    });

    // Produção cumulativa
    const producaoCumulativa = await prisma.producaoSabor.findMany({
      where: { producao: { data: { lte: endDate } } },
      include: { sabor: true },
    });

    const porSaborCumulativo = {};
    producaoCumulativa.forEach((ps) => {
      const nome = ps.sabor.nome;
      porSaborCumulativo[nome] =
        (porSaborCumulativo[nome] || 0) + ps.quantidade;
    });

    // Vendas cumulativas
    const vendasCumulativas = await prisma.vendaSabor.findMany({
      where: { venda: { data: { lte: endDate } } },
      include: { sabor: true },
    });

    const vendidoPorSaborCumulativo = {};
    vendasCumulativas.forEach((vs) => {
      const nome = vs.sabor.nome;
      vendidoPorSaborCumulativo[nome] =
        (vendidoPorSaborCumulativo[nome] || 0) + vs.quantidade;
    });

    const todosSaboresCumulativo = new Set([
      ...Object.keys(porSaborCumulativo),
      ...Object.keys(vendidoPorSaborCumulativo),
    ]);

    const saldoPorSaborCumulativo = {};
    todosSaboresCumulativo.forEach((nome) => {
      const produzido = porSaborCumulativo[nome] || 0;
      const vendido = vendidoPorSaborCumulativo[nome] || 0;
      saldoPorSaborCumulativo[nome] = {
        produzido,
        vendido,
        saldo: produzido - vendido,
      };
    });

    const saldoEstoqueCumulativo = Object.values(saldoPorSaborCumulativo).reduce(
      (s, d) => s + d.saldo,
      0,
    );

    res.json({
      totalHoje,
      totalSemana,
      totalMes,
      totalVendidoMes: totalVendido,
      saldoEstoque: totalMes - totalVendido,
      porSabor,
      vendidoPorSabor,
      saldoPorSabor,
      saldoPorSaborCumulativo,
      saldoEstoqueCumulativo,
      registros: producaoMes,
      meses,
    });
  } catch (error) {
    console.error("Erro no resumo:", error);
    res.status(500).json({ error: "Erro ao gerar resumo" });
  }
};
