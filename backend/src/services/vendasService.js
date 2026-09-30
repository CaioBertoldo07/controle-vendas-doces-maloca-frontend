/**
 * Vendas: registro manual e automático, edição, pagamento, exclusão,
 * consultas, totais e relatório mensal.
 *
 * Extraído de vendasController SEM mudança de comportamento. Preservados de
 * propósito (ver docs/tcc/etapa-0-3-testes-caracterizacao.md, K2/K3/K7–K9):
 *   - KNOWN_BEHAVIOR: `valor` e `quantidade` vêm do chamador (não derivam dos itens);
 *   - KNOWN_BEHAVIOR: a venda não valida estoque e aceita sabor inativo;
 *   - KNOWN_BEHAVIOR: a edição NÃO é atômica e, sem `sabores`, apaga os itens.
 * Os objetos devolvidos têm o mesmo formato das respostas atuais da API
 * (inclusive valores monetários como string com 2 casas nos totais).
 */
import { ErroDominio, erro } from "../lib/erros.js";
import { intervaloDoMes } from "../lib/periodos.js";
import { prisma } from "../lib/prisma.js";
import { resolverCliente, resolverSabores } from "./resolverNomes.js";

const INCLUIR_CLIENTE_E_SABORES = {
  cliente: true,
  sabores: {
    include: {
      sabor: true,
    },
  },
};

const ehPago = (pago) => pago === true || pago === "true";

/**
 * Registro a partir de texto (cliente e sabores por nome), usado por
 * POST /api/vendas/auto. Devolve { duplicata: true, venda } quando a
 * idempotencyKey já existe; senão { duplicata: false, venda, cliente,
 * saboresResolvidos }.
 */
export async function criarVendaPorTexto({
  clienteNome,
  sabores,
  valor,
  desconto = 0,
  data,
  pago = false, // nasce pendente; é marcada como paga em Relatórios
  idempotencyKey,
} = {}) {
  if (!clienteNome?.trim()) throw erro(400, "clienteNome é obrigatório");
  if (!sabores || sabores.length === 0) throw erro(400, "Informe ao menos um sabor");
  if (!valor || parseFloat(valor) <= 0) throw erro(400, "Valor inválido");

  if (idempotencyKey) {
    const vendaExistente = await prisma.venda.findFirst({
      where: { idempotencyKey },
    });
    if (vendaExistente) return { duplicata: true, venda: vendaExistente };
  }

  // KNOWN_BEHAVIOR: resolução ambígua escolhe o primeiro candidato
  const cliente = await resolverCliente(clienteNome);
  if (!cliente) {
    throw new ErroDominio(404, {
      error: `Cliente não encontrado: "${clienteNome}"`,
      sugestao: "Verifique o nome ou cadastre o cliente primeiro",
    });
  }

  const { sabores: saboresResolvidos, naoEncontrados } = await resolverSabores(sabores);
  if (naoEncontrados.length > 0) {
    throw new ErroDominio(404, {
      error: "Sabores não encontrados",
      naoEncontrados,
      encontrados: saboresResolvidos.length,
    });
  }

  const quantidadeTotal = saboresResolvidos.reduce((s, i) => s + i.quantidade, 0);

  const foiPago = ehPago(pago);
  const venda = await prisma.venda.create({
    data: {
      clienteId: cliente.id,
      quantidade: quantidadeTotal,
      valor: parseFloat(valor),
      desconto: parseFloat(desconto),
      data: data ? new Date(data) : new Date(),
      pago: foiPago,
      dataPagamento: foiPago ? new Date() : null,
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

  return { duplicata: false, venda, cliente, saboresResolvidos };
}

export async function criarVenda({
  clienteId,
  quantidade,
  valor,
  desconto,
  data,
  sabores,
  pago = false,
} = {}) {
  if (!clienteId || !quantidade || !valor || !sabores || sabores.length === 0) {
    throw erro(400, "Dados incompletos");
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id: parseInt(clienteId) },
  });
  if (!cliente) throw erro(404, "Cliente não encontrado");

  const foiPago = ehPago(pago);
  // Venda e itens num único nested write (atômico)
  return prisma.venda.create({
    data: {
      clienteId: parseInt(clienteId),
      quantidade: parseInt(quantidade),
      valor: parseFloat(valor),
      desconto: parseFloat(desconto || 0),
      data: data ? new Date(data) : new Date(),
      pago: foiPago,
      dataPagamento: foiPago ? new Date() : null,
      sabores: {
        create: sabores.map((s) => ({
          saborId: parseInt(s.saborId),
          quantidade: parseInt(s.quantidade),
        })),
      },
    },
    include: INCLUIR_CLIENTE_E_SABORES,
  });
}

/**
 * Filtros: pago ("true"/"false"), mes+ano, dataInicio+dataFim (tem
 * precedência sobre mes+ano), clienteId, limit. Mais recente primeiro.
 */
export async function listarVendas({ mes, ano, clienteId, dataInicio, dataFim, limit, pago } = {}) {
  let where = {};

  if (pago === "true" || pago === "false") {
    where.pago = pago === "true";
  }

  if (mes && ano) {
    const { inicio, fim } = intervaloDoMes(ano, mes);
    where.data = { gte: inicio, lte: fim };
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

  return prisma.venda.findMany({
    where,
    include: INCLUIR_CLIENTE_E_SABORES,
    orderBy: { data: "desc" },
    take: limit ? parseInt(limit) : undefined,
  });
}

export async function buscarVenda(id) {
  const venda = await prisma.venda.findUnique({
    where: { id: parseInt(id) },
    include: INCLUIR_CLIENTE_E_SABORES,
  });
  if (!venda) throw erro(404, "Venda não encontrada");
  return venda;
}

export async function atualizarVenda(id, { clienteId, quantidade, valor, desconto, data, sabores, pago } = {}) {
  const vendaExiste = await prisma.venda.findUnique({
    where: { id: parseInt(id) },
  });
  if (!vendaExiste) throw erro(404, "Venda não encontrada");

  // KNOWN_BEHAVIOR: os itens são apagados FORA de transação e SEMPRE (mesmo
  // sem `sabores` no corpo). Se o update abaixo falhar, a venda fica sem itens.
  // Mantido nesta etapa; a correção é uma mudança de comportamento posterior.
  await prisma.vendaSabor.deleteMany({
    where: { vendaId: parseInt(id) },
  });

  return prisma.venda.update({
    where: { id: parseInt(id) },
    data: {
      ...(clienteId && { clienteId: parseInt(clienteId) }),
      ...(quantidade && { quantidade: parseInt(quantidade) }),
      ...(valor && { valor: parseFloat(valor) }),
      // desconto usa checagem explícita: 0 é um valor válido (remover o desconto)
      ...(desconto !== undefined && { desconto: parseFloat(desconto) || 0 }),
      ...(data && { data: new Date(data) }),
      // pago usa checagem explícita: false é um valor válido (voltar a pendente)
      ...(pago !== undefined && {
        pago: ehPago(pago),
        dataPagamento: ehPago(pago) ? vendaExiste.dataPagamento || new Date() : null,
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
    include: INCLUIR_CLIENTE_E_SABORES,
  });
}

/**
 * Marca como paga (dataPagamento informada, ou a já existente, ou agora) ou
 * volta para pendente (limpa a data).
 */
export async function atualizarPagamento(id, { pago, dataPagamento } = {}) {
  if (pago === undefined) throw erro(400, "Campo 'pago' é obrigatório");

  const vendaExiste = await prisma.venda.findUnique({
    where: { id: parseInt(id) },
  });
  if (!vendaExiste) throw erro(404, "Venda não encontrada");

  const foiPago = ehPago(pago);

  return prisma.venda.update({
    where: { id: parseInt(id) },
    data: {
      pago: foiPago,
      dataPagamento: foiPago
        ? dataPagamento
          ? new Date(dataPagamento)
          : vendaExiste.dataPagamento || new Date()
        : null,
    },
    include: INCLUIR_CLIENTE_E_SABORES,
  });
}

/** Exclui a venda; os itens saem por cascade. */
export async function excluirVenda(id) {
  const venda = await prisma.venda.findUnique({
    where: { id: parseInt(id) },
  });
  if (!venda) throw erro(404, "Venda não encontrada");

  await prisma.venda.delete({
    where: { id: parseInt(id) },
  });
}

/**
 * Totais do período: quantidades, valores (pago = faturamento; pendente = a
 * receber), por cliente (agrupado por NOME, KNOWN_BEHAVIOR), por dia
 * (dd/mm/aaaa no fuso do processo) e média de unidades por venda.
 */
export async function obterTotais({ mes, ano, clienteId } = {}) {
  let where = {};

  if (mes && ano) {
    const { inicio, fim } = intervaloDoMes(ano, mes);
    where.data = { gte: inicio, lte: fim };
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

  const vendasPagas = vendas.filter((v) => v.pago);
  const vendasPendentes = vendas.filter((v) => !v.pago);
  const valorPago = vendasPagas.reduce((sum, v) => sum + parseFloat(v.valor), 0);
  const valorPendente = vendasPendentes.reduce((sum, v) => sum + parseFloat(v.valor), 0);

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

  return {
    totalGeral,
    valorTotal: valorTotal.toFixed(2),
    valorPago: valorPago.toFixed(2),
    valorPendente: valorPendente.toFixed(2),
    totalVendas: vendas.length,
    totalVendasPagas: vendasPagas.length,
    totalVendasPendentes: vendasPendentes.length,
    porCliente,
    porDia,
    media: vendas.length > 0 ? Math.round((totalGeral / vendas.length) * 100) / 100 : 0,
  };
}

/** Série dos 12 meses do ano: vendas, unidades, valor total, pago e pendente. */
export async function relatorioMensal({ ano } = {}) {
  const anoAtual = ano ? parseInt(ano) : new Date().getFullYear();

  const meses = [];

  for (let mes = 1; mes <= 12; mes++) {
    const { inicio: startDate, fim: endDate } = intervaloDoMes(anoAtual, mes);

    const vendas = await prisma.venda.findMany({
      where: {
        data: { gte: startDate, lte: endDate },
      },
    });

    const total = vendas.reduce((sum, v) => sum + v.quantidade, 0);
    const valorTotal = vendas.reduce((sum, v) => sum + parseFloat(v.valor), 0);
    const valorPago = vendas
      .filter((v) => v.pago)
      .reduce((sum, v) => sum + parseFloat(v.valor), 0);

    meses.push({
      mes,
      nomeMes: startDate.toLocaleString("pt-BR", { month: "long" }),
      totalVendas: vendas.length,
      totalQuantidade: total,
      valorTotal: valorTotal.toFixed(2),
      valorPago: valorPago.toFixed(2),
      valorPendente: (valorTotal - valorPago).toFixed(2),
    });
  }

  return {
    ano: anoAtual,
    meses,
  };
}
