/**
 * Clientes: cadastro, estatísticas, sabores por cliente e ranking
 * cliente × sabor (base das análises do futuro Agente de Vendas).
 *
 * Extraído de clientesController sem mudança de comportamento. Preservados:
 *   - KNOWN_BEHAVIOR: duplicidade só ignora maiúsculas (não normaliza acentos);
 *   - KNOWN_BEHAVIOR: o ranking agrupa por NOME do cliente, não por id.
 */
import { erro } from "../lib/erros.js";
import { prisma } from "../lib/prisma.js";

export async function listarClientes() {
  return prisma.cliente.findMany({
    orderBy: { nome: "asc" },
    include: {
      _count: {
        select: { vendas: true },
      },
    },
  });
}

/** Cliente com as 10 vendas mais recentes e a contagem total. */
export async function buscarCliente(id) {
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
  if (!cliente) throw erro(404, "Cliente não encontrado");
  return cliente;
}

const mesmoNome = (a, b) => a.toLowerCase() === b.toLowerCase();

export async function criarCliente({ nome } = {}) {
  if (!nome || nome.trim() === "") throw erro(400, "Nome do cliente é obrigatório");

  const nomeTrimmed = nome.trim();

  const clientes = await prisma.cliente.findMany();
  if (clientes.find((c) => mesmoNome(c.nome, nomeTrimmed))) {
    throw erro(400, "Já existe um cliente com este nome");
  }

  return prisma.cliente.create({
    data: { nome: nomeTrimmed },
  });
}

export async function atualizarCliente(id, { nome } = {}) {
  if (!nome || nome.trim() === "") throw erro(400, "Nome do cliente é obrigatório");

  const nomeTrimmed = nome.trim();

  const clienteExiste = await prisma.cliente.findUnique({
    where: { id: parseInt(id) },
  });
  if (!clienteExiste) throw erro(404, "Cliente não encontrado");

  const outros = await prisma.cliente.findMany({
    where: {
      id: { not: parseInt(id) },
    },
  });
  if (outros.find((c) => mesmoNome(c.nome, nomeTrimmed))) {
    throw erro(400, "Já existe outro cliente com este nome");
  }

  return prisma.cliente.update({
    where: { id: parseInt(id) },
    data: { nome: nomeTrimmed },
  });
}

/** Só exclui cliente sem vendas. */
export async function excluirCliente(id) {
  const cliente = await prisma.cliente.findUnique({
    where: { id: parseInt(id) },
    include: {
      _count: {
        select: { vendas: true },
      },
    },
  });
  if (!cliente) throw erro(404, "Cliente não encontrado");

  if (cliente._count.vendas > 0) {
    throw erro(
      400,
      `Cliente possui ${cliente._count.vendas} venda(s) registrada(s). Não é possível deletar.`,
    );
  }

  await prisma.cliente.delete({
    where: { id: parseInt(id) },
  });
}

/**
 * Totais do cliente, média de unidades por venda, unidades por mês
 * ("março de 2026", no fuso do processo) e as 5 vendas mais recentes.
 */
export async function obterEstatisticasCliente(id) {
  const cliente = await prisma.cliente.findUnique({
    where: { id: parseInt(id) },
  });
  if (!cliente) throw erro(404, "Cliente não encontrado");

  const vendas = await prisma.venda.findMany({
    where: { clienteId: parseInt(id) },
    orderBy: { data: "desc" },
  });

  const totalQuantidade = vendas.reduce((sum, v) => sum + v.quantidade, 0);
  const totalVendas = vendas.length;
  const mediaQuantidade = totalVendas > 0 ? totalQuantidade / totalVendas : 0;

  const vendasPorMes = vendas.reduce((acc, venda) => {
    const mes = new Date(venda.data).toLocaleString("pt-BR", {
      month: "long",
      year: "numeric",
    });
    acc[mes] = (acc[mes] || 0) + venda.quantidade;
    return acc;
  }, {});

  return {
    cliente,
    totalQuantidade,
    totalVendas,
    mediaQuantidade: Math.round(mediaQuantidade * 100) / 100,
    vendasPorMes,
    ultimasVendas: vendas.slice(0, 5),
  };
}

/** Sabores comprados pelo cliente: quantidade, vezes e porcentagem (1 casa). */
export async function obterSaboresDoCliente(id) {
  const cliente = await prisma.cliente.findUnique({
    where: { id: parseInt(id) },
  });
  if (!cliente) throw erro(404, "Cliente não encontrado");

  const vendas = await prisma.venda.findMany({
    where: { clienteId: parseInt(id) },
    include: {
      sabores: {
        include: {
          sabor: true,
        },
      },
    },
  });

  const saboresAgregados = {};
  let totalGeral = 0;

  vendas.forEach((venda) => {
    venda.sabores.forEach((vs) => {
      const saborNome = vs.sabor.nome;
      if (!saboresAgregados[saborNome]) {
        saboresAgregados[saborNome] = { nome: saborNome, quantidade: 0, vezes: 0 };
      }
      saboresAgregados[saborNome].quantidade += vs.quantidade;
      saboresAgregados[saborNome].vezes += 1;
      totalGeral += vs.quantidade;
    });
  });

  const sabores = Object.values(saboresAgregados)
    .map((sabor) => ({
      ...sabor,
      porcentagem: ((sabor.quantidade / totalGeral) * 100).toFixed(1),
    }))
    .sort((a, b) => b.quantidade - a.quantidade);

  return { cliente, totalGeral, sabores };
}

/** Ranking de clientes por unidades compradas, com sabor favorito de cada um. */
export async function obterRankingSabores() {
  const vendaSabores = await prisma.vendaSabor.findMany({
    include: {
      sabor: true,
      venda: {
        include: {
          cliente: true,
        },
      },
    },
  });

  const clientesSabores = {};

  vendaSabores.forEach((vs) => {
    const clienteNome = vs.venda.cliente.nome;
    const saborNome = vs.sabor.nome;

    if (!clientesSabores[clienteNome]) {
      clientesSabores[clienteNome] = { nome: clienteNome, totalComprado: 0, sabores: {} };
    }
    if (!clientesSabores[clienteNome].sabores[saborNome]) {
      clientesSabores[clienteNome].sabores[saborNome] = 0;
    }

    clientesSabores[clienteNome].sabores[saborNome] += vs.quantidade;
    clientesSabores[clienteNome].totalComprado += vs.quantidade;
  });

  return Object.values(clientesSabores)
    .map((cliente) => {
      const saboresArray = Object.entries(cliente.sabores)
        .map(([nome, quantidade]) => ({
          nome,
          quantidade,
          porcentagem: ((quantidade / cliente.totalComprado) * 100).toFixed(1),
        }))
        .sort((a, b) => b.quantidade - a.quantidade);

      return {
        cliente: cliente.nome,
        totalComprado: cliente.totalComprado,
        saborFavorito: saboresArray[0]?.nome || "N/A",
        quantidadeFavorito: saboresArray[0]?.quantidade || 0,
        sabores: saboresArray,
      };
    })
    .sort((a, b) => b.totalComprado - a.totalComprado);
}
