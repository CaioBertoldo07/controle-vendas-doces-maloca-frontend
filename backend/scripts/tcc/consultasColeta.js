/**
 * Catálogo das consultas da coleta da Etapa 0.2 (somente leitura).
 *
 * Cada consulta é constante (nenhum trecho vem de entrada do usuário) e é
 * validada por `validarSomenteLeitura` antes de executar.
 * Nomes de tabela/coluna seguem backend/prisma/schema.prisma.
 * Nenhuma consulta retorna nome de cliente ou dado de usuário.
 */

export const CONSULTAS = [
  // ---------- Vendas ----------
  {
    nome: "vendas_resumo",
    descricao: "Volume e período histórico de vendas",
    sql: `SELECT COUNT(*) AS total_vendas,
                 MIN(data) AS primeira_venda,
                 MAX(data) AS ultima_venda,
                 COALESCE(SUM(quantidade), 0) AS unidades_vendidas,
                 COALESCE(SUM(valor), 0) AS valor_total,
                 COALESCE(SUM(desconto), 0) AS desconto_total,
                 COUNT(DISTINCT clienteId) AS clientes_com_venda,
                 COUNT(DISTINCT DATE(data)) AS dias_com_venda,
                 COALESCE(SUM(idempotencyKey IS NOT NULL), 0) AS vendas_via_automacao
            FROM vendas`,
  },
  {
    nome: "vendas_por_mes",
    descricao: "Série mensal de vendas",
    sql: `SELECT DATE_FORMAT(data, '%Y-%m') AS mes,
                 COUNT(*) AS vendas,
                 SUM(quantidade) AS unidades,
                 SUM(valor) AS valor
            FROM vendas
           GROUP BY DATE_FORMAT(data, '%Y-%m')
           ORDER BY mes`,
  },
  {
    nome: "itens_vendidos",
    descricao: "Itens de venda (venda_sabores)",
    sql: `SELECT COUNT(*) AS itens,
                 COALESCE(SUM(quantidade), 0) AS unidades
            FROM venda_sabores`,
  },
  {
    nome: "vendas_consistencia",
    descricao: "Vendas sem itens e vendas cuja quantidade difere da soma dos itens",
    sql: `SELECT COALESCE(SUM(t.n_itens = 0), 0) AS vendas_sem_itens,
                 COALESCE(SUM(t.soma_itens <> t.quantidade), 0) AS vendas_quantidade_divergente
            FROM (SELECT v.id, v.quantidade,
                         COUNT(vs.id) AS n_itens,
                         COALESCE(SUM(vs.quantidade), 0) AS soma_itens
                    FROM vendas v
                    LEFT JOIN venda_sabores vs ON vs.vendaId = v.id
                   GROUP BY v.id, v.quantidade) AS t`,
  },
  {
    nome: "vendas_antes_da_primeira_producao",
    descricao: "Vendas registradas antes do primeiro registro de produção (qualquer sabor)",
    sql: `SELECT COUNT(*) AS vendas,
                 COALESCE(SUM(quantidade), 0) AS unidades
            FROM vendas
           WHERE data < (SELECT MIN(data) FROM producao)`,
  },

  // ---------- Produção ----------
  {
    nome: "producao_resumo",
    descricao: "Volume e período histórico de produção",
    sql: `SELECT COUNT(*) AS registros_producao,
                 MIN(data) AS primeira_producao,
                 MAX(data) AS ultima_producao,
                 COUNT(DISTINCT DATE(data)) AS dias_com_producao,
                 (SELECT COALESCE(SUM(quantidade), 0) FROM producao_sabores) AS unidades_produzidas
            FROM producao`,
  },
  {
    nome: "producao_por_mes",
    descricao: "Série mensal de produção",
    sql: `SELECT DATE_FORMAT(p.data, '%Y-%m') AS mes,
                 COUNT(DISTINCT p.id) AS registros,
                 COALESCE(SUM(ps.quantidade), 0) AS unidades
            FROM producao p
            LEFT JOIN producao_sabores ps ON ps.producaoId = p.id
           GROUP BY DATE_FORMAT(p.data, '%Y-%m')
           ORDER BY mes`,
  },

  // ---------- Sabores / receitas ----------
  {
    nome: "sabores_produzido_vendido",
    descricao: "Por sabor: produzido, vendido, receita e datas de início",
    sql: `SELECT s.id, s.nome, s.ativo,
                 s.precoUnitario AS preco_unitario,
                 s.rendimentoBase AS rendimento_base,
                 (SELECT COUNT(*) FROM receita_itens r WHERE r.saborId = s.id) AS itens_receita,
                 (SELECT COALESCE(SUM(ps.quantidade), 0) FROM producao_sabores ps WHERE ps.saborId = s.id) AS produzido,
                 (SELECT COALESCE(SUM(vs.quantidade), 0) FROM venda_sabores vs WHERE vs.saborId = s.id) AS vendido,
                 (SELECT MIN(p.data) FROM producao_sabores ps JOIN producao p ON p.id = ps.producaoId WHERE ps.saborId = s.id) AS primeira_producao,
                 (SELECT MIN(v.data) FROM venda_sabores vs JOIN vendas v ON v.id = vs.vendaId WHERE vs.saborId = s.id) AS primeira_venda
            FROM sabores s
           ORDER BY s.nome`,
  },
  {
    nome: "vendido_antes_da_producao_por_sabor",
    descricao: "Unidades vendidas de cada sabor antes da primeira produção daquele sabor",
    sql: `SELECT vs.saborId AS sabor_id,
                 COALESCE(SUM(vs.quantidade), 0) AS unidades
            FROM venda_sabores vs
            JOIN vendas v ON v.id = vs.vendaId
            LEFT JOIN (SELECT ps.saborId, MIN(p.data) AS primeira
                         FROM producao_sabores ps
                         JOIN producao p ON p.id = ps.producaoId
                        GROUP BY ps.saborId) f ON f.saborId = vs.saborId
           WHERE f.primeira IS NULL OR v.data < f.primeira
           GROUP BY vs.saborId`,
  },
  {
    nome: "receitas_resumo",
    descricao: "Cobertura de receitas (BOM) por sabor",
    sql: `SELECT COUNT(*) AS sabores_total,
                 COALESCE(SUM(ativo), 0) AS sabores_ativos,
                 COALESCE(SUM(rendimentoBase IS NOT NULL), 0) AS sabores_com_rendimento,
                 (SELECT COUNT(DISTINCT saborId) FROM receita_itens) AS sabores_com_receita,
                 (SELECT COUNT(*) FROM receita_itens) AS itens_receita
            FROM sabores`,
  },

  // ---------- Matéria-prima ----------
  {
    nome: "materias_primas_saldo",
    descricao: "Saldo por matéria-prima (mesma regra do backend: ENTRADA/AJUSTE somam, SAIDA subtrai)",
    sql: `SELECT m.id, m.nome, m.unidadeBase AS unidade_base, m.ativo,
                 COALESCE(SUM(CASE mv.tipo
                                WHEN 'ENTRADA' THEN mv.quantidade
                                WHEN 'AJUSTE' THEN mv.quantidade
                                WHEN 'SAIDA' THEN -mv.quantidade
                                ELSE 0 END), 0) AS saldo,
                 COUNT(mv.id) AS movimentacoes,
                 MIN(mv.data) AS primeira_movimentacao,
                 MAX(mv.data) AS ultima_movimentacao
            FROM materias_primas m
            LEFT JOIN movimentacoes_materia_prima mv ON mv.materiaPrimaId = m.id
           GROUP BY m.id, m.nome, m.unidadeBase, m.ativo
           ORDER BY m.nome`,
  },
  {
    nome: "movimentacoes_por_tipo",
    descricao: "Movimentações de matéria-prima por tipo e origem",
    sql: `SELECT tipo, origem,
                 COUNT(*) AS registros,
                 SUM(quantidade) AS quantidade,
                 MIN(data) AS primeira,
                 MAX(data) AS ultima
            FROM movimentacoes_materia_prima
           GROUP BY tipo, origem
           ORDER BY tipo, origem`,
  },

  // ---------- Custos ----------
  {
    nome: "custos_resumo",
    descricao: "Volume de custos e vínculo com matéria-prima",
    sql: `SELECT COUNT(*) AS custos,
                 COALESCE(SUM(valorTotal), 0) AS valor_total,
                 MIN(data) AS primeiro,
                 MAX(data) AS ultimo,
                 COALESCE(SUM(materiaPrimaId IS NOT NULL), 0) AS vinculados_a_materia_prima,
                 COALESCE(SUM(categoria = 'Matéria Prima' AND materiaPrimaId IS NULL), 0) AS materia_prima_sem_vinculo
            FROM custos`,
  },
  {
    nome: "custos_por_categoria",
    descricao: "Custos por categoria",
    sql: `SELECT categoria, COUNT(*) AS custos, SUM(valorTotal) AS valor
            FROM custos
           GROUP BY categoria
           ORDER BY valor DESC`,
  },
  {
    nome: "custos_por_mes",
    descricao: "Série mensal de custos",
    sql: `SELECT DATE_FORMAT(data, '%Y-%m') AS mes, COUNT(*) AS custos, SUM(valorTotal) AS valor
            FROM custos
           GROUP BY DATE_FORMAT(data, '%Y-%m')
           ORDER BY mes`,
  },
  {
    nome: "custos_unidade_sem_conversao",
    descricao: "Custos vinculados cuja unidade não é convertida para a unidade base (backend só converte kg→g e L→ml)",
    sql: `SELECT c.unidade, m.unidadeBase AS unidade_base, COUNT(*) AS custos
            FROM custos c
            JOIN materias_primas m ON m.id = c.materiaPrimaId
           WHERE c.unidade <> m.unidadeBase
             AND NOT ((c.unidade = 'kg' AND m.unidadeBase = 'g')
                   OR (c.unidade = 'L' AND m.unidadeBase = 'ml'))
           GROUP BY c.unidade, m.unidadeBase`,
  },

  // ---------- Pagamentos ----------
  {
    nome: "pagamentos_resumo",
    descricao: "Vendas pagas × pendentes; pagas com dataPagamento = data (padrão do backfill)",
    sql: `SELECT pago,
                 COUNT(*) AS vendas,
                 COALESCE(SUM(valor), 0) AS valor,
                 COALESCE(SUM(dataPagamento = data), 0) AS data_pagamento_igual_data_venda,
                 MIN(data) AS primeira,
                 MAX(data) AS ultima
            FROM vendas
           GROUP BY pago`,
  },
  {
    nome: "pendentes_por_idade",
    descricao: "Vendas pendentes por faixa de dias desde a venda",
    sql: `SELECT CASE WHEN DATEDIFF(NOW(), data) <= 7 THEN '0-7'
                      WHEN DATEDIFF(NOW(), data) <= 30 THEN '8-30'
                      WHEN DATEDIFF(NOW(), data) <= 60 THEN '31-60'
                      ELSE '60+' END AS faixa_dias,
                 COUNT(*) AS vendas,
                 SUM(valor) AS valor
            FROM vendas
           WHERE pago = FALSE
           GROUP BY faixa_dias
           ORDER BY faixa_dias`,
  },
  {
    nome: "pagamentos_desde_funcionalidade",
    descricao: "Vendas desde 14/08/2026 (controle de pagamento real): pagas e prazo médio",
    sql: `SELECT COUNT(*) AS vendas,
                 COALESCE(SUM(pago), 0) AS pagas,
                 AVG(CASE WHEN pago THEN DATEDIFF(dataPagamento, data) END) AS prazo_medio_recebimento_dias
            FROM vendas
           WHERE data >= '2026-08-14'`,
  },

  // ---------- Clientes (apenas contagens) ----------
  {
    nome: "clientes_resumo",
    descricao: "Clientes cadastrados, com venda e ativos nos últimos 90 dias",
    sql: `SELECT COUNT(*) AS clientes,
                 (SELECT COUNT(DISTINCT clienteId) FROM vendas) AS clientes_com_venda,
                 (SELECT COUNT(DISTINCT clienteId) FROM vendas WHERE data >= NOW() - INTERVAL 90 DAY) AS clientes_ativos_90_dias
            FROM clientes`,
  },
];
