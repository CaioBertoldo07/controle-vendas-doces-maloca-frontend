import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const listarClientes = async (req, res) => {
  try {
    const clientes = await prisma.cliente.findMany({
      orderBy: { nome: "asc" },
      include: {
        _count: {
          select: { vendas: true },
        },
      },
    });
    res.json(clientes);
  } catch (error) {
    console.error("Erro ao listar clientes:", error);
    res.status(500).json({ error: "Erro ao buscar clientes" });
  }
};

export const buscarCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await prisma.cliente.findUnique({
      where: { id: parseInt(id) },
      include: {
        vendas: {
          orderBy: { data: "desc" },
          take: 10,
        },
        _count: {
          select: { vendas: true },
        },
      },
    });

    if (!cliente) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    res.json(cliente);
  } catch (error) {
    console.error("Erro ao buscar cliente:", error);
    res.status(500).json({ error: "Erro ao buscar cliente" });
  }
};

export const criarCliente = async (req, res) => {
  try {
    const { nome } = req.body;

    if (!nome || nome.trim() === "") {
      return res.status(400).json({ error: "Nome do cliente é obrigatório" });
    }

    const nomeTrimmed = nome.trim();

    // Verificar se já existe cliente com esse nome (comparação simples)
    const clientes = await prisma.cliente.findMany();
    const clienteExistente = clientes.find(
      (c) => c.nome.toLowerCase() === nomeTrimmed.toLowerCase()
    );

    if (clienteExistente) {
      return res.status(400).json({
        error: "Já existe um cliente com este nome",
      });
    }

    const cliente = await prisma.cliente.create({
      data: { nome: nomeTrimmed },
    });

    console.log("✅ Cliente criado:", cliente);
    res.status(201).json(cliente);
  } catch (error) {
    console.error("❌ Erro ao criar cliente:", error);
    res.status(500).json({ error: "Erro ao criar cliente: " + error.message });
  }
};

export const atualizarCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome } = req.body;

    if (!nome || nome.trim() === "") {
      return res.status(400).json({ error: "Nome do cliente é obrigatório" });
    }

    const nomeTrimmed = nome.trim();

    // Verificar se o cliente existe
    const clienteExiste = await prisma.cliente.findUnique({
      where: { id: parseInt(id) },
    });

    if (!clienteExiste) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    // Verificar se já existe outro cliente com esse nome
    const clientes = await prisma.cliente.findMany({
      where: {
        id: { not: parseInt(id) },
      },
    });

    const clienteComMesmoNome = clientes.find(
      (c) => c.nome.toLowerCase() === nomeTrimmed.toLowerCase()
    );

    if (clienteComMesmoNome) {
      return res.status(400).json({
        error: "Já existe outro cliente com este nome",
      });
    }

    const cliente = await prisma.cliente.update({
      where: { id: parseInt(id) },
      data: { nome: nomeTrimmed },
    });

    console.log("✅ Cliente atualizado:", cliente);
    res.json(cliente);
  } catch (error) {
    console.error("❌ Erro ao atualizar cliente:", error);
    res
      .status(500)
      .json({ error: "Erro ao atualizar cliente: " + error.message });
  }
};

export const deletarCliente = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar se o cliente existe
    const cliente = await prisma.cliente.findUnique({
      where: { id: parseInt(id) },
      include: {
        _count: {
          select: { vendas: true },
        },
      },
    });

    if (!cliente) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    // Avisar se o cliente tem vendas
    if (cliente._count.vendas > 0) {
      return res.status(400).json({
        error: `Cliente possui ${cliente._count.vendas} venda(s) registrada(s). Não é possível deletar.`,
      });
    }

    await prisma.cliente.delete({
      where: { id: parseInt(id) },
    });

    console.log("✅ Cliente deletado:", id);
    res.json({ message: "Cliente deletado com sucesso" });
  } catch (error) {
    console.error("❌ Erro ao deletar cliente:", error);
    res
      .status(500)
      .json({ error: "Erro ao deletar cliente: " + error.message });
  }
};

export const estatisticasCliente = async (req, res) => {
  try {
    const { id } = req.params;

    const cliente = await prisma.cliente.findUnique({
      where: { id: parseInt(id) },
    });

    if (!cliente) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const vendas = await prisma.venda.findMany({
      where: { clienteId: parseInt(id) },
      orderBy: { data: "desc" },
    });

    const totalQuantidade = vendas.reduce((sum, v) => sum + v.quantidade, 0);
    const totalVendas = vendas.length;
    const mediaQuantidade = totalVendas > 0 ? totalQuantidade / totalVendas : 0;

    // Vendas por mês
    const vendasPorMes = vendas.reduce((acc, venda) => {
      const mes = new Date(venda.data).toLocaleString("pt-BR", {
        month: "long",
        year: "numeric",
      });
      acc[mes] = (acc[mes] || 0) + venda.quantidade;
      return acc;
    }, {});

    res.json({
      cliente,
      totalQuantidade,
      totalVendas,
      mediaQuantidade: Math.round(mediaQuantidade * 100) / 100,
      vendasPorMes,
      ultimasVendas: vendas.slice(0, 5),
    });
  } catch (error) {
    console.error("❌ Erro ao buscar estatísticas:", error);
    res
      .status(500)
      .json({ error: "Erro ao buscar estatísticas: " + error.message });
  }
};

export const saboresPorCliente = async (req, res) => {
  try {
    const { id } = req.params;

    const cliente = await prisma.cliente.findUnique({
      where: { id: parseInt(id) }
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    // Buscar todas as vendas do cliente com sabores
    const vendas = await prisma.venda.findMany({
      where: { clienteId: parseInt(id) },
      include: {
        sabores: {
          include: {
            sabor: true
          }
        }
      }
    });

    // Agregar sabores
    const saboresAgregados = {};
    let totalGeral = 0;

    vendas.forEach(venda => {
      venda.sabores.forEach(vs => {
        const saborNome = vs.sabor.nome;
        
        if (!saboresAgregados[saborNome]) {
          saboresAgregados[saborNome] = {
            nome: saborNome,
            quantidade: 0,
            vezes: 0
          };
        }
        
        saboresAgregados[saborNome].quantidade += vs.quantidade;
        saboresAgregados[saborNome].vezes += 1;
        totalGeral += vs.quantidade;
      });
    });

    // Calcular porcentagens e ordenar
    const saboresComPorcentagem = Object.values(saboresAgregados).map(sabor => ({
      ...sabor,
      porcentagem: ((sabor.quantidade / totalGeral) * 100).toFixed(1)
    })).sort((a, b) => b.quantidade - a.quantidade);

    res.json({
      cliente,
      totalGeral,
      sabores: saboresComPorcentagem
    });
  } catch (error) {
    console.error('❌ Erro ao buscar sabores por cliente:', error);
    res.status(500).json({ error: 'Erro ao buscar sabores: ' + error.message });
  }
};

export const rankingSaboresGeral = async (req, res) => {
  try {
    // Buscar todos os sabores vendidos
    const vendaSabores = await prisma.vendaSabor.findMany({
      include: {
        sabor: true,
        venda: {
          include: {
            cliente: true
          }
        }
      }
    });

    // Agregar por cliente e sabor
    const clientesSabores = {};

    vendaSabores.forEach(vs => {
      const clienteNome = vs.venda.cliente.nome;
      const saborNome = vs.sabor.nome;

      if (!clientesSabores[clienteNome]) {
        clientesSabores[clienteNome] = {
          nome: clienteNome,
          totalComprado: 0,
          sabores: {}
        };
      }

      if (!clientesSabores[clienteNome].sabores[saborNome]) {
        clientesSabores[clienteNome].sabores[saborNome] = 0;
      }

      clientesSabores[clienteNome].sabores[saborNome] += vs.quantidade;
      clientesSabores[clienteNome].totalComprado += vs.quantidade;
    });

    // Processar dados para retornar
    const resultado = Object.values(clientesSabores).map(cliente => {
      const saboresArray = Object.entries(cliente.sabores)
        .map(([nome, quantidade]) => ({
          nome,
          quantidade,
          porcentagem: ((quantidade / cliente.totalComprado) * 100).toFixed(1)
        }))
        .sort((a, b) => b.quantidade - a.quantidade);

      return {
        cliente: cliente.nome,
        totalComprado: cliente.totalComprado,
        saborFavorito: saboresArray[0]?.nome || 'N/A',
        quantidadeFavorito: saboresArray[0]?.quantidade || 0,
        sabores: saboresArray
      };
    }).sort((a, b) => b.totalComprado - a.totalComprado);

    res.json(resultado);
  } catch (error) {
    console.error('❌ Erro ao buscar ranking de sabores:', error);
    res.status(500).json({ error: 'Erro ao buscar ranking: ' + error.message });
  }
};