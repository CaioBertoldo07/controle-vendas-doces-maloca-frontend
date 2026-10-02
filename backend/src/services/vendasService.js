/**
 * Vendas: registro manual e automático, edição, pagamento, exclusão,
 * consultas, totais e relatório mensal.
 *
 * Invariantes (Etapa 0.6, docs/tcc/etapa-0-6-invariantes-criticas.md):
 *   - Venda.quantidade = Σ VendaSabor.quantidade (a quantidade do corpo é ignorada);
 *   - a edição é atômica e respeita campo omitido (`sabores` ausente preserva itens);
 *   - /vendas/auto só grava com cliente e sabores resolvidos sem ambiguidade.
 * Mantidos de propósito (KNOWN_BEHAVIOR):
 *   - K7: `valor` vem do chamador (não deriva do preço do sabor);
 *   - K9: a venda não valida estoque e aceita sabor inativo;
 *   - item com quantidade 0 ou negativa é aceito se a soma for positiva.
 * Os objetos devolvidos têm o mesmo formato das respostas atuais da API
 * (inclusive valores monetários como string com 2 casas nos totais).
 */
import { ErroDominio, erro } from "../lib/erros.js";
import {
  agoraCivil,
  formatarDiaCivil,
  intervaloDoMes,
  intervaloEntreDatas,
  lerDataCivil,
  mesAtualCivil,
  nomeDoMes,
} from "../lib/periodos.js";
import { prisma } from "../lib/prisma.js";
import { RESOLUCAO, resolverCliente, resolverSabores } from "./resolverNomes.js";

/** Itens como são gravados: ids e quantidades inteiros (parseInt, como antes). */
const itensDaVenda = (sabores) =>
  sabores.map((s) => ({ saborId: parseInt(s.saborId), quantidade: parseInt(s.quantidade) }));

/** Fonte de verdade da quantidade da venda. */
export const somarQuantidades = (itens) => itens.reduce((s, i) => s + i.quantidade, 0);

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

  // Cliente e sabores precisam estar resolvidos sem ambiguidade (Etapa 0.6).
  // INVALIDO → 400, NAO_ENCONTRADO → 404, AMBIGUO → 422 com candidatos;
  // nada é gravado antes disso (a venda é um único nested write no fim).
  const resolucao = await resolverCliente(clienteNome);
  if (resolucao.tipo === RESOLUCAO.INVALIDO) {
    throw new ErroDominio(400, {
      error: `clienteNome inválido: "${clienteNome}" não contém letras nem números`,
      tipo: RESOLUCAO.INVALIDO,
    });
  }
  if (resolucao.tipo === RESOLUCAO.AMBIGUO) {
    throw new ErroDominio(422, {
      error: `Cliente ambíguo: "${clienteNome}"`,
      tipo: RESOLUCAO.AMBIGUO,
      candidatos: resolucao.candidatos,
    });
  }
  const cliente = resolucao.cliente;
  if (!cliente) {
    throw new ErroDominio(404, {
      error: `Cliente não encontrado: "${clienteNome}"`,
      sugestao: "Verifique o nome ou cadastre o cliente primeiro",
    });
  }

  const { sabores: saboresResolvidos, naoEncontrados, ambiguos, invalidos } = await resolverSabores(sabores);
  if (invalidos.length > 0) {
    throw new ErroDominio(400, { error: "Sabores inválidos", tipo: RESOLUCAO.INVALIDO, invalidos });
  }
  if (naoEncontrados.length > 0) {
    throw new ErroDominio(404, {
      error: "Sabores não encontrados",
      naoEncontrados,
      encontrados: saboresResolvidos.length,
    });
  }
  if (ambiguos.length > 0) {
    throw new ErroDominio(422, {
      error: "Sabores ambíguos",
      tipo: RESOLUCAO.AMBIGUO,
      ambiguos,
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
      data: data ? lerDataCivil(data) : agoraCivil(),
      pago: foiPago,
      dataPagamento: foiPago ? agoraCivil() : null,
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

  // A quantidade do corpo continua exigida (middleware), mas o total gravado é
  // a soma dos itens (Etapa 0.6); a regra "maior que zero" vale para a soma.
  const itens = itensDaVenda(sabores);
  const quantidadeTotal = somarQuantidades(itens);
  if (!(quantidadeTotal > 0)) throw erro(400, "Quantidade deve ser maior que zero");

  const cliente = await prisma.cliente.findUnique({
    where: { id: parseInt(clienteId) },
  });
  if (!cliente) throw erro(404, "Cliente não encontrado");

  const foiPago = ehPago(pago);
  // Venda e itens num único nested write (atômico)
  return prisma.venda.create({
    data: {
      clienteId: parseInt(clienteId),
      quantidade: quantidadeTotal,
      valor: parseFloat(valor),
      desconto: parseFloat(desconto || 0),
      data: data ? lerDataCivil(data) : agoraCivil(),
      pago: foiPago,
      dataPagamento: foiPago ? agoraCivil() : null,
      sabores: {
        create: itens,
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
    const { inicio, fimExclusivo } = intervaloDoMes(ano, mes);
    where.data = { gte: inicio, lt: fimExclusivo };
  }

  if (dataInicio && dataFim) {
    const { inicio, fimExclusivo } = intervaloEntreDatas(dataInicio, dataFim);
    where.data = { gte: inicio, lt: fimExclusivo };
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

/**
 * Edição com semântica de campo omitido e atômica (Etapa 0.6):
 *   - campo ausente não muda; `sabores` ausente preserva os itens;
 *   - `sabores` presente é validado e substitui os itens; `sabores: []` → 400;
 *   - `quantidade` do corpo é ignorada: só muda junto com os itens (= Σ itens);
 *   - tudo o que dá para validar é validado antes de escrever, e a escrita é
 *     uma transação: ou tudo muda, ou nada muda.
 */
export async function atualizarVenda(id, { clienteId, valor, desconto, data, sabores, pago } = {}) {
  const vendaExiste = await prisma.venda.findUnique({
    where: { id: parseInt(id) },
  });
  if (!vendaExiste) throw erro(404, "Venda não encontrada");

  let itens;
  if (sabores !== undefined) {
    if (!Array.isArray(sabores) || sabores.length === 0) throw erro(400, "Informe ao menos um sabor");
    itens = itensDaVenda(sabores);
    if (!(somarQuantidades(itens) > 0)) throw erro(400, "Quantidade deve ser maior que zero");
  }
  if (clienteId) {
    const cliente = await prisma.cliente.findUnique({ where: { id: parseInt(clienteId) } });
    if (!cliente) throw erro(404, "Cliente não encontrado");
  }

  return prisma.$transaction(async (tx) => {
    if (itens) await tx.vendaSabor.deleteMany({ where: { vendaId: parseInt(id) } });

    return tx.venda.update({
      where: { id: parseInt(id) },
      data: {
        ...(clienteId && { clienteId: parseInt(clienteId) }),
        ...(itens && { quantidade: somarQuantidades(itens) }),
        ...(valor && { valor: parseFloat(valor) }),
        // desconto usa checagem explícita: 0 é um valor válido (remover o desconto)
        ...(desconto !== undefined && { desconto: parseFloat(desconto) || 0 }),
        ...(data && { data: lerDataCivil(data) }),
        // pago usa checagem explícita: false é um valor válido (voltar a pendente)
        ...(pago !== undefined && {
          pago: ehPago(pago),
          dataPagamento: ehPago(pago) ? vendaExiste.dataPagamento || agoraCivil() : null,
        }),
        ...(itens && { sabores: { create: itens } }),
      },
      include: INCLUIR_CLIENTE_E_SABORES,
    });
  });
}

/**
 * Marca como paga (dataPagamento informada, ou a já existente, ou agora em
 * Manaus) ou volta para pendente (limpa a data).
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
          ? lerDataCivil(dataPagamento)
          : vendaExiste.dataPagamento || agoraCivil()
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
 * (dd/mm/aaaa, dia civil de Manaus) e média de unidades por venda.
 */
export async function obterTotais({ mes, ano, clienteId } = {}) {
  let where = {};

  if (mes && ano) {
    const { inicio, fimExclusivo } = intervaloDoMes(ano, mes);
    where.data = { gte: inicio, lt: fimExclusivo };
  }

  if (clienteId) {
    where.clienteId = parseInt(clienteId);
  }

  const vendas = await prisma.venda.findMany({
    where,
    include: { cliente: true },
  });

  return agregarTotais(vendas);
}

/**
 * Totais de uma lista de vendas (com `cliente`), no formato de /vendas/totais.
 * Pura; usada por obterTotais e por resumoVendasPeriodo (tools dos agentes).
 */
export function agregarTotais(vendas) {
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
    const dia = formatarDiaCivil(v.data);
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

/**
 * Totais de um intervalo de dias civis (dataInicio..dataFim, inclusive), com
 * cliente opcional. Mesma agregação de /vendas/totais (Etapa 1: tools).
 */
export async function resumoVendasPeriodo({ dataInicio, dataFim, clienteId } = {}) {
  const { inicio, fimExclusivo } = intervaloEntreDatas(dataInicio, dataFim);
  const vendas = await prisma.venda.findMany({
    where: { data: { gte: inicio, lt: fimExclusivo }, ...(clienteId && { clienteId: parseInt(clienteId) }) },
    include: { cliente: true },
  });
  return agregarTotais(vendas);
}

/**
 * Recebíveis: vendas pendentes (pago = false), da mais antiga para a mais
 * recente, e o valor total a receber (Etapa 1: tools).
 */
export async function obterRecebiveis() {
  const vendas = await prisma.venda.findMany({
    where: { pago: false },
    include: { cliente: true },
    orderBy: [{ data: "asc" }, { id: "asc" }],
  });
  const { valorPendente } = agregarTotais(vendas);
  return { vendas, valorPendente };
}

/** Série dos 12 meses do ano: vendas, unidades, valor total, pago e pendente. */
export async function relatorioMensal({ ano } = {}) {
  const anoAtual = ano ? parseInt(ano) : mesAtualCivil().ano;

  const meses = [];

  for (let mes = 1; mes <= 12; mes++) {
    const { inicio: startDate, fimExclusivo } = intervaloDoMes(anoAtual, mes);

    const vendas = await prisma.venda.findMany({
      where: {
        data: { gte: startDate, lt: fimExclusivo },
      },
    });

    const total = vendas.reduce((sum, v) => sum + v.quantidade, 0);
    const valorTotal = vendas.reduce((sum, v) => sum + parseFloat(v.valor), 0);
    const valorPago = vendas
      .filter((v) => v.pago)
      .reduce((sum, v) => sum + parseFloat(v.valor), 0);

    meses.push({
      mes,
      nomeMes: nomeDoMes(startDate),
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

/**
 * Piso de data plausível de venda. O histórico real tem uma venda datada no
 * ano 0206 (Etapa 0.2, P1): ela não pode passar por "primeira venda" de um
 * sabor, senão um sabor novo pareceria vendido há séculos.
 */
export const DATA_MINIMA_PLAUSIVEL = "2020-01-01";

/** Date civil → "AAAA-MM-DD HH:MM:SS" (relógio de Manaus) para parâmetro SQL de DATETIME. */
const datetimeSql = (dataCivil) => dataCivil.toISOString().slice(0, 19).replace("T", " ");

/**
 * Unidades vendidas por dia civil e sabor entre dois dias (inclusive),
 * agregadas no banco (GROUP BY), e o dia da primeira venda de cada sabor até
 * dataFim (Etapa 3, Agente de Inteligência). Venda.data guarda o relógio de
 * Manaus (Etapa 0.5): DATE_FORMAT dá o dia civil sem depender do fuso do
 * processo nem da sessão MySQL. Devolve só agregados, nunca vendas ou clientes.
 * A primeira venda só considera datas plausíveis (DATA_MINIMA_PLAUSIVEL); as
 * implausíveis são contadas à parte, como sinal de qualidade.
 */
export async function vendasDiariasPorSabor({ dataInicio, dataFim } = {}) {
  const { inicio, fimExclusivo } = intervaloEntreDatas(dataInicio, dataFim);
  const [ini, fim] = [datetimeSql(inicio), datetimeSql(fimExclusivo)];
  const piso = `${DATA_MINIMA_PLAUSIVEL} 00:00:00`;
  const [dias, primeiras, sabores, implausiveis] = await Promise.all([
    prisma.$queryRaw`
      SELECT DATE_FORMAT(v.data, '%Y-%m-%d') AS dia, vs.saborId AS saborId, SUM(vs.quantidade) AS unidades
      FROM venda_sabores vs JOIN vendas v ON v.id = vs.vendaId
      WHERE v.data >= ${ini} AND v.data < ${fim}
      GROUP BY dia, vs.saborId
      ORDER BY dia, vs.saborId`,
    prisma.$queryRaw`
      SELECT vs.saborId AS saborId, DATE_FORMAT(MIN(v.data), '%Y-%m-%d') AS primeiraVenda
      FROM venda_sabores vs JOIN vendas v ON v.id = vs.vendaId
      WHERE v.data >= ${piso} AND v.data < ${fim}
      GROUP BY vs.saborId`,
    prisma.sabor.findMany({ select: { id: true, nome: true, ativo: true }, orderBy: { nome: "asc" } }),
    prisma.$queryRaw`SELECT COUNT(*) AS n FROM vendas WHERE data < ${piso}`,
  ]);
  const primeira = new Map(primeiras.map((p) => [Number(p.saborId), p.primeiraVenda]));
  return {
    sabores: sabores.map((s) => ({ ...s, primeiraVenda: primeira.get(s.id) ?? null })),
    dias: dias.map((d) => ({ dia: d.dia, saborId: Number(d.saborId), unidades: Number(d.unidades) })),
    vendasComDataImplausivel: Number(implausiveis[0].n),
  };
}
