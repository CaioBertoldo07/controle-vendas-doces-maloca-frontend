# Etapa 0.2 — Análise dos dados reais

**Data da coleta:** 29/09/2026
**Fonte:** dump somente leitura do MySQL de produção, restaurado localmente em `doces_maloca_restore_20260929_195116`
**Base:** `docs/tcc/auditoria-tecnica-inicial.md` e `docs/tcc/etapa-0-ambientes-e-baseline.md`
**Escopo:** medir volume e qualidade dos dados reais e reavaliar o MVP. Nenhum dado foi corrigido e nenhuma regra de negócio foi alterada. Nenhum agente foi implementado.

> Todos os números vêm da coleta sobre o backup real. Não há mistura com dados sintéticos de desenvolvimento. Nomes de clientes não aparecem neste relatório (só agregados). Nomes de sabores e de insumos aparecem porque são o catálogo do negócio.

---

## 1. Resumo executivo

| Pergunta | Resposta curta |
|---|---|
| Quanto histórico existe? | **7 meses**: vendas de 28/02/2026 a 29/09/2026 (**901 vendas, 21.177 unidades, R$ 114.356,19**); produção de 03/03/2026 a 27/09/2026 (**247 registros, 21.060 unidades**). |
| Os dados de venda são bons? | **Sim.** 0 vendas sem itens, 0 divergências entre total e itens, 93% das vendas a R$ 5,50/un. Anomalias pontuais: 1 data impossível (ano 0206) e 5 a 6 vendas com valor ≈ R$ 0. |
| O estoque acabado derivado é utilizável? | **Não, sem correção.** 7 dos 9 sabores têm saldo histórico negativo (−158 un. somados). Uma data de corte não resolve: ainda sobram 5 sabores negativos. |
| Qual a causa? | **Não é o histórico anterior ao controle de produção** (só 132 un. vendidas antes de 03/03). Produção e vendas andam quase 1:1 (**99,45%**), e o saldo derivado é dominado por pequenas lacunas de registro (~0,5% do volume). |
| Matéria-prima, receitas e MRP? | **Inexistentes na prática.** 0 receitas cadastradas, 3 insumos, 3 movimentações (todas entradas; nenhuma saída). 135 de 138 custos de "Matéria Prima" sem vínculo com insumo. |
| Pagamentos? | O período anterior a 14/08 é **sintético**: 727 de 727 vendas pagas com `dataPagamento = data`, padrão exato do backfill. Controle real: **174 vendas em 6,5 semanas**; 36 pendentes (R$ 4.963). |
| Automação existente? | `vendas_via_automacao = 0`: o canal n8n/`/vendas/auto` **nunca foi usado em produção**. |
| Recomendação para estoque | **Opção C: reconciliação por contagem física** (inventário de abertura real numa data D, e saldo derivado a partir de D), com o agente monitorando a divergência. |
| Recomendação para Inteligência | **Indicadores descritivos semanais/mensais**, média móvel, variação percentual, demanda média recente por sabor e por dia da semana. **Não** chamar de previsão; **sem** ML nem sazonalidade anual. |

**Mudanças em relação à auditoria:** o MVP continua de pé, mas o **Agente de Estoque perde a parte de insumos/MRP em dados reais** (não há receitas), e o saldo de produto acabado precisa de uma âncora física. A **premissa de histórico desde dez/2025 estava errada** para o banco de produção: as vendas começam em 28/02/2026. O Agente de Vendas e o de Inteligência têm base **melhor** do que o esperado: 32 semanas contínuas, sem semana vazia, e 90% dos clientes com recompra.

---

## 2. Procedimento de backup

| Passo | Comando / resultado |
|---|---|
| Local do banco | Railway, projeto `zestful-compassion`, serviço `MySQL`, acesso pelo proxy TCP `***.proxy.rlwy.net`, banco `railway`. Identificado sem ler variáveis: a porta do proxy confere com a linha `Datasource "db"` do log de build de 14/08 (evidência do risco já corrigido na 0.1). |
| Versão | `railway run ... -- node scripts/tcc/backupProducao.js versao` → **MySQL 9.7.2 Community**, fuso `SYSTEM` |
| Dump | `IMAGEM_MYSQL=mysql:9.7 railway run ... -- node scripts/tcc/backupProducao.js dump` → `backend/.coleta-tcc/backups/producao-20260929-194820.sql` (**184.730 bytes**) |
| Credenciais | Injetadas pelo `railway run` no processo; o script mostra só `***.proxy.rlwy.net:*****/railway`. Senha via `MYSQL_PWD`, nunca na linha de comando. |
| Operação | `mysqldump --single-transaction --quick --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF`: snapshot consistente, **sem LOCK TABLES, sem FLUSH, sem escrita** |
| Git | `git check-ignore` confirmou que o arquivo está ignorado; `git status` não mostra `.sql` |

**Validação do dump (antes do restore):**
- Cabeçalho `MySQL dump 10.13 Distrib 9.7.2`; rodapé `-- Dump completed on 2026-09-29 19:50:47`.
- 12 tabelas: as 11 do domínio + `_prisma_migrations`.
- Tuplas por tabela: vendas 901, venda_sabores 4.261, producao 247, producao_sabores 474, custos 155, clientes 60, sabores 9, usuarios 4, materias_primas 3, movimentacoes_materia_prima 3, receita_itens 0, _prisma_migrations 3.
- **Nenhuma** instrução `USE`, `CREATE/DROP DATABASE`, `GRANT`, `CREATE USER`, `SET GLOBAL`, `DELETE`, `UPDATE`, `TRUNCATE`, trigger, procedure ou evento. Os 12 `DROP TABLE IF EXISTS` são padrão do mysqldump e atuam só no banco de destino.

## 3. Procedimento de restauração

`npm run tcc:restaurar -- .coleta-tcc/backups/producao-20260929-194820.sql`

| Verificação | Resultado |
|---|---|
| Banco criado | **`doces_maloca_restore_20260929_195116`** (novo; o script aborta se já existir) |
| Tabelas | 12 |
| Bancos preservados | `doces_maloca_dev` e `doces_maloca_test` intactos. (`doces_maloca_restore_20260929_135352` é o teste sintético anterior; **não foi usado**.) |
| Leitura com `maloca` | `COUNT(*)`: 901 vendas, 4.261 itens, 247 produções (confere com o dump) |
| Escrita proposital com `maloca` | `UPDATE vendas SET desconto = desconto WHERE id = -1` → **ERROR 1142 (UPDATE denied)**; `CREATE TABLE teste_escrita` → **ERROR 1142 (CREATE denied)** |
| Permissões | `GRANT SELECT ON doces_maloca_restore_20260929_195116.* TO maloca` (apenas SELECT) |

## 4. Garantias de somente leitura

| Camada | Garantia |
|---|---|
| Produção | Único acesso: `SELECT VERSION()` e `mysqldump --single-transaction`. Sem Prisma, `db push`, migrations, seed ou backfill. |
| Restore | Banco novo e isolado; o usuário de coleta só tem `SELECT` (escrita negada pelo MySQL, erro 1142) |
| Coleta (`npm run tcc:coleta`) | Lê só `DATABASE_URL_COLETA` (host `127.0.0.1:3307`, banco restaurado); simulação executada antes; 34 consultas constantes validadas como `SELECT`; sessão `READ ONLY` confirmada; limite de 30 s por consulta |
| Consultas complementares (§22) | Executadas com o mesmo usuário `maloca` no banco restaurado (SELECT-only) |
| Saída | `backend/.coleta-tcc/` (ignorada pelo Git). Consultas privadas (nomes de clientes, séries por cliente e por dia) aparecem só como agregados. |

---

## 5. Volume geral

| Domínio | Registros | Período (datas plausíveis) | Observação |
|---|---|---|---|
| Vendas | 901 | 28/02/2026 → 29/09/2026 (213 dias) | +1 venda datada no ano **0206** |
| Itens de venda | 4.261 | — | 21.177 unidades |
| Produção | 247 (474 itens) | 03/03/2026 → 27/09/2026 (208 dias) | +1 produção datada no ano **0202** |
| Clientes | 60 | — | 52 com venda |
| Sabores | 9 | — | 7 ativos |
| Custos | 155 | 02/03/2026 → 23/09/2026 | R$ 32.112,99 |
| Matérias-primas | 3 | — | 3 movimentações (10–11/07/2026) |
| Receitas | **0** | — | — |
| Usuários | 4 | — | Não analisados (dados de acesso) |

**Datas impossíveis (erro de digitação provável; não corrigidas):**

| Registro | Data gravada | Conteúdo | Hipótese | Por quê |
|---|---|---|---|---|
| Venda id 11 (de 1–910) | 05/03/**0206** | 20 un. (Tradicional 7, Doce de Leite 6, Maracujá 3, Prestígio 3, Castanha 1), paga | 05/03/2026 | id baixo, entre as primeiras vendas |
| Produção id 247 (de 1–250) | 23/09/**0202** | 100 un. (Tradicional 50, Doce de Leite 50) | 23/09/2026 | id entre os mais recentes |

A ferramenta de análise trata datas fora de `[2025-01-01, hoje]` como implausíveis: elas entram nas contagens e na regra atual de estoque, mas **não** nas séries, períodos e intervalos (§22).

**Divergência com a auditoria:** a auditoria supôs vendas desde dez/2025, com base no `git log`. No banco de produção, a primeira venda plausível é de **28/02/2026**, e só 3 vendas são anteriores a 03/03. A tabela `_prisma_migrations` mostra 3 migrations de **02/12/2025** (`init`, `add_usuarios`, `add_sabores_e_valor`): o banco foi criado em dezembro, mas o uso real começa no fim de fevereiro. *Hipótese não verificada:* o histórico anterior pode ter ficado em outro ambiente (há outros projetos Railway com serviços `controle-vendas` e `MySQL`).

## 6. Vendas

| Indicador | Valor |
|---|---|
| Vendas / unidades / valor | 901 / 21.177 / R$ 114.356,19 (descontos: R$ 1.307, em 10 vendas) |
| Dias com venda | 185 de 214 dias corridos (**86,4%**) |
| Valor por venda | média **R$ 126,92**; mediana **R$ 110,00**; p25 R$ 99; p75 R$ 143; máx R$ 539; CV 0,51 |
| Unidades por venda | média 23,5; mediana 20; p25 18; p75 27; máx 216 |
| Preço por unidade | **838 vendas (93%) a R$ 5,50**; 32 a R$ 6,00; 20 a R$ 5,00; preço ponderado R$ 5,40 |
| Anomalias de valor | 4 vendas com valor < R$ 1 (mín. R$ 0,02) e 6 com preço < R$ 3/un. (0,7%) |
| Consistência | **0** vendas sem itens; **0** vendas com total ≠ soma dos itens |
| Venda Direta | 58 vendas, 591 unidades (**2,8%**) |
| Via automação (`idempotencyKey`) | **0** |

**Série mensal (unidades):** fev 66 (1 dia) · mar 3.315 · abr 2.903 · mai 3.174 · jun 3.307 · jul 3.104 · ago 2.832 · set 2.456 (até 29/09).
Variação: jul→ago **−8,8%**; ago→set **−10,3%** (setembro normalizado para 30 dias ≈ 2.541).

**Série semanal:** 32 semanas, **0 semanas sem venda**; mediana **707 un./semana**; p25 595; p75 779; CV **0,24** (baixa variabilidade; a semana mínima, 112, é a primeira, parcial).

**Dia da semana (vendas / unidades):** dom 21/320 · seg 167/3.777 · ter 177/4.549 · qua 69/2.020 · qui 178/3.910 · sex 204/4.794 · sáb 84/1.787. É um padrão de **rota de entrega**, com seg/ter/qui/sex fortes.

**Vendas por sabor (unidades, % do total):**

| Sabor | Unidades | % | Ativo |
|---|---|---|---|
| Tradicional | 7.086 | 33,5% | sim |
| Doce de Leite | 6.577 | 31,1% | sim |
| Maracujá | 2.816 | 13,3% | sim |
| Prestígio | 2.118 | 10,0% | sim |
| Castanha | 1.992 | 9,4% | sim |
| Amendoim | 392 | 1,9% | sim (desde 03/06) |
| Whey Protein | 128 | 0,6% | sim (desde 22/06) |
| Sabores Diversos | 58 | 0,3% | não |
| Cupuaçu | 10 | 0,05% | não |

**Antes × depois de 14/08/2026:** 727 vendas (R$ 91.601,69) antes; 174 vendas (R$ 22.754,50) depois. O volume por semana se mantém; a diferença está no pagamento (§13).

## 7. Clientes

| Indicador | Valor |
|---|---|
| Cadastrados / com venda / **sem venda** | 60 / 52 / **8** |
| Ativos nos últimos 90 dias | 46 |
| Vendas por cliente | mediana **11**; p25 7; p75 24,5; máx 60 |
| Unidades por cliente | mediana 283,5; máx 1.887 |
| **Recorrência** | **47 de 52 (90%)** com 2+ vendas; **40** compraram em 3+ meses distintos |
| Intervalo médio entre compras | mediana **13,2 dias** (p25 7,7; p75 20,9) |
| Sem compra há 60+ dias (em relação à última venda) | 8 |
| Concentração | top 5 clientes = **28,6%** das unidades |

**Ambiguidade para resolução textual** (mesma normalização do `resolverNomes.js`):

| Métrica | Valor | Leitura |
|---|---|---|
| Nomes duplicados após normalização | 0 | Sem duplicata literal |
| Pares em que um nome contém o outro | 1 par (2 clientes) | A regra "contém" pode trocar os dois |
| Grupos com a mesma primeira palavra | 8 grupos, **46 de 60 clientes (77%)**; maior grupo = 13 | Digitar só o tipo do estabelecimento (ex.: "Frutaria", "Panificadora") casa com vários e o resolver escolhe o primeiro, **em silêncio** |

## 8. Produção

| Indicador | Valor |
|---|---|
| Registros / itens / unidades | 247 / 474 / 21.060 (20.960 com data plausível + 100 no ano 0202) |
| Período | 03/03/2026 → 27/09/2026; **142 dias com produção** (1 deles é o dia implausível "0202") |
| Unidades por registro | média 85,3; máx 226 |
| Por mês (produção × venda) | mar 3.496 × 3.315 · abr 3.277 × 2.903 · mai 2.906 × 3.174 · jun 3.563 × 3.307 · jul 3.117 × 3.104 · ago 2.487 × 2.832 · set 2.114 (+100 do registro "0202") × 2.456 |
| **Produção / vendas acumuladas** | **99,45%** |
| Sabores vendidos sem nenhuma produção | **0** |
| Sabores produzidos sem receita | **9 de 9** (não há receitas) |

A produção é registrada de forma regular e acompanha as vendas. O negócio produz para vender, com pouco estoque parado.

## 9. Estoque acabado

`saldo = Σ produção − Σ vendas` por sabor (regra atual de `GET /api/estoque`):

| Sabor | Produzido | Vendido | **Saldo histórico** | Vendido antes de 03/03 | Saldo desde 03/03 | Inventário mínimo desde 03/03 |
|---|---|---|---|---|---|---|
| Tradicional | 7.030 | 7.086 | **−56** | 27 | −79 | 79 |
| Doce de Leite | 6.540 | 6.577 | **−37** | 27 | −60 | 60 |
| Maracujá | 2.782 | 2.816 | **−34** | 13 | −21 | 25 |
| Castanha | 1.980 | 1.992 | **−12** | 5 | −7 | 47 |
| Prestígio | 2.107 | 2.118 | **−11** | 14 | +3 | 26 |
| Whey Protein | 122 | 128 | **−6** | 0 | −6 | 13 |
| Sabores Diversos | 56 | 58 | **−2** | 46 | +44 | 10 |
| Amendoim | 433 | 392 | +41 | 0 | +41 | 0 |
| Cupuaçu | 10 | 10 | 0 | 0 | 0 | 0 |
| **Total** | **21.060** | **21.177** | **−117** (negativos: −158 em 7 sabores) | 132* | — | **260** |

\* 112 un. com data plausível + 20 un. da venda "0206". "Vendido antes de 03/03" por sabor inclui a venda "0206", porque na regra atual ela conta como anterior.

**Conclusões quantitativas:**
1. **Magnitude pequena em relação ao fluxo:** o déficit de −158 un. equivale a **0,75%** das unidades vendidas e a ~**0,2 semana** de vendas (mediana de 707/semana).
2. **As vendas anteriores a 03/03 explicam pouco:** são 132 un. Excluí-las (corte em 03/03) **não** zera os negativos: continuam 5 sabores negativos (−173 no total), porque o corte também descarta a produção "0202".
3. **Sensibilidade às duas datas impossíveis (hipótese):** se o gestor corrigir a venda para 05/03/2026 e a produção para 23/09/2026, o corte em 03/03 fica com **5 sabores negativos somando −90** (Tradicional −36, Maracujá −24, Doce de Leite −16, Castanha −8, Whey −6).
4. **A causa dominante é contínua, não histórica:** pequenas lacunas de registro de produção ao longo de todo o período. Por exemplo, Whey Protein começou em junho e já está −6.
5. **Inventário mínimo:** 260 un. no total evitariam qualquer dia negativo desde 03/03 (≈ 2,6 dias de venda). É um número **calculado para esconder a lacuna**, não uma medição.

## 10. Matéria-prima

| Indicador | Valor |
|---|---|
| Itens | 3 (Açúcar e Coco em `g`; Leite Condensado em `un`) |
| Entradas | 3 (10 a 11/07/2026, origem CUSTO): Açúcar 10.000 g, Coco 20.000 g, Leite Condensado 12 un. |
| Saídas | **0**. Nenhuma produção consumiu insumo, porque não há receitas. |
| Ajustes | 0 |
| Saldos | 10.000 g / 20.000 g / 12 un. (nenhum negativo; 1 "saldo baixo" pela regra fixa < 200, o Leite Condensado com 12 un.) |
| Itens sem movimento | 0 |
| Anomalias de conversão | 0 nos 3 custos vinculados (kg→g e un→un). Os 152 **não vinculados** usam unidades variadas (kg 84, un 57, g 6, pct 2, cx 2, L 1). `pct` e `cx` nunca são convertidas, e `un` só é coerente com insumo em `un`. Seriam problema se fossem vinculados sem revisão. |

O módulo de matéria-prima foi **testado em julho e não entrou no uso diário**. Os saldos não refletem o estoque real (nunca houve saída).

## 11. Receitas

| Indicador | Valor |
|---|---|
| Sabores | 9 (7 ativos) |
| Com receita | **0** |
| Com `rendimentoBase` | **0** |
| Itens por receita | — |

Consequência: `calcularNecessidades` sempre cai no `continue` (`producaoController.js:36`), e nenhuma produção valida nem baixa insumo.

## 12. Custos

| Indicador | Valor |
|---|---|
| Custos / valor | 155 / **R$ 32.112,99** (02/03 → 23/09/2026) |
| Por categoria | Matéria Prima 138 (R$ 28.082,67) · Outros 11 (R$ 3.472,00) · Embalagem 6 (R$ 558,32) |
| Vinculados a matéria-prima | **3** (1,9%); "Matéria Prima" sem vínculo: **135** |
| Unidades | kg 86 · un 58 · g 6 · pct 2 · cx 2 · L 1 |
| Série mensal | mar 5.123 · abr 4.379 · mai 4.570 · jun 5.531 · jul 5.495 · ago 4.536 · set 2.479 (parcial) |

**Custo por sabor:** **impossível** com os dados atuais: 0 receitas e custos quase todos sem vínculo.
**O que é possível:** custo **agregado**. Custos / unidades vendidas = **R$ 1,52 por unidade** ≈ **28,1%** da receita bruta (R$ 114.356). Também é possível custo mensal × faturamento mensal. É margem agregada, **não** por sabor.

## 13. Pagamentos

| Período | Vendas | Pagas | Pendentes | Pagas com `dataPagamento = data` | Pagas com `dataPagamento ≠ data` |
|---|---|---|---|---|---|
| Antes de 14/08 | 727 (R$ 91.601,69) | 727 (100%) | 0 | **727 (100%)** | 0 |
| Desde 14/08 | 174 (R$ 22.754,50) | 138 (79,3%) | **36 (R$ 4.963)** | 0 | 138 |

- **Pendentes por idade:** 0–7 dias: 22 (R$ 2.987) · 8–30: 8 (R$ 1.133) · 31–60: 6 (R$ 843).
- **Prazo médio registrado** (desde 14/08): **4,2 dias**.
- **Registro em lote:** 36 pagamentos foram marcados em 29/09 e 21 em 10/09. A `dataPagamento` reflete **quando o gestor marcou**, não necessariamente quando recebeu.

### Backfill: evidência × inferência

| Tipo | Conteúdo |
|---|---|
| **Evidência direta de execução** | **Nenhuma disponível.** O banco não tem log de auditoria. O script roda na máquina do desenvolvedor via proxy, então não gera log de serviço no Railway. Não houve registro de execução acessível nesta etapa. |
| **Dados compatíveis com o resultado esperado** | (1) **727 de 727** vendas anteriores a 14/08 estão pagas com `dataPagamento` **exatamente igual** a `data`, o que é o efeito de `SET pago = true, dataPagamento = data`. (2) Isso inclui a venda do ano "0206", cuja `dataPagamento` também é "0206", ou seja, uma cópia literal da data. (3) Fronteira nítida: a última venda com `dataPagamento = data` é de 13/08 19:04, e o primeiro pagamento manual é de 14/08 16:59, dia do deploy do controle de pagamento. (4) Depois de 14/08, 0 vendas têm `dataPagamento = data`. |
| **Explicação alternativa** | Marcação manual pela UI grava `dataPagamento = agora` (`vendasController.js:345-349`), o que torna 727 igualdades exatas praticamente impossíveis. |
| **Conclusão** | **Os dados são fortemente compatíveis com a execução do backfill** (corte em 13 ou 14/08). Não há evidência direta. A confirmação cabe a quem executou. |

**Implicação:** o status "pago" anterior a 14/08 é **sintético** e não serve para analisar comportamento de pagamento. A análise de recebíveis só vale **a partir de 14/08/2026** (6,5 semanas).

---

## 14. Qualidade dos dados

| Conjunto | Classificação | Justificativa (números reais) |
|---|---|---|
| **Vendas** | `CONFIÁVEL` | 901 registros em 7 meses contínuos (0 semanas vazias); 0 vendas sem itens; 0 divergências total × itens; 93% a R$ 5,50/un. Anomalias identificáveis e isoladas: 1 data impossível (0,1%) e 6 vendas com preço < R$ 3/un. (0,7%). |
| **Vendas por sabor** | `CONFIÁVEL` | 4.261 itens cuja soma bate 100% com os totais; todos os sabores vendidos têm produção. Ressalva: não há preço por item. A receita por sabor é **estimada** (93% das vendas a preço de tabela, então o erro é pequeno); a quantidade por sabor é exata. |
| **Pagamentos** | `UTILIZÁVEL COM RESSALVAS` | Antes de 14/08: 727 de 727 com padrão de backfill (sintético). Real: só 174 vendas / 6,5 semanas; `dataPagamento` = data de marcação, com lotes (36 num dia). Serve para a **situação atual** (36 pendentes, aging), não para comportamento histórico. |
| **Produção** | `UTILIZÁVEL COM RESSALVAS` | 247 registros em 142 dias, acompanha as vendas (99,45%). Ressalvas: 1 data impossível (100 un.); déficit contínuo pequeno em relação às vendas; nenhuma ligação com insumos. |
| **Estoque acabado** | `INADEQUADO SEM CORREÇÃO` | 7 de 9 sabores com saldo negativo (−158); com qualquer data de corte testada restam 5 a 7 negativos; sem âncora física. O saldo derivado mede lacuna de registro, não estoque. |
| **Matéria-prima** | `INADEQUADO SEM CORREÇÃO` | 3 itens, 3 entradas, **0 saídas**; saldo nunca consumido; 135 compras de MP fora do módulo. |
| **Receitas** | `INADEQUADO SEM CORREÇÃO` | **0 de 9** sabores com receita ou rendimento. |
| **Custos** | `UTILIZÁVEL COM RESSALVAS` | 155 registros em 7 meses, categorizados; servem para custo agregado (R$ 1,52/un.; 28,1% da receita). Não servem para custo por sabor (3 vinculados; 6 unidades diferentes). |
| **Clientes** | `CONFIÁVEL` | 52 de 60 com venda, recorrência mensurável (90% recompram, intervalo mediano de 13,2 dias). Ressalva só para **resolução textual**: 77% compartilham a primeira palavra com outro cliente. |

## 15. Simulações de data de corte

`saldo(corte) = Σ produção(dia ≥ corte) − Σ vendas(dia ≥ corte)`. *Inventário mínimo* = menor estoque inicial que evitaria qualquer dia negativo depois do corte (produção do dia contada antes das vendas do dia).

| Corte | Produzido | Vendido | Sabores negativos | Soma dos negativos | Sabores negativos em algum dia | Inventário mínimo total |
|---|---|---|---|---|---|---|
| Sem corte (regra atual) | 21.060 | 21.177 | 7 | −158 | 7 | 292 |
| **03/03/2026** (início da produção) | 20.960 | 21.045 | 5 | −173 | 7 | **260** |
| 03/03/2026 + 2 datas corrigidas (hipótese) | 21.060 | 21.065 | 5 | −90 | — | — |
| 15/04/2026 (módulo de estoque/MP) | 16.017 | 16.483 | 7 | −507 | 7 | 573 |
| 01/06/2026 | 11.281 | 11.699 | 5 | −471 | 6 | 525 |
| 14/08/2026 (controle de pagamento) | 3.474 | 4.141 | 6 | −667 | 6 | 716 |

Leituras:
- **Nenhuma data de corte elimina os negativos.**
- **Cortes posteriores pioram o resultado.** Eles descartam produção feita antes do corte cujo produto foi vendido depois (o negócio carrega alguns dias de estoque). Por isso qualquer corte precisa de um **saldo inicial na data do corte**.
- **03/03 é o corte com menor dano**, e ainda assim exige ~260 un. de saldo inicial calculado.

---

## 16. Impacto no Agente de Estoque

| Pergunta | Resposta |
|---|---|
| Dados suficientes? | **Para produto acabado, sim em fluxo** (produção e vendas diárias por sabor em 7 meses). **Para insumos, não** (0 receitas, 0 saídas). |
| Estoque acabado utilizável? | **Não como número absoluto**, sem uma âncora física (§20). Utilizável como fluxo: ritmo de produção × venda. |
| Precisa de data de corte? | Sim, mas **junto com uma contagem física** naquela data; o corte sozinho não resolve (§15). |
| Matéria-prima confiável? | **Não.** Alertas de insumo e sugestão de compra via receita **não são honestos com os dados reais**. |

**Alertas implementáveis honestamente:**
1. **Divergência de registro:** sabor com saldo derivado negativo ("vendido mais do que produzido desde a reconciliação").
2. **Ritmo:** produção do sabor nos últimos N dias abaixo das vendas do mesmo período.
3. **Cobertura em dias**, só **depois** da contagem física: saldo ÷ venda média diária do sabor.
4. **Qualidade de dados:** registros com data implausível; sabores ativos sem receita; custo de "Matéria Prima" sem vínculo.
5. **Sugestão de produção por sabor** (quantidade de doces, **sem** insumos): demanda média recente − saldo reconciliado.

**Fora do MVP com dados reais:** MRP de insumos, alertas de insumo baixo, lista de compras. Se for mostrado na avaliação, deve ser **cenário sintético rotulado como tal**, ou depender de o gestor cadastrar receitas e passar a vincular custos (decisão operacional dele).

## 17. Impacto no Agente de Vendas

| Pergunta | Resposta |
|---|---|
| Histórico suficiente? | **Sim para análises descritivas**: 901 vendas, 32 semanas, 52 clientes. |
| Ranking significativo? | **Sim.** 7 sabores ativos, forte concentração (Tradicional + Doce de Leite = 64,5%); ranking por período (semana/mês) estável. |
| Clientes inativos/recorrentes fazem sentido? | **Sim, é o ponto mais forte.** 90% recompram; intervalo mediano de 13 dias; é possível alertar "cliente X está há Y dias sem comprar, o dobro do seu intervalo habitual". 8 clientes sem compra há 60+ dias já são casos reais. |
| Contas a receber? | **Sim, para a situação atual**: 36 pendentes, R$ 4.963, aging por faixa. **Não** para histórico nem para prazo real de recebimento (lotes de marcação). |

**Análises não confiáveis:** comportamento de pagamento antes de 14/08; receita exata por sabor (sem preço por item); sazonalidade anual; ticket por canal (a Venda Direta é só 2,8% e é identificada pelo nome do cliente).
**Escrita por texto (rascunho de venda):** exige **desambiguação obrigatória**, porque 77% dos clientes compartilham a primeira palavra.

## 18. Impacto no Agente de Inteligência

| Pergunta | Resposta |
|---|---|
| Dados para tendência? | Sim para **tendência recente**: 32 semanas contínuas e 7 meses completos (mar–set). Não para tendência de longo prazo. |
| Granularidade defensável | **Semanal** (principal) e **mensal** (resumo). A diária é ruidosa por causa do padrão de rota (qua/sáb/dom baixos); se usada, só com perfil por dia da semana. |
| Médias móveis? | **Sim.** Média móvel de 4 semanas por sabor e total (CV semanal de 0,24 indica série estável). |
| Base para "demanda estimada"? | **Sim, como "demanda média recente"** (média móvel por sabor, perfil por dia da semana). Serve à cobertura e à sugestão de produção. |
| Evitar "previsão"? | **Sim.** Com menos de 1 ano não há sazonalidade anual; não haverá validação estatística de erro. Use "estimativa baseada na média recente". |

## 19. Impacto no Agente de Atendimento

**Conclusão mantida: interface conversacional do gestor.** Os dados reforçam isso:
- `vendas_via_automacao = 0`: o canal n8n/`/vendas/auto` nunca operou em produção;
- `Cliente` só tem nome; os clientes são estabelecimentos B2B; não existe canal com o cliente final;
- a entrada de venda por texto é arriscada sem desambiguação (77% de colisão pela primeira palavra), o que confirma o papel de interface que **propõe** ações para o gestor aprovar.

## 20. Decisão recomendada para estoque

| Opção | Como | Prós | Contras (com números) |
|---|---|---|---|
| **A — Data de corte** | Ignorar movimentos antes de D | Simples, sem dado novo | **Não resolve:** mesmo em 03/03 restam 5 sabores negativos (−173). Cortes mais tardios pioram (−471 a −667). |
| **B — Inventário inicial calculado** | Saldo inicial = mínimo que evita negativos (260 un. desde 03/03) | Elimina os negativos | **Fabrica estoque** para esconder lacunas; não é uma medição; academicamente frágil. |
| **C — Reconciliação por contagem física** *(recomendada)* | O gestor conta o estoque real por sabor numa data D (ativação do agente). Saldo = contagem(D) + produção(> D) − vendas(> D). O agente monitora a divergência e pede nova contagem quando ela passa de um limiar. | Âncora real; honesta; a divergência vira **indicador de qualidade de registro** e alerta útil; barata (7 sabores ativos, estoque de poucos dias) | Exige uma ação do gestor; precisa de uma representação explícita (tabela aditiva de contagem/ajuste), a decidir na Etapa 1 |

**Recomendação para o MVP: C.** O histórico completo continua sendo usado para **fluxo** (demanda, ritmo, ranking). O **saldo absoluto** passa a existir só a partir da primeira contagem física. Enquanto ela não acontece, o agente fala em "divergência" e "ritmo", nunca em "estoque disponível".

## 21. Escopo final recomendado do MVP

| Agente | Mantém | Ajusta | Remove / condiciona |
|---|---|---|---|
| **Estoque** | Alertas de divergência e de ritmo; sugestão de produção por sabor | Saldo absoluto só após a contagem física (C); cobertura só após C | **MRP de insumos, alertas de insumo e lista de compras** (sem receitas); só em cenário sintético rotulado |
| **Vendas** | Ranking por sabor e período; clientes inativos pelo intervalo habitual; recebíveis pendentes e aging | Recebíveis apenas desde 14/08; rascunho de venda com desambiguação obrigatória | Prazo real de recebimento; receita exata por sabor |
| **Inteligência** | Indicadores descritivos semanais e mensais; MM4 semanas; variação %; tendência recente (últimas 4–8 semanas × anteriores); demanda média por sabor e por dia da semana; custo agregado por unidade (R$ 1,52) e custo/receita mensal | "Demanda média recente" em vez de "previsão"; custo agregado em vez de custo por sabor | Previsão estatística, ML, sazonalidade anual, forecast de longo prazo, margem por sabor |
| **Atendimento** | Interface conversacional do gestor; propõe ações para aprovação | — | Atendimento ao cliente final; canal WhatsApp em produção |
| **Coordenador** | Roteamento e agregação | — | — |

**O que o TCC pode defender:** indicadores descritivos, médias móveis, variação percentual, tendência recente, consumo (venda) médio por sabor, cobertura em dias (após a reconciliação) e demanda média histórica.
**O que não pode defender:** previsão robusta, machine learning, sazonalidade estatística anual, forecast de longo prazo, custo e margem por sabor.

## 22. Riscos e pendências

| # | Item | Tipo | Observação |
|---|---|---|---|
| P1 | 2 registros com ano impossível (venda id 11, produção id 247) | Dado | **Não corrigido.** Correção cabe ao gestor pela UI; afeta levemente o estoque (§9, item 3) |
| P2 | 4–6 vendas com valor ≈ R$ 0 | Dado | Verificar com o gestor se são brindes, trocas ou erro |
| P3 | Receitas e vínculos de custo inexistentes | Operação | Sem isso, não há MRP real; decisão do gestor |
| P4 | Contagem física para a Opção C | Operação | Necessária antes de o Agente de Estoque falar em "estoque disponível" |
| P5 | `_prisma_migrations` com 3 migrations de dez/2025 | Técnico | Reconciliar antes de qualquer adoção de migrations (doc da 0.1 corrigido) |
| P6 | Log de deploy anuncia CORS para `localhost:5173`, mas o código usa `origin: true` | Técnico (deploy) | Mensagem enganosa em `server.js`; **não alterado** |
| P7 | Logs de produção com objetos de venda (`console.log("✅ Venda criada:", venda)`, com nome do cliente) | Técnico/privacidade | **Não alterado**; tratar junto com logging estruturado |
| P8 | `npm install` reporta vulnerabilidades | Técnico | **`npm audit fix` não executado**; avaliar em etapa própria |
| P9 | Dump e bancos restaurados contêm dados reais (inclusive 4 hashes de senha de usuários) | Segurança | Ficam só localmente, em pasta ignorada pelo Git; apagar ao fim do TCC ou guardar criptografado |
| P10 | Histórico anterior a 28/02/2026 ausente do banco de produção | Escopo | Hipótese (não verificada): ficou em outro ambiente |
| P11 | Fuso horário (hora local gravada como UTC) | Técnico | Afeta agregações por dia/semana nas bordas; decidir na Etapa 0.5 |

## 23. Evidências

**Arquivos gerados (locais, ignorados pelo Git):**
- `backend/.coleta-tcc/backups/producao-20260929-194820.sql`: dump somente leitura (184.730 bytes).
- `backend/.coleta-tcc/coleta-2026-09-29T19-53-28-656Z.md` / `.json`: coleta usada neste relatório.
- `backend/.coleta-tcc/coleta-2026-09-29T19-51-46-631Z.*`: coleta anterior, afetada pelo bug de datas implausíveis (descartada; mantida só como evidência do bug).
- Banco local `doces_maloca_restore_20260929_195116`.

**Ferramentas ajustadas nesta etapa (só ferramentas da 0.2; nenhum código de domínio):**

| Arquivo | Ajuste |
|---|---|
| `backend/scripts/tcc/consultasColeta.js` | +14 consultas (de 20 para 34): 8 agregadas (pagamentos, unidades, receitas, custo por insumo) e 6 **privadas** (insumo da análise, não gravadas); `materias_primas_saldo` passou a detalhar entradas, saídas e ajustes |
| `backend/scripts/tcc/analiseColeta.js` (novo) | Análise pura: estatísticas, séries, recorrência, ambiguidade, simulações de corte, custo de receita, pagamentos. **Correção de bug revelado pelos dados reais:** datas fora de `[2025-01-01, hoje]` quebravam as séries (o relatório tinha 318 KB e 21.847 "meses"); agora são contadas à parte. |
| `backend/scripts/tcc/analiseColeta.test.js` (novo) | 7 testes (inclui regressão das datas implausíveis e garantia de que nomes de clientes não vazam) |
| `backend/scripts/tcc/coletarDadosReadOnly.js` | Usa `analisar()`; omite consultas privadas da saída; renderização de seções |
| `backend/scripts/tcc/backupProducao.js` (novo) | Dump via `railway run`, credenciais mascaradas; imagem padrão `mysql:9.7` (versão do servidor) |
| `backend/scripts/tcc/restaurarBackupLocal.js` (novo) | Restore em banco novo, com recusas de segurança e usuário SELECT-only |
| `backend/package.json` | Script `tcc:restaurar` |
| `docs/tcc/etapa-0-ambientes-e-baseline.md` | Correção factual sobre `prisma migrate` (P5) |

**Testes:** `npm run test:guardas` → **27/27** passando.

**Consultas complementares** (usuário `maloca`, SELECT-only, banco restaurado): datas implausíveis (sem nomes), `_prisma_migrations`, distribuição do preço por unidade, parcela da Venda Direta, contagem de usuários, vendas por dia da semana e tamanho médio dos registros de produção. Os resultados estão nas seções 5 a 8.
