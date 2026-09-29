/**
 * Catálogo das consultas da coleta da Etapa 0.2 (somente leitura).
 *
 * Cada consulta é constante (nenhum trecho vem de entrada do usuário) e é
 * validada por `validarSomenteLeitura` antes de executar.
 * Nomes de tabela/coluna seguem backend/prisma/schema.prisma.
 *
 * Consultas com `privada: true` servem só de insumo para a análise
 * (analiseColeta.js): suas linhas NÃO são gravadas nos arquivos de saída,
 * apenas os agregados derivados. É o caso de nomes de clientes e de séries
 * por cliente/dia.
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
                 COALESCE(SUM(mv.tipo = 'ENTRADA'), 0) AS n_entradas,
                 COALESCE(SUM(CASE WHEN mv.tipo = 'ENTRADA' THEN mv.quantidade END), 0) AS q_entradas,
                 COALESCE(SUM(mv.tipo = 'SAIDA'), 0) AS n_saidas,
                 COALESCE(SUM(CASE WHEN mv.tipo = 'SAIDA' THEN mv.quantidade END), 0) AS q_saidas,
                 COALESCE(SUM(mv.tipo = 'AJUSTE'), 0) AS n_ajustes,
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

  {
    nome: "pagamentos_por_mes",
    descricao: "Por mês da venda: pagas, pendentes e pagas com dataPagamento igual/diferente da data da venda",
    sql: `SELECT DATE_FORMAT(data, '%Y-%m') AS mes,
                 COUNT(*) AS vendas,
                 COALESCE(SUM(pago), 0) AS pagas,
                 COALESCE(SUM(NOT pago), 0) AS pendentes,
                 COALESCE(SUM(pago AND dataPagamento = data), 0) AS pagas_dp_igual_data,
                 COALESCE(SUM(pago AND dataPagamento <> data), 0) AS pagas_dp_diferente,
                 COALESCE(SUM(pago AND dataPagamento IS NULL), 0) AS pagas_sem_dp
            FROM vendas
           GROUP BY DATE_FORMAT(data, '%Y-%m')
           ORDER BY mes`,
  },
  {
    nome: "pagamentos_antes_depois",
    descricao: "Vendas antes × depois de 14/08/2026 (entrada do controle de pagamento)",
    sql: `SELECT CASE WHEN data < '2026-08-14' THEN 'antes' ELSE 'depois' END AS periodo,
                 COUNT(*) AS vendas,
                 COALESCE(SUM(valor), 0) AS valor,
                 COALESCE(SUM(pago), 0) AS pagas,
                 COALESCE(SUM(NOT pago), 0) AS pendentes,
                 COALESCE(SUM(pago AND dataPagamento = data), 0) AS pagas_dp_igual_data,
                 COALESCE(SUM(pago AND dataPagamento <> data), 0) AS pagas_dp_diferente
            FROM vendas
           GROUP BY periodo
           ORDER BY periodo`,
  },
  {
    nome: "pagamentos_datas_backfill",
    descricao: "Faixas de datas das vendas pagas com dataPagamento = data (padrão do backfill) e das demais pagas",
    sql: `SELECT SUM(dataPagamento = data) AS pagas_dp_igual_data,
                 MIN(CASE WHEN dataPagamento = data THEN data END) AS primeira_venda_dp_igual,
                 MAX(CASE WHEN dataPagamento = data THEN data END) AS ultima_venda_dp_igual,
                 SUM(dataPagamento <> data) AS pagas_dp_diferente,
                 MIN(CASE WHEN dataPagamento <> data THEN dataPagamento END) AS primeiro_registro_pagamento_manual,
                 MAX(CASE WHEN dataPagamento <> data THEN dataPagamento END) AS ultimo_registro_pagamento_manual
            FROM vendas
           WHERE pago = TRUE`,
  },
  {
    nome: "pagamentos_dias_de_registro",
    descricao: "Dias em que mais pagamentos foram registrados (dataPagamento), só vendas com dataPagamento diferente da data",
    sql: `SELECT DATE(dataPagamento) AS dia_registro, COUNT(*) AS pagamentos
            FROM vendas
           WHERE pago = TRUE AND dataPagamento <> data
           GROUP BY DATE(dataPagamento)
           ORDER BY pagamentos DESC
           LIMIT 10`,
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

  // ---------- Unidades e custo de receita ----------
  {
    nome: "custos_por_unidade",
    descricao: "Unidades usadas nos custos e quantos estão vinculados a matéria-prima",
    sql: `SELECT unidade, COUNT(*) AS custos,
                 COALESCE(SUM(materiaPrimaId IS NOT NULL), 0) AS vinculados
            FROM custos
           GROUP BY unidade
           ORDER BY custos DESC`,
  },
  {
    nome: "materias_primas_por_unidade_base",
    descricao: "Unidades base cadastradas nas matérias-primas",
    sql: `SELECT unidadeBase AS unidade_base, COUNT(*) AS materias_primas
            FROM materias_primas
           GROUP BY unidadeBase`,
  },
  {
    nome: "receita_itens",
    descricao: "Itens de receita (sabor × matéria-prima × quantidade base)",
    sql: `SELECT saborId AS sabor_id, materiaPrimaId AS materia_prima_id,
                 quantidadeBase AS quantidade_base
            FROM receita_itens
           ORDER BY saborId, materiaPrimaId`,
  },
  {
    nome: "compras_por_materia_prima",
    descricao: "Compras vinculadas por matéria-prima e unidade (insumo do custo unitário)",
    sql: `SELECT c.materiaPrimaId AS materia_prima_id, c.unidade,
                 m.unidadeBase AS unidade_base,
                 COUNT(*) AS compras,
                 SUM(c.quantidade) AS quantidade,
                 SUM(c.valorTotal) AS valor
            FROM custos c
            JOIN materias_primas m ON m.id = c.materiaPrimaId
           GROUP BY c.materiaPrimaId, c.unidade, m.unidadeBase`,
  },

  // ---------- Insumos privados da análise (não gravados na saída) ----------
  {
    nome: "vendas_valores",
    privada: true,
    descricao: "Valor e quantidade de cada venda (para média, mediana e distribuição)",
    sql: `SELECT valor, quantidade, data FROM vendas`,
  },
  {
    nome: "vendas_por_cliente",
    privada: true,
    descricao: "Vendas por cliente (id), para distribuição e recorrência",
    sql: `SELECT clienteId AS cliente,
                 COUNT(*) AS vendas,
                 SUM(quantidade) AS unidades,
                 COUNT(DISTINCT DATE_FORMAT(data, '%Y-%m')) AS meses_com_compra,
                 MIN(data) AS primeira,
                 MAX(data) AS ultima
            FROM vendas
           GROUP BY clienteId`,
  },
  {
    nome: "clientes_nomes",
    privada: true,
    descricao: "Nomes de clientes, usados só em memória para medir ambiguidade da resolução textual",
    sql: `SELECT id, nome FROM clientes`,
  },
  {
    nome: "vendas_diarias",
    privada: true,
    descricao: "Série diária de vendas",
    sql: `SELECT DATE(data) AS dia, COUNT(*) AS vendas, SUM(quantidade) AS unidades
            FROM vendas
           GROUP BY DATE(data)
           ORDER BY dia`,
  },
  {
    nome: "vendas_sabor_dia",
    privada: true,
    descricao: "Unidades vendidas por sabor e dia (simulação de data de corte)",
    sql: `SELECT vs.saborId AS sabor_id, DATE(v.data) AS dia, SUM(vs.quantidade) AS unidades
            FROM venda_sabores vs
            JOIN vendas v ON v.id = vs.vendaId
           GROUP BY vs.saborId, DATE(v.data)`,
  },
  {
    nome: "producao_sabor_dia",
    privada: true,
    descricao: "Unidades produzidas por sabor e dia (simulação de data de corte)",
    sql: `SELECT ps.saborId AS sabor_id, DATE(p.data) AS dia, SUM(ps.quantidade) AS unidades
            FROM producao_sabores ps
            JOIN producao p ON p.id = ps.producaoId
           GROUP BY ps.saborId, DATE(p.data)`,
  },
];
