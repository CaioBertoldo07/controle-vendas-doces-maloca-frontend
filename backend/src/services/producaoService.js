/**
 * Produção e MRP (necessidade de insumos pela receita).
 *
 * Edição parcial e atômica desde a Etapa 0.6 (editar sem `sabores` preserva
 * itens e saídas). Mantidos de propósito (KNOWN_BEHAVIOR):
 *   - K12: sabor sem receita, ou sem rendimentoBase, não consome insumo
 *     (a produção real ainda não tem receitas; bloquear pararia a operação);
 *   - K14: sabor inexistente lança Error comum (a API responde 500).
 */
import { ErroDominio, erro } from "../lib/erros.js";
import {
  agoraCivil,
  intervaloDaSemana,
  intervaloDoDia,
  intervaloDoMes,
  intervaloEntreDatas,
  lerDataCivil,
  mesAtualCivil,
  nomeDoMes,
} from "../lib/periodos.js";
import { prisma } from "../lib/prisma.js";
import { obterSaldoMateriaPrima } from "./materiaPrimaService.js";

/**
 * Necessidade de matéria-prima para uma lista de { saborId, quantidade }.
 * Devolve { [materiaPrimaId]: { quantidade, nome, unidadeBase } }, com as
 * quantidades de todos os sabores somadas por insumo.
 */
export async function calcularNecessidades(saboresReq, client = prisma) {
  const saborIds = saboresReq.map((s) => parseInt(s.saborId));
  const saborData = await client.sabor.findMany({
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

/**
 * Compara as necessidades com o saldo atual e devolve as mensagens dos
 * insumos faltantes (lista vazia = há saldo para tudo).
 * KNOWN_BEHAVIOR: saldo negativo aparece como "disponível 0.0", mas a falta
 * é calculada com o saldo real.
 */
export async function verificarFaltantes(necessidades, client = prisma) {
  const erros = [];
  for (const [mpId, need] of Object.entries(necessidades)) {
    const saldo = await obterSaldoMateriaPrima(parseInt(mpId), client);
    if (saldo < need.quantidade) {
      const falta = need.quantidade - saldo;
      erros.push(
        `${need.nome}: necessário ${need.quantidade.toFixed(1)}${need.unidadeBase}, disponível ${Math.max(0, saldo).toFixed(1)}${need.unidadeBase} (falta ${falta.toFixed(1)}${need.unidadeBase})`,
      );
    }
  }
  return erros;
}

const estoqueInsuficiente = (faltantes) =>
  new ErroDominio(422, { error: "Estoque insuficiente de matéria-prima", faltantes });

/** Grava uma SAÍDA/PRODUCAO por insumo da produção. */
async function registrarSaidas(tx, necessidades, producaoId, data) {
  for (const [mpId, need] of Object.entries(necessidades)) {
    await tx.movimentacaoMateriaPrima.create({
      data: {
        materiaPrimaId: parseInt(mpId),
        tipo: "SAIDA",
        origem: "PRODUCAO",
        quantidade: parseFloat(need.quantidade.toFixed(3)),
        producaoId,
        data,
        observacao: `Produção #${producaoId}`,
      },
    });
  }
}

export async function listarProducao({ mes, ano } = {}) {
  let where = {};

  if (mes && ano) {
    const { inicio, fimExclusivo } = intervaloDoMes(ano, mes);
    where.data = { gte: inicio, lt: fimExclusivo };
  }

  return prisma.producao.findMany({
    where,
    orderBy: { data: "desc" },
    include: {
      sabores: {
        include: { sabor: true },
      },
    },
  });
}

/** Mesma validação de itens na criação e na edição com `sabores`. */
function validarItens(sabores) {
  if (!Array.isArray(sabores) || sabores.length === 0) throw erro(400, "Informe ao menos um sabor");

  for (const s of sabores) {
    if (!s.saborId || !s.quantidade || parseInt(s.quantidade) <= 0)
      throw erro(400, "Quantidade inválida para um dos sabores");
  }
}

export async function criarProducao({ data, observacao, sabores } = {}) {
  validarItens(sabores);

  const necessidades = await calcularNecessidades(sabores);

  const faltantes = await verificarFaltantes(necessidades);
  if (faltantes.length > 0) throw estoqueInsuficiente(faltantes);

  // Data civil de Manaus; a produção e as saídas de insumo recebem a mesma.
  const quando = data ? lerDataCivil(data) : agoraCivil();

  return prisma.$transaction(async (tx) => {
    const prod = await tx.producao.create({
      data: {
        data: quando,
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

    await registrarSaidas(tx, necessidades, prod.id, quando);

    return prod;
  });
}

export async function atualizarProducao(id, { data, observacao, sabores } = {}) {
  const existe = await prisma.producao.findUnique({
    where: { id: parseInt(id) },
  });
  if (!existe) throw erro(404, "Registro não encontrado");

  // Etapa 0.6 (corrige o KNOWN_BEHAVIOR K1):
  //   `sabores` ausente  → itens e saídas preservados; uma data nova também é
  //                        aplicada às saídas existentes;
  //   `sabores` presente → validados como na criação; saldo, itens e saídas
  //                        substituídos na transação.
  // Qualquer falha desfaz a transação inteira.
  const substituiItens = sabores !== undefined;
  let necessidades = {};
  if (substituiItens) {
    validarItens(sabores);
    necessidades = await calcularNecessidades(sabores);
  }
  const novaData = data ? lerDataCivil(data) : undefined;

  return prisma.$transaction(async (tx) => {
    if (substituiItens) {
      // Reverter as saídas anteriores desta produção antes de checar o saldo
      await tx.movimentacaoMateriaPrima.deleteMany({
        where: { producaoId: parseInt(id) },
      });

      const faltantes = await verificarFaltantes(necessidades, tx);
      if (faltantes.length > 0) throw estoqueInsuficiente(faltantes); // rollback

      await tx.producaoSabor.deleteMany({ where: { producaoId: parseInt(id) } });
    } else if (novaData) {
      await tx.movimentacaoMateriaPrima.updateMany({
        where: { producaoId: parseInt(id) },
        data: { data: novaData },
      });
    }

    const prod = await tx.producao.update({
      where: { id: parseInt(id) },
      data: {
        ...(novaData && { data: novaData }),
        ...(observacao !== undefined && {
          observacao: observacao?.trim() || null,
        }),
        ...(substituiItens && {
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

    if (substituiItens) await registrarSaidas(tx, necessidades, prod.id, novaData ?? existe.data);

    return prod;
  });
}

export async function excluirProducao(id) {
  const existe = await prisma.producao.findUnique({
    where: { id: parseInt(id) },
  });
  if (!existe) throw erro(404, "Registro não encontrado");

  await prisma.$transaction(async (tx) => {
    // Reverter as saídas antes de apagar (os itens saem por cascade)
    await tx.movimentacaoMateriaPrima.deleteMany({
      where: { producaoId: parseInt(id) },
    });
    await tx.producao.delete({ where: { id: parseInt(id) } });
  });
}

/** Soma quantidades por nome do sabor. */
function somarPorNomeDoSabor(itens) {
  const porNome = {};
  itens.forEach((i) => {
    const nome = i.sabor.nome;
    porNome[nome] = (porNome[nome] || 0) + i.quantidade;
  });
  return porNome;
}

function saldoPorNome(produzidoPorNome, vendidoPorNome) {
  const nomes = new Set([...Object.keys(produzidoPorNome), ...Object.keys(vendidoPorNome)]);
  const saldo = {};
  nomes.forEach((nome) => {
    const produzido = produzidoPorNome[nome] || 0;
    const vendido = vendidoPorNome[nome] || 0;
    saldo[nome] = { produzido, vendido, saldo: produzido - vendido };
  });
  return saldo;
}

/**
 * Resumo usado pela aba Produção: hoje, semana, mês, 12 meses, produzido ×
 * vendido no mês e acumulado até o fim do mês. Mês, hoje e semana (domingo a
 * sábado) são do calendário de Manaus, independentemente do fuso do processo.
 */
export async function obterResumoProducao({ mes, ano } = {}) {
  const agora = mesAtualCivil(); // mês corrente em Manaus
  const anoAtual = ano ? parseInt(ano) : agora.ano;
  const mesAtual = mes ? parseInt(mes) : agora.mes;

  const { inicio: startDate, fimExclusivo: fimMes } = intervaloDoMes(anoAtual, mesAtual);

  const producaoMes = await prisma.producao.findMany({
    where: { data: { gte: startDate, lt: fimMes } },
    orderBy: { data: "asc" },
    include: { sabores: { include: { sabor: true } } },
  });

  const totalMes = producaoMes.reduce(
    (sum, p) => sum + p.sabores.reduce((s2, ps) => s2 + ps.quantidade, 0),
    0,
  );

  // Por sabor no mês
  const porSabor = somarPorNomeDoSabor(producaoMes.flatMap((p) => p.sabores));

  // Esta semana (domingo a sábado, em Manaus)
  const hoje = agoraCivil();
  const semana = intervaloDaSemana(hoje);

  const producaoSemana = await prisma.producaoSabor.aggregate({
    where: { producao: { data: { gte: semana.inicio, lt: semana.fimExclusivo } } },
    _sum: { quantidade: true },
  });
  const totalSemana = producaoSemana._sum.quantidade || 0;

  // Hoje (em Manaus)
  const dia = intervaloDoDia(hoje);

  const producaoHoje = await prisma.producaoSabor.aggregate({
    where: { producao: { data: { gte: dia.inicio, lt: dia.fimExclusivo } } },
    _sum: { quantidade: true },
  });
  const totalHoje = producaoHoje._sum.quantidade || 0;

  // Resumo anual
  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const { inicio: s, fimExclusivo: e } = intervaloDoMes(anoAtual, m);
    const agg = await prisma.producaoSabor.aggregate({
      where: { producao: { data: { gte: s, lt: e } } },
      _sum: { quantidade: true },
    });
    meses.push({
      mes: m,
      nomeMes: nomeDoMes(s),
      total: agg._sum.quantidade || 0,
    });
  }

  // Vendas do mês para comparação
  const vendasSabores = await prisma.vendaSabor.findMany({
    where: { venda: { data: { gte: startDate, lt: fimMes } } },
    include: { sabor: true },
  });
  const vendidoPorSabor = somarPorNomeDoSabor(vendasSabores);
  const totalVendido = Object.values(vendidoPorSabor).reduce((s, q) => s + q, 0);
  const saldoPorSabor = saldoPorNome(porSabor, vendidoPorSabor);

  // Produção e vendas acumuladas até o fim do mês
  const producaoCumulativa = await prisma.producaoSabor.findMany({
    where: { producao: { data: { lt: fimMes } } },
    include: { sabor: true },
  });
  const vendasCumulativas = await prisma.vendaSabor.findMany({
    where: { venda: { data: { lt: fimMes } } },
    include: { sabor: true },
  });
  const saldoPorSaborCumulativo = saldoPorNome(
    somarPorNomeDoSabor(producaoCumulativa),
    somarPorNomeDoSabor(vendasCumulativas),
  );

  const saldoEstoqueCumulativo = Object.values(saldoPorSaborCumulativo).reduce(
    (s, d) => s + d.saldo,
    0,
  );

  return {
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
  };
}

/**
 * Unidades produzidas e vendidas por sabor entre dois dias civis (inclusive,
 * calendário de Manaus). Fluxos do período: não dependem do saldo histórico
 * (Etapa 2, comparação de ritmo do Agente de Estoque).
 */
export async function compararProducaoVendasPorSabor({ dataInicio, dataFim } = {}) {
  const { inicio, fimExclusivo } = intervaloEntreDatas(dataInicio, dataFim);
  const periodo = { gte: inicio, lt: fimExclusivo };
  const [produzidos, vendidos] = await Promise.all([
    prisma.producaoSabor.groupBy({ by: ["saborId"], where: { producao: { data: periodo } }, _sum: { quantidade: true } }),
    prisma.vendaSabor.groupBy({ by: ["saborId"], where: { venda: { data: periodo } }, _sum: { quantidade: true } }),
  ]);

  const ids = [...new Set([...produzidos, ...vendidos].map((x) => x.saborId))];
  const sabores = ids.length
    ? await prisma.sabor.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })
    : [];
  const nome = new Map(sabores.map((s) => [s.id, s.nome]));
  const prod = new Map(produzidos.map((p) => [p.saborId, p._sum.quantidade ?? 0]));
  const vend = new Map(vendidos.map((v) => [v.saborId, v._sum.quantidade ?? 0]));

  return ids
    .map((id) => ({ saborId: id, sabor: nome.get(id), produzido: prod.get(id) ?? 0, vendido: vend.get(id) ?? 0 }))
    .sort((a, b) => a.sabor.localeCompare(b.sabor));
}
