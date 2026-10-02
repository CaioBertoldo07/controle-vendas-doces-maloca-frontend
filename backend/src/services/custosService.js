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
import { agoraCivil, intervaloDoMes, intervaloEntreDatas, lerDataCivil, mesAtualCivil, nomeDoMes } from "../lib/periodos.js";
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
    const { inicio, fimExclusivo } = intervaloDoMes(ano, mes);
    where.data = { gte: inicio, lt: fimExclusivo };
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

  // Data civil de Manaus; o custo e a entrada de insumo recebem a mesma.
  const quando = data ? lerDataCivil(data) : agoraCivil();

  return prisma.$transaction(async (tx) => {
    const c = await tx.custo.create({
      data: {
        nome: nome.trim(),
        categoria: categoria || "Matéria Prima",
        quantidade: parseFloat(quantidade),
        unidade: unidade.trim(),
        valorTotal: parseFloat(valorTotal),
        data: quando,
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
          data: quando,
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
  const novaData = data !== undefined ? lerDataCivil(data) : existe.data;

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
        ...(data && { data: lerDataCivil(data) }),
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
  const agora = mesAtualCivil(); // mês corrente em Manaus
  const anoAtual = ano ? parseInt(ano) : agora.ano;
  const mesAtual = mes ? parseInt(mes) : agora.mes;

  const { inicio: startDate, fimExclusivo } = intervaloDoMes(anoAtual, mesAtual);

  const custos = await prisma.custo.findMany({
    where: { data: { gte: startDate, lt: fimExclusivo } },
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
    const { inicio: s, fimExclusivo: e } = intervaloDoMes(anoAtual, m);
    const cm = await prisma.custo.findMany({
      where: { data: { gte: s, lt: e } },
    });
    const total = cm.reduce((sum, c) => sum + parseFloat(c.valorTotal), 0);
    meses.push({
      mes: m,
      nomeMes: nomeDoMes(s),
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

/**
 * Custos lançados entre dois dias civis (inclusive): total e por categoria,
 * agregados no banco (Etapa 3, Agente de Inteligência; custo AGREGADO).
 */
export async function totalCustosPeriodo({ dataInicio, dataFim } = {}) {
  const { inicio, fimExclusivo } = intervaloEntreDatas(dataInicio, dataFim);
  const where = { data: { gte: inicio, lt: fimExclusivo } };
  const [total, categorias] = await Promise.all([
    prisma.custo.aggregate({ where, _sum: { valorTotal: true }, _count: { _all: true } }),
    prisma.custo.groupBy({ by: ["categoria"], where, _sum: { valorTotal: true }, _count: { _all: true }, orderBy: { categoria: "asc" } }),
  ]);
  return {
    quantidade: total._count._all,
    valorTotal: Number(total._sum.valorTotal ?? 0),
    porCategoria: categorias.map((c) => ({ categoria: c.categoria, quantidade: c._count._all, valorTotal: Number(c._sum.valorTotal ?? 0) })),
  };
}
