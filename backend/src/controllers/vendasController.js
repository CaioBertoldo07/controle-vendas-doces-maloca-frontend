import { PrismaClient } from "@prisma/client";
import { parse } from "dotenv";
import { resolverCliente, resolverSabores } from "../services/resolverNomes.js";

const prisma = new PrismaClient();

export const criarVendaAuto = async (req, res) => {
  try {
    const {
      clienteNome, // "Frutaria Laranjeiras - nome em texto"
      sabores, // [{ nome: "Tradicional", quantidade: 20 }]
      valor,
      desconto = 0,
      data,
      idempotencyKey, // chave única enviada pelo n8n para evitar duplicata
    } = req.body;

    // --- Validações básicas ---
    if (!clienteNome?.trim()) {
      return res.status(400).json({ error: "clienteNome é obrigatório" });
    }
    if (!sabores || sabores.length === 0) {
      return res.status(400).json({ error: "Informe ao menos um sabor" });
    }
    if (!valor || parseFloat(valor) <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    // --- Idempotência: rejeita duplicata ---
    if (idempotencyKey) {
      const vendaExistente = await prisma.venda.findFirst({
        where: { idempotencyKey },
      });
      if (vendaExistente) {
        return res.status(200).json({
          message: "Venda já registrada anteriormente (idempotente)",
          venda: vendaExistente,
          duplicata: true,
        });
      }
    }

    // --- Resolver Cliente ---
    const cliente = await resolverCliente(clienteNome);
    if (!cliente) {
      return res.status(404).json({
        error: `Cliente não encontrado: "${clienteNome}"`,
        sugestao: "Verifique o nome ou cadastre o cliente primeiro",
      });
    }

    // --- Resolver Sabores ---
    const { sabores: saboresResolvidos, naoEncontrados } =
      await resolverSabores(sabores);
    if (naoEncontrados.length > 0) {
      return res.status(404).json({
        error: "Sabores não encontrados",
        naoEncontrados,
        encontrados: saboresResolvidos.length,
      });
    }

    const quantidadeTotal = saboresResolvidos.reduce(
      (s, i) => s + i.quantidade,
      0,
    );

    // --- Criar Venda ---
    const venda = await prisma.venda.create({
      data: {
        clienteId: cliente.id,
        quantidade: quantidadeTotal,
        valor: parseFloat(valor),
        desconto: parseFloat(desconto),
        data: data ? new Date(data) : new Date(),
        idempotencyKey: idempotencyKey || null,
        sabores: {
          create: saboresResolvidos,
        },
      },
      include: {
        cliente: true,
        sabores: { include: { sabor: true } },
      },
    });

    console.log(
      `✅ [AUTO] Venda registrada via n8n: ${venda.id} - ${cliente.nome}`,
    );

    return res.status(201).json({
      message: "Venda registrada com sucesso",
      venda,
      resolucao: {
        clienteEncontrado: cliente.nome,
        saboresResolvidos: saboresResolvidos.length,
      },
    });
  } catch (error) {
    console.error("❌ [AUTO] Erro ao criar venda:", error);
    return res
      .status(500)
      .json({ error: "Erro ao registrar venda: " + error.message });
  }
};

export const criarVenda = async (req, res) => {
  try {
    const { clienteId, quantidade, valor, desconto, data, sabores } = req.body;

    // Validações
    if (
      !clienteId ||
      !quantidade ||
      !valor ||
      !sabores ||
      sabores.length === 0
    ) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    // Verificar se o cliente existe
    const cliente = await prisma.cliente.findUnique({
      where: { id: parseInt(clienteId) },
    });

    if (!cliente) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    // Criar venda com sabores
    const venda = await prisma.venda.create({
      data: {
        clienteId: parseInt(clienteId),
        quantidade: parseInt(quantidade),
        valor: parseFloat(valor),
        desconto: parseFloat(desconto || 0),
        data: data ? new Date(data) : new Date(),
        sabores: {
          create: sabores.map((s) => ({
            saborId: parseInt(s.saborId),
            quantidade: parseInt(s.quantidade),
          })),
        },
      },
      include: {
        cliente: true,
        sabores: {
          include: {
            sabor: true,
          },
        },
      },
    });

    console.log("✅ Venda criada:", venda);
    res.status(201).json(venda);
  } catch (error) {
    console.error("❌ Erro ao criar venda:", error);
    res
      .status(500)
      .json({ error: "Erro ao registrar venda: " + error.message });
  }
};

export const listarVendas = async (req, res) => {
  try {
    const { mes, ano, clienteId, dataInicio, dataFim, limit } = req.query;

    let where = {};

    if (mes && ano) {
      const startDate = new Date(ano, mes - 1, 1);
      const endDate = new Date(ano, mes, 0, 23, 59, 59);
      where.data = { gte: startDate, lte: endDate };
    }

    if (dataInicio && dataFim) {
      where.data = {
        gte: new Date(dataInicio),
        lte: new Date(dataFim + "T23:59:59"),
      };
    }

    if (clienteId) {
      where.clienteId = parseInt(clienteId);
    }

    const vendas = await prisma.venda.findMany({
      where,
      include: {
        cliente: true,
        sabores: {
          include: {
            sabor: true,
          },
        },
      },
      orderBy: { data: "desc" },
      take: limit ? parseInt(limit) : undefined,
    });

    res.json(vendas);
  } catch (error) {
    console.error("Erro ao listar vendas:", error);
    res.status(500).json({ error: "Erro ao buscar vendas" });
  }
};

export const buscarVenda = async (req, res) => {
  try {
    const { id } = req.params;

    const venda = await prisma.venda.findUnique({
      where: { id: parseInt(id) },
      include: {
        cliente: true,
        sabores: {
          include: {
            sabor: true,
          },
        },
      },
    });

    if (!venda) {
      return res.status(404).json({ error: "Venda não encontrada" });
    }

    res.json(venda);
  } catch (error) {
    console.error("Erro ao buscar venda:", error);
    res.status(500).json({ error: "Erro ao buscar venda" });
  }
};

export const atualizarVenda = async (req, res) => {
  try {
    const { id } = req.params;
    const { clienteId, quantidade, valor, data, sabores } = req.body;

    const vendaExiste = await prisma.venda.findUnique({
      where: { id: parseInt(id) },
    });

    if (!vendaExiste) {
      return res.status(404).json({ error: "Venda não encontrada" });
    }

    // Deletar sabores antigos
    await prisma.vendaSabor.deleteMany({
      where: { vendaId: parseInt(id) },
    });

    // Atualizar venda e criar novos sabores
    const venda = await prisma.venda.update({
      where: { id: parseInt(id) },
      data: {
        ...(clienteId && { clienteId: parseInt(clienteId) }),
        ...(quantidade && { quantidade: parseInt(quantidade) }),
        ...(valor && { valor: parseFloat(valor) }),
        ...(data && { data: new Date(data) }),
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
        cliente: true,
        sabores: {
          include: {
            sabor: true,
          },
        },
      },
    });

    res.json(venda);
  } catch (error) {
    console.error("Erro ao atualizar venda:", error);
    res.status(500).json({ error: "Erro ao atualizar venda" });
  }
};

export const deletarVenda = async (req, res) => {
  try {
    const { id } = req.params;

    const venda = await prisma.venda.findUnique({
      where: { id: parseInt(id) },
    });

    if (!venda) {
      return res.status(404).json({ error: "Venda não encontrada" });
    }

    await prisma.venda.delete({
      where: { id: parseInt(id) },
    });

    res.json({ message: "Venda deletada com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar venda:", error);
    res.status(500).json({ error: "Erro ao deletar venda" });
  }
};

export const obterTotais = async (req, res) => {
  try {
    const { mes, ano, clienteId } = req.query;

    let where = {};

    if (mes && ano) {
      const startDate = new Date(ano, mes - 1, 1);
      const endDate = new Date(ano, mes, 0, 23, 59, 59);
      where.data = { gte: startDate, lte: endDate };
    }

    if (clienteId) {
      where.clienteId = parseInt(clienteId);
    }

    const vendas = await prisma.venda.findMany({
      where,
      include: { cliente: true },
    });

    const totalGeral = vendas.reduce((sum, v) => sum + v.quantidade, 0);
    const valorTotal = vendas.reduce((sum, v) => sum + parseFloat(v.valor), 0);

    const porCliente = vendas.reduce((acc, v) => {
      const nome = v.cliente.nome;
      acc[nome] = (acc[nome] || 0) + v.quantidade;
      return acc;
    }, {});

    const porDia = vendas.reduce((acc, v) => {
      const dia = new Date(v.data).toLocaleDateString("pt-BR");
      acc[dia] = (acc[dia] || 0) + v.quantidade;
      return acc;
    }, {});

    res.json({
      totalGeral,
      valorTotal: valorTotal.toFixed(2),
      totalVendas: vendas.length,
      porCliente,
      porDia,
      media:
        vendas.length > 0
          ? Math.round((totalGeral / vendas.length) * 100) / 100
          : 0,
    });
  } catch (error) {
    console.error("Erro ao calcular totais:", error);
    res.status(500).json({ error: "Erro ao calcular totais" });
  }
};

export const relatorioMensal = async (req, res) => {
  try {
    const { ano } = req.query;
    const anoAtual = ano ? parseInt(ano) : new Date().getFullYear();

    const meses = [];

    for (let mes = 1; mes <= 12; mes++) {
      const startDate = new Date(anoAtual, mes - 1, 1);
      const endDate = new Date(anoAtual, mes, 0, 23, 59, 59);

      const vendas = await prisma.venda.findMany({
        where: {
          data: { gte: startDate, lte: endDate },
        },
      });

      const total = vendas.reduce((sum, v) => sum + v.quantidade, 0);
      const valorTotal = vendas.reduce(
        (sum, v) => sum + parseFloat(v.valor),
        0,
      );

      meses.push({
        mes,
        nomeMes: startDate.toLocaleString("pt-BR", { month: "long" }),
        totalVendas: vendas.length,
        totalQuantidade: total,
        valorTotal: valorTotal.toFixed(2),
      });
    }

    res.json({
      ano: anoAtual,
      meses,
    });
  } catch (error) {
    console.error("Erro ao gerar relatório mensal:", error);
    res.status(500).json({ error: "Erro ao gerar relatório mensal" });
  }
};
