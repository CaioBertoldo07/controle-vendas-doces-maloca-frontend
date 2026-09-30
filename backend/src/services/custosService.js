/**
 * Custos e entrada de matéria-prima gerada por compra.
 *
 * Extraído de custosController sem mudança de comportamento. Preservados:
 *   - KNOWN_BEHAVIOR: conversão só kg→g e L→ml (sensível a maiúsculas);
 *     demais unidades entram cruas na unidade base;
 *   - KNOWN_BEHAVIOR: gera ENTRADA com qualquer categoria, se houver insumo;
 *   - KNOWN_BEHAVIOR: na edição, valores "falsy" (ex.: 0) são ignorados.
 */
import { erro } from "../lib/erros.js";
import { intervaloDoMes } from "../lib/periodos.js";
import { prisma } from "../lib/prisma.js";

/** Converte a quantidade comprada para a unidade base do insumo. Pura. */
export function converterParaBase(quantidade, unidade, unidadeBase) {
  const q = parseFloat(quantidade);
  if (unidade === "kg" && unidadeBase === "g") return q * 1000;
  if (unidade === "L" && unidadeBase === "ml") return q * 1000;
  return q;
}

export async function listarCustos({ mes, ano, categoria } = {}) {
  let where = {};

  if (mes && ano) {
    const { inicio, fim } = intervaloDoMes(ano, mes);
    where.data = { gte: inicio, lte: fim };
  }
  if (categoria) where.categoria = categoria;

  return prisma.custo.findMany({
    where,
    orderBy: { data: "desc" },
    include: { materiaPrima: { select: { id: true, nome: true, unidadeBase: true } } },
  });
}

export async function criarCusto({
  nome,
  categoria,
  quantidade,
  unidade,
  valorTotal,
  data,
  observacao,
  materiaPrimaId,
} = {}) {
  if (!nome?.trim()) throw erro(400, "Nome é obrigatório");
  if (!quantidade || parseFloat(quantidade) <= 0) throw erro(400, "Quantidade inválida");
  if (!unidade?.trim()) throw erro(400, "Unidade é obrigatória");
  if (!valorTotal || parseFloat(valorTotal) <= 0) throw erro(400, "Valor inválido");

  const mpId = materiaPrimaId ? parseInt(materiaPrimaId) : null;

  let mp = null;
  if (mpId) {
    mp = await prisma.materiaPrima.findUnique({ where: { id: mpId } });
    if (!mp) throw erro(400, "Matéria-prima não encontrada");
  }

  return prisma.$transaction(async (tx) => {
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

    // Entrada de estoque se o custo estiver vinculado a uma matéria-prima
    if (mpId && mp) {
      await tx.movimentacaoMateriaPrima.create({
        data: {
          materiaPrimaId: mpId,
          tipo: "ENTRADA",
          origem: "CUSTO",
          quantidade: converterParaBase(quantidade, unidade, mp.unidadeBase),
          custoId: c.id,
          data: data ? new Date(data) : new Date(),
          observacao: `Compra: ${nome.trim()}`,
        },
      });
    }

    return c;
  });
}

export async function atualizarCusto(id, {
  nome,
  categoria,
  quantidade,
  unidade,
  valorTotal,
  data,
  observacao,
  materiaPrimaId,
} = {}) {
  const existe = await prisma.custo.findUnique({
    where: { id: parseInt(id) },
    include: { materiaPrima: { select: { unidadeBase: true } } },
  });
  if (!existe) throw erro(404, "Custo não encontrado");

  // undefined mantém o vínculo; null/"" desvincula
  const mpId = materiaPrimaId !== undefined
    ? (materiaPrimaId ? parseInt(materiaPrimaId) : null)
    : existe.materiaPrimaId;

  let mp = null;
  if (mpId) {
    mp = await prisma.materiaPrima.findUnique({ where: { id: mpId } });
    if (!mp) throw erro(400, "Matéria-prima não encontrada");
  }

  const novaQtd = quantidade !== undefined ? parseFloat(quantidade) : parseFloat(existe.quantidade);
  const novaUnidade = unidade !== undefined ? unidade.trim() : existe.unidade;
  const novaData = data !== undefined ? new Date(data) : existe.data;

  return prisma.$transaction(async (tx) => {
    // A entrada anterior deste custo é removida e, se houver insumo, recriada
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

    if (mpId && mp) {
      await tx.movimentacaoMateriaPrima.create({
        data: {
          materiaPrimaId: mpId,
          tipo: "ENTRADA",
          origem: "CUSTO",
          quantidade: converterParaBase(novaQtd, novaUnidade, mp.unidadeBase),
          custoId: parseInt(id),
          data: novaData,
          observacao: `Compra: ${c.nome}`,
        },
      });
    }

    return c;
  });
}

export async function excluirCusto(id) {
  const existe = await prisma.custo.findUnique({
    where: { id: parseInt(id) },
  });
  if (!existe) throw erro(404, "Custo não encontrado");

  await prisma.$transaction(async (tx) => {
    await tx.movimentacaoMateriaPrima.deleteMany({ where: { custoId: parseInt(id) } });
    await tx.custo.delete({ where: { id: parseInt(id) } });
  });
}

/** Total do mês, por categoria e série dos 12 meses do ano. */
export async function resumoCustos({ mes, ano } = {}) {
  const anoAtual = ano ? parseInt(ano) : new Date().getFullYear();
  const mesAtual = mes ? parseInt(mes) : new Date().getMonth() + 1;

  const { inicio: startDate, fim: endDate } = intervaloDoMes(anoAtual, mesAtual);

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

  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const { inicio: s, fim: e } = intervaloDoMes(anoAtual, m);
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

  return {
    totalGeral: totalGeral.toFixed(2),
    totalItens: custos.length,
    porCategoria,
    meses,
  };
}
