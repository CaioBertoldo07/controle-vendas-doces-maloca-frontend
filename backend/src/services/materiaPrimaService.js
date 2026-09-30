/**
 * Matéria-prima: cadastro e saldo por movimentações.
 * Regra do saldo: ENTRADA soma, SAIDA subtrai, AJUSTE soma com o próprio
 * sinal; outros tipos são ignorados (KNOWN_BEHAVIOR).
 */
import { erro } from "../lib/erros.js";
import { prisma } from "../lib/prisma.js";

/** Saldo a partir de uma lista de movimentações { tipo, quantidade }. Pura. */
export function calcularSaldo(movimentacoes) {
  let saldo = 0;
  movimentacoes.forEach((m) => {
    const q = parseFloat(m.quantidade);
    if (m.tipo === "ENTRADA") saldo += q;
    else if (m.tipo === "SAIDA") saldo -= q;
    else if (m.tipo === "AJUSTE") saldo += q;
  });
  return saldo;
}

/** Saldo atual de uma matéria-prima. `client` pode ser uma transação. */
export async function obterSaldoMateriaPrima(materiaPrimaId, client = prisma) {
  const movs = await client.movimentacaoMateriaPrima.findMany({
    where: { materiaPrimaId },
    select: { tipo: true, quantidade: true },
  });
  return calcularSaldo(movs);
}

export async function listarMateriasPrimas({ todos } = {}) {
  const where = todos === "true" ? {} : { ativo: true };
  return prisma.materiaPrima.findMany({
    where,
    orderBy: { nome: "asc" },
  });
}

/** Cria, ou reativa uma matéria-prima inativa com o mesmo nome. */
export async function criarMateriaPrima({ nome, unidadeBase } = {}) {
  if (!nome?.trim()) throw erro(400, "Nome é obrigatório");
  if (!unidadeBase?.trim()) throw erro(400, "Unidade base é obrigatória");

  const existe = await prisma.materiaPrima.findFirst({
    where: { nome: { equals: nome.trim() } },
  });

  if (existe && existe.ativo) {
    throw erro(400, "Já existe uma matéria-prima com este nome");
  }

  if (existe && !existe.ativo) {
    return prisma.materiaPrima.update({
      where: { id: existe.id },
      data: { ativo: true, unidadeBase: unidadeBase.trim() },
    });
  }
  return prisma.materiaPrima.create({
    data: { nome: nome.trim(), unidadeBase: unidadeBase.trim() },
  });
}

export async function atualizarMateriaPrima(id, { nome, unidadeBase, ativo } = {}) {
  const existe = await prisma.materiaPrima.findUnique({
    where: { id: parseInt(id) },
  });
  if (!existe) throw erro(404, "Matéria-prima não encontrada");

  const data = {};
  if (nome !== undefined) data.nome = nome.trim();
  if (unidadeBase !== undefined) data.unidadeBase = unidadeBase.trim();
  if (ativo !== undefined) data.ativo = Boolean(ativo);

  return prisma.materiaPrima.update({
    where: { id: parseInt(id) },
    data,
  });
}

/** "Exclusão" é desativação: as movimentações são preservadas. */
export async function desativarMateriaPrima(id) {
  const existe = await prisma.materiaPrima.findUnique({
    where: { id: parseInt(id) },
  });
  if (!existe) throw erro(404, "Matéria-prima não encontrada");

  await prisma.materiaPrima.update({
    where: { id: parseInt(id) },
    data: { ativo: false },
  });
}

/**
 * Saldo das matérias-primas ativas, com os sinalizadores usados na interface.
 * KNOWN_BEHAVIOR: "saldo baixo" é 0 < saldo < 200 em qualquer unidade.
 */
export async function resumoMateriasPrimas() {
  const materias = await prisma.materiaPrima.findMany({
    where: { ativo: true },
    include: {
      movimentacoes: {
        select: { tipo: true, quantidade: true },
      },
    },
    orderBy: { nome: "asc" },
  });

  return materias.map((mp) => {
    const saldo = calcularSaldo(mp.movimentacoes);
    return {
      id: mp.id,
      nome: mp.nome,
      unidadeBase: mp.unidadeBase,
      saldo: parseFloat(saldo.toFixed(3)),
      saldoBaixo: saldo > 0 && saldo < 200,
      saldoNegativo: saldo < 0,
    };
  });
}
