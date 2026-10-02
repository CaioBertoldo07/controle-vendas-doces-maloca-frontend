/**
 * Sabores (produtos) e receitas (BOM: rendimentoBase + itens de matéria-prima).
 * A receita alimenta o MRP de producaoService.calcularNecessidades.
 * Extraído de saboresController sem mudança de comportamento.
 */
import { erro } from "../lib/erros.js";
import { prisma } from "../lib/prisma.js";

export async function listarSabores({ todos } = {}) {
  const where = todos === "true" ? {} : { ativo: true };
  return prisma.sabor.findMany({
    where,
    orderBy: { nome: "asc" },
    include: {
      _count: { select: { vendaSabores: true } },
    },
  });
}

export async function buscarSabor(id) {
  const sabor = await prisma.sabor.findUnique({
    where: { id: parseInt(id) },
    include: {
      _count: { select: { vendaSabores: true } },
    },
  });
  if (!sabor) throw erro(404, "Sabor não encontrado");
  return sabor;
}

export async function criarSabor({ nome, precoUnitario } = {}) {
  if (!nome || nome.trim() === "") throw erro(400, "Nome do sabor é obrigatório");

  if (!precoUnitario || isNaN(precoUnitario) || parseFloat(precoUnitario) <= 0) {
    throw erro(400, "Preço unitário inválido");
  }

  const existe = await prisma.sabor.findFirst({
    where: { nome: { equals: nome.trim() } },
  });
  if (existe) throw erro(400, "Já existe um sabor com este nome");

  return prisma.sabor.create({
    data: {
      nome: nome.trim(),
      precoUnitario: parseFloat(precoUnitario),
      ativo: true,
    },
  });
}

export async function atualizarSabor(id, { nome, precoUnitario, ativo } = {}) {
  const existe = await prisma.sabor.findUnique({
    where: { id: parseInt(id) },
  });
  if (!existe) throw erro(404, "Sabor não encontrado");

  const data = {};
  if (nome !== undefined) data.nome = nome.trim();
  if (precoUnitario !== undefined) data.precoUnitario = parseFloat(precoUnitario);
  if (ativo !== undefined) data.ativo = Boolean(ativo);

  return prisma.sabor.update({
    where: { id: parseInt(id) },
    data,
  });
}

/**
 * Sabor com vendas é só desativado ({ desativado: true, sabor }); sem vendas é
 * apagado, levando a receita junto por cascade ({ desativado: false }).
 */
export async function excluirSabor(id) {
  const sabor = await prisma.sabor.findUnique({
    where: { id: parseInt(id) },
    include: { _count: { select: { vendaSabores: true } } },
  });
  if (!sabor) throw erro(404, "Sabor não encontrado");

  if (sabor._count.vendaSabores > 0) {
    const atualizado = await prisma.sabor.update({
      where: { id: parseInt(id) },
      data: { ativo: false },
    });
    return { desativado: true, sabor: atualizado };
  }

  await prisma.sabor.delete({ where: { id: parseInt(id) } });
  return { desativado: false };
}

/** Receita do sabor: { rendimentoBase, itens (com a matéria-prima) }. */
export async function obterReceita(id) {
  const sabor = await prisma.sabor.findUnique({ where: { id: parseInt(id) } });
  if (!sabor) throw erro(404, "Sabor não encontrado");

  const itens = await prisma.receitaItem.findMany({
    where: { saborId: parseInt(id) },
    include: { materiaPrima: true },
    orderBy: { id: "asc" },
  });

  return { rendimentoBase: sabor.rendimentoBase, itens };
}

/** Grava rendimentoBase e SUBSTITUI todos os itens da receita (transação). */
export async function salvarReceita(id, { rendimentoBase, itens } = {}) {
  if (!rendimentoBase || parseInt(rendimentoBase) <= 0) {
    throw erro(400, "Rendimento base inválido");
  }

  const sabor = await prisma.sabor.findUnique({ where: { id: parseInt(id) } });
  if (!sabor) throw erro(404, "Sabor não encontrado");

  await prisma.$transaction(async (tx) => {
    await tx.sabor.update({
      where: { id: parseInt(id) },
      data: { rendimentoBase: parseInt(rendimentoBase) },
    });

    await tx.receitaItem.deleteMany({ where: { saborId: parseInt(id) } });

    if (itens && itens.length > 0) {
      await tx.receitaItem.createMany({
        data: itens.map((item) => ({
          saborId: parseInt(id),
          materiaPrimaId: parseInt(item.materiaPrimaId),
          quantidadeBase: parseFloat(item.quantidadeBase),
        })),
      });
    }
  });

  const itensAtualizados = await prisma.receitaItem.findMany({
    where: { saborId: parseInt(id) },
    include: { materiaPrima: true },
    orderBy: { id: "asc" },
  });
  const saborAtualizado = await prisma.sabor.findUnique({ where: { id: parseInt(id) } });

  return { rendimentoBase: saborAtualizado.rendimentoBase, itens: itensAtualizados };
}

/**
 * Receita de todos os sabores ativos numa consulta só (Etapa 2, tools dos
 * agentes): rendimento e itens com a matéria-prima.
 */
export async function listarReceitas() {
  return prisma.sabor.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
    include: { receita: { include: { materiaPrima: true }, orderBy: { id: "asc" } } },
  });
}
