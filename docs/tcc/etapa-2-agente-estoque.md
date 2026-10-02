# Etapa 2 — Agente de Estoque

**Data:** 01/10/2026 (revisado em 02/10/2026: `CONTAGEM_FISICA` deixou de ser resolvida automaticamente, §13; conferência somente leitura com a cópia real, §16.1)
**Base:** Etapa 0.2 (análise dos dados reais), Etapa 0.5 (política temporal), Etapa 1 (infraestrutura SMA)
**Branch de trabalho:** `feat/etapa-2-agente-estoque`, a partir de `9dfeefe` (commit da Etapa 1). **Sem commit**, aguardando revisão. Sem push e sem deploy.

---

## 1. Objetivo

Transformar o stub `estoque` no **primeiro agente funcional** do SMA. O agente analisa de forma **determinística** a situação de estoque e produção, gera alertas e recomendações e participa da infraestrutura da Etapa 1: tools, auditoria, recomendações e execução pela API.

A regra que guia a etapa: **o agente não finge ter dados que não existem.**

```text
dado confiável                 → análise
dado utilizável com ressalvas  → análise + aviso explícito
dado inadequado                → nenhuma conclusão operacional como se fosse confiável
```

## 2. Limitações reais dos dados

Estas limitações vêm da Etapa 0.2 e o agente as respeita explicitamente:

| Dado | Situação real | Como o agente trata |
|---|---|---|
| Estoque acabado | Saldo = produção − vendas de todo o histórico; **7 de 9 sabores negativos**; sem data de corte que elimine as divergências; nunca houve contagem física | `SALDO_CONTABIL_HISTORICO`, confiabilidade **`NAO_RECONCILIADO`**. Saldo negativo vira alerta de **divergência**, não afirmação sobre o estoque físico. Recomenda **contagem física** (Opção C da 0.2) |
| Matéria-prima | 3 cadastradas; saldo = soma de movimentações (3 no total), sem conferência física | Confiabilidade no máximo `UTILIZAVEL_COM_RESSALVAS`. Analisa só saldo negativo e ausência de movimentação. O limiar fixo legado de "saldo baixo" (< 200) é ignorado |
| Receitas | **0 cadastradas** | MRP **`INDISPONIVEL_POR_DADOS`** (`RECEITAS_NAO_CADASTRADAS`), nunca "sem necessidade de insumos". Recomenda o cadastro |
| Vendas e produção por período | Histórico suficiente | Comparação de **ritmo recente** (7 e 30 dias). São fluxos do período, não dependem do saldo histórico |
| Estoque mínimo, lead time, fornecedor, cobertura | **Inexistentes** | Nunca calculados nem inventados. Um teste garante que a saída não tem nenhum campo assim |

> **O agente não considera o saldo histórico de produto acabado como representação confiável do estoque físico antes da reconciliação por contagem.**

> **A ausência de receitas torna o MRP indisponível com os dados reais atuais; o agente trata isso como ausência de informação, não como necessidade zero.**

## 3. Responsabilidades

| Faz | Não faz (nesta etapa) |
|---|---|
| Diagnosticar a qualidade dos dados por funcionalidade | Previsão, regressão, sazonalidade, ML |
| Classificar o saldo histórico por sabor e apontar divergências | Afirmar estoque físico |
| Analisar a matéria-prima dentro do que os dados permitem | Estoque mínimo, cobertura em dias, lista de compras |
| Detectar a falta de receitas e a indisponibilidade do MRP | Cadastrar receitas, reconciliar ou fazer inventário |
| Simular o MRP **quando há receita** (prova técnica com receita sintética) | Propor `AcaoProposta` (estoque não reconciliado, sem demanda da Inteligência, sem receitas reais) |
| Comparar o ritmo produção × vendas (7 e 30 dias) | Cooperar com a Inteligência (só o contrato foi preparado) |
| Gerar e manter recomendações deduplicadas | Usar LLM na análise |

## 4. Arquitetura

```text
POST /api/agentes/estoque/executar { tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia? } }
 → runtime (ExecucaoAgente) → agente estoque (agentes/estoque/index.js)
     → analisarEstoque(contexto)                      (analise.js; futura entrada de cron/eventos)
         ├─ contexto.usarTool(...)  ×5 (ou ×6 com MRP) → services → Prisma   [ChamadaTool com resumo]
         ├─ regras.js (funções PURAS: diagnóstico, alertas, prioridades, recomendações)
         ├─ contexto.registrarRecomendacao(...)         → Recomendacao (deduplicada por chave)
         └─ contexto.encerrarRecomendacoesAusentes(...) → resolução automática
```

| Arquivo | Papel |
|---|---|
| `src/agents/agentes/estoque/regras.js` | Regras **puras e determinísticas**, com limiares nomeados (`LIMITES`), taxonomia de alertas e recomendações. Sem banco, tools ou LLM |
| `src/agents/agentes/estoque/analise.js` | `analisarEstoque(contexto, { dataReferencia })`: orquestra as tools, aplica as regras e persiste as recomendações. **Função única** que o cron e os eventos `VENDA_REGISTRADA` / `PRODUCAO_REGISTRADA` vão chamar no futuro (hoje: só a execução manual) |
| `src/agents/agentes/estoque/index.js` | O agente: `ANALISAR_ESTOQUE` (análise real), `DIAGNOSTICO` (verificação técnica usada pelo Coordenador), `PING`, `PERGUNTA` (LLM; só com provedor, hoje só nos testes) |
| `src/agents/runtime/recomendacoes.js` | Ciclo de vida e deduplicação das recomendações (§12–13) |
| `src/agents/contratos/demandaMedia.js` | Contrato `DEMANDA_MEDIA` Estoque → Inteligência, **não usado** nesta etapa (§23) |

O agente só fala pelo `contexto`. A verificação estática de arquitetura passou a varrer **subpastas** e confirma que o agente não importa Prisma, services, controllers nem o executor de ações. Ele importa só `lib/periodos.js` (utilitários puros de data) e `lib/erros.js`.

## 5. Tools utilizadas

| Tool | Nova? | Service | Uso pelo agente |
|---|---|---|---|
| `consultarEstoqueAcabado` | — | `estoqueService.obterEstoqueAcabado` | Saldo contábil por sabor |
| `consultarSaldoMateriasPrimas` | **alterada** | `materiaPrimaService.resumoMateriasPrimasDetalhado` (novo) | Saldo calculado, **nº de movimentações** e última movimentação; o sinalizador antigo passou a se chamar **`saldoBaixoLegado`** |
| `consultarReceitas` | **nova** | `saboresService.listarReceitas` (novo; **1 consulta** para todos os sabores, sem N+1) | Receita utilizável por sabor ativo |
| `consultarProducaoVendasPeriodo` | **nova** | `producaoService.compararProducaoVendasPorSabor` (novo; `groupBy`) | Produzido × vendido por sabor numa janela de dias civis |
| `calcularNecessidadesProducao` | — | `producaoService.calcularNecessidades` + `verificarFaltantes` | Só quando o MRP está disponível (simulação técnica) |

As tools com dados potencialmente grandes ganharam `resumir(dados)`: a **auditoria** (`ChamadaTool.saida`) guarda contagens e totais, e não o dataset. Por exemplo, `consultarEstoqueAcabado` guarda `{ sabores, negativos, totalProduzido, totalVendido, totalSaldo }`.

## 6. Diagnóstico do estoque acabado

Cada sabor recebe uma situação `POSITIVO`, `ZERADO` ou `NEGATIVO`, e a natureza do valor fica sempre explícita:

```json
{ "natureza": "SALDO_CONTABIL_HISTORICO",
  "aviso": "Saldo calculado como produção − vendas de todo o histórico. Não representa o estoque físico: ainda não houve reconciliação por contagem física.",
  "contagem": { "sabores": 9, "positivos": …, "zerados": …, "negativos": … } }
```

Alertas por sabor:
- **`SALDO_NEGATIVO`** (MEDIA): fala em divergência e exige reconciliação, nunca em "estoque de −20";
- **`DIVERGENCIA_ESTOQUE`/`VENDA_SEM_PRODUCAO`** (MEDIA): há vendas e nenhuma produção registrada. Substitui o `SALDO_NEGATIVO` para não duplicar o alerta;
- **`DIVERGENCIA_ESTOQUE`/`SALDO_ACUMULADO_ALTO`** (BAIXA): saldo ≥ 50 unidades **e** ≥ 20% de tudo o que foi produzido, o que sugere vendas ou perdas não registradas.

Alerta de sistema:
- **`DADOS_ESTOQUE_NAO_RECONCILIADOS`**: emitido sempre que há sabores; BAIXA sem divergência, MEDIA com divergência.

## 7. Matéria-prima

| Situação | Alerta | Prioridade |
|---|---|---|
| Saldo calculado < 0 (fisicamente impossível) | `MATERIA_PRIMA_NEGATIVA` | **ALTA** |
| Cadastrada sem nenhuma movimentação | `MATERIA_PRIMA_SEM_MOVIMENTO` | BAIXA |
| Saldo entre 0 e 200 ("baixo" no legado) | — (**ignorado**: não existe estoque mínimo) | — |
| Nenhuma matéria-prima cadastrada | — (qualidade `INDISPONIVEL`, `SEM_MATERIAS_PRIMAS_CADASTRADAS`) | — |

## 8. Receitas e MRP

| Situação | Estado do MRP | Alertas |
|---|---|---|
| Nenhum sabor ativo | `INDISPONIVEL_POR_DADOS` / `SEM_SABORES_ATIVOS` | — |
| Nenhuma receita utilizável (**dados reais**) | `INDISPONIVEL_POR_DADOS` / `RECEITAS_NAO_CADASTRADAS` | `RECEITA_AUSENTE` por sabor + `MRP_INDISPONIVEL` |
| Algumas receitas | `PARCIAL` (`saboresSemReceita` listados) | `RECEITA_AUSENTE` dos que faltam |
| Todas as receitas | `DISPONIVEL` | — |
| Falha ao consultar receitas | `INDISPONIVEL_POR_FALHA` | — |

Uma receita é **utilizável** quando tem `rendimentoBase > 0` e pelo menos 1 item.

**Simulação técnica do MRP.** Só existe quando o MRP está disponível. A base é a reposição do **volume vendido nos últimos 30 dias** dos sabores com receita, que é ritmo recente e não previsão. Chama `calcularNecessidadesProducao` e devolve `natureza: "SIMULACAO_TECNICA"` com o aviso "Não é lista de compras". Se o saldo calculado não cobre o volume, gera `MATERIA_PRIMA_INSUFICIENTE` (MEDIA). Com os dados reais, a simulação **não roda** (`executada: false`, `RECEITAS_NAO_CADASTRADAS`).

## 9. Modo degradado

Quando falta dado ou uma tool falha, **a análise continua**:
- a seção fica indisponível e o motivo é informado;
- `resumo.modoDegradado` vira `true`;
- `falhasDeConsulta` lista a tool e o código;
- **nenhuma conclusão** é tirada sobre a seção.

Exemplo real dos testes: com `consultarReceitas` falhando, o MRP fica `INDISPONIVEL_POR_FALHA`. A recomendação `CADASTRAR_RECEITAS` que já estava aberta **não** é resolvida automaticamente, porque só se avaliam (e se resolvem) os tipos cujos dados estavam disponíveis (`tiposAvaliados`).

O agente funciona **sem LLM**: a análise operacional é inteiramente determinística.

## 10. Regras de alerta

São **10 tipos** e cada limiar é uma constante nomeada em `LIMITES`, com teste nas fronteiras:

| Tipo | Regra | Prioridade |
|---|---|---|
| `SALDO_NEGATIVO` | saldo histórico < 0 e produção > 0 | MEDIA |
| `DIVERGENCIA_ESTOQUE` / `VENDA_SEM_PRODUCAO` | vendido > 0 e produzido = 0 | MEDIA |
| `DIVERGENCIA_ESTOQUE` / `SALDO_ACUMULADO_ALTO` | saldo ≥ **50** un **e** ≥ **20%** do produzido | BAIXA |
| `DADOS_ESTOQUE_NAO_RECONCILIADOS` | há sabores com saldo (sempre, até existir contagem) | BAIXA; MEDIA se houver divergência |
| `MATERIA_PRIMA_NEGATIVA` | saldo calculado < 0 | ALTA |
| `MATERIA_PRIMA_SEM_MOVIMENTO` | 0 movimentações | BAIXA |
| `RECEITA_AUSENTE` | sabor ativo sem receita utilizável | MEDIA |
| `MRP_INDISPONIVEL` | nenhuma receita utilizável | MEDIA |
| `MATERIA_PRIMA_INSUFICIENTE` | simulação técnica com faltantes (só com MRP disponível) | MEDIA |
| `RITMO_PRODUCAO_ABAIXO_VENDAS` | 30 dias: vendido ≥ **20** e produzido/vendido < **0,9** | MEDIA se a janela de 7 dias confirmar (vendido ≥ 5 e razão < 0,9); senão BAIXA |
| `RITMO_PRODUCAO_ACIMA_VENDAS` | 30 dias: produzido ≥ **20** e (vendido = 0 ou razão > **1,5**) | BAIXA |

Justificativa dos limiares:
- **0,9:** os 10% absorvem a defasagem entre o dia de produzir e o de vender.
- **1,5:** excesso relevante para um produto de giro rápido.
- **20 e 5 vendas:** volume mínimo para não alertar sabores de baixo giro por ruído.
- **50 un e 20%:** saldo acumulado ao mesmo tempo grande e desproporcional ao produzido.

Todos são **parâmetros iniciais documentados**, revisáveis quando o estoque mínimo e os parâmetros editáveis existirem (Etapa 3+).

## 11. Prioridades

As prioridades são definidas **por regra, nunca por LLM**:
- **ALTA:** estado fisicamente impossível ou dado que o próprio negócio usa para decidir (matéria-prima negativa; contagem física quando **mais da metade** dos sabores com movimento está divergente);
- **MEDIA:** divergência ou falta de informação que bloqueia uma funcionalidade (saldo negativo, venda sem produção, receita ausente, MRP indisponível, insumo insuficiente na simulação, ritmo abaixo confirmado nas duas janelas);
- **BAIXA:** sinal a observar (saldo acumulado alto, matéria-prima sem movimento, ritmo só na janela longa, produção acima das vendas).

Os alertas saem ordenados por prioridade.

## 12. Recomendações

São geradas **por regra**, com texto determinístico, só onde há uma ação concreta para o gestor. Os outros achados ficam como alertas na saída da execução.

| Tipo | Quando | Chave | Prioridade | Texto (início) |
|---|---|---|---|---|
| `CONTAGEM_FISICA` | ≥ 1 sabor com saldo negativo ou venda sem produção | `estoque-acabado` | MEDIA; **ALTA** se mais da metade dos sabores com movimento diverge | "Realizar contagem física do estoque acabado" |
| `REVISAR_REGISTROS_SABOR` | Venda sem produção registrada | `sabor:<id>` | MEDIA | "Revise o registro de produção e vendas do sabor X…" |
| `CADASTRAR_RECEITAS` | ≥ 1 sabor ativo sem receita | `receitas` (uma só, com a lista de sabores) | MEDIA | "Cadastre a receita… a ausência de receita é falta de informação, não consumo zero." |
| `REVISAR_MOVIMENTACOES_MATERIA_PRIMA` | Matéria-prima negativa | `materia-prima:<id>` | ALTA | "Revise as compras (entradas) e as produções (saídas)…" |

Os dados estruturados (por exemplo, os sabores divergentes com o saldo) vão em `Recomendacao.dados`.

**Nenhuma `AcaoProposta`** é criada. O inventário também não vira ação, porque não existe service nem modelagem de domínio para ele.

Com os dados reais, que têm 7 de 9 sabores negativos e 0 receitas, o resultado **obtido** na conferência somente leitura (§16.1) é `CONTAGEM_FISICA` (**ALTA**, 7/9 = 0,778 > 0,5) e `CADASTRAR_RECEITAS` (MEDIA).

## 13. Deduplicação

O ciclo de vida e a deduplicação ficam em `runtime/recomendacoes.js`. **Nenhuma migration** foi necessária:
- a chave efetiva (`tipo|chave`) fica em `Recomendacao.dados.controle.chave`, buscada por filtro de caminho JSON, que o Prisma 5.22 suporta no MySQL e foi verificado antes;
- os estados cabem no `status` VarChar existente, e só o comentário do schema mudou (`prisma migrate diff`: "empty migration").

Regras ao registrar uma recomendação com chave:

| Situação encontrada | Operação | Efeito |
|---|---|---|
| Existe **ABERTA** com a mesma chave | `ATUALIZADA` | Atualiza texto, prioridade e dados; `ocorrencias + 1`; `execucaoId` passa a ser o da execução mais recente (`primeiraExecucaoId` fica guardada). **Nunca duplica** |
| Existe **IGNORADA** com a mesma chave | `SUPRIMIDA` | Não recria: o gestor já descartou |
| Só **RESOLVIDA**, ou nenhuma | `CRIADA` | Nova ABERTA: o problema voltou ou é novo |

**Resolução automática:** uma ABERTA cuja condição **deixou de ser detectada** é marcada `RESOLVIDA`, com `controle.resolucao = { modo: "AUTOMATICA", execucaoId, motivo }`. Isso só vale para os tipos avaliados naquela execução e para condições que **o próprio registro corrige**:
- `REVISAR_MOVIMENTACOES_MATERIA_PRIMA`: a entrada esquecida foi registrada e o saldo deixou de ser negativo;
- `REVISAR_REGISTROS_SABOR`: a produção do sabor foi registrada;
- `CADASTRAR_RECEITAS`: todos os sabores ativos passaram a ter receita.

**`CONTAGEM_FISICA` nunca é resolvida automaticamente.** O saldo histórico deixar de ser negativo (por exemplo, porque mais produção foi registrada) não reconcilia nada: o saldo continua sendo um valor contábil sem âncora física. Resolver a recomendação por isso seria usar como evidência justamente o valor que o agente declara não confiável. Ela só sai de `ABERTA` por decisão do gestor (`RESOLVIDA` depois da contagem, ou `IGNORADA`). Enquanto não for redetectada, ela continua aberta com a última `ultimaDeteccaoEm`.

**Gestor** (`POST /api/agentes/recomendacoes/:id/resolver` e `/ignorar`): ABERTA → `RESOLVIDA` ou `IGNORADA`, com `resolvidaEm` preenchido e `controle.resolucao.modo = "GESTOR"`. Qualquer outro estado → 409.

Estados: **ABERTA, RESOLVIDA, IGNORADA**. O antigo `DESCARTADA` do comentário da Etapa 1 nunca foi usado e virou `IGNORADA`.

O teste de repetição roda a análise duas vezes: continuam 2 recomendações, ambas `ATUALIZADA` e com `ocorrencias = 2`. A demonstração com 3 execuções seguidas também mantém o mesmo número de linhas.

## 14. Auditoria

`GET /api/agentes/execucoes/:id` permite reconstruir a análise:
- **Execução:** agente, tipo `ANALISAR_ESTOQUE`, gatilho, status, duração e `saida` completa. O limite da saída subiu para **32.000 caracteres**; a análise com volume parecido com o real ocupa cerca de 14 KB, sem truncar.
- **Tools:** cada `ChamadaTool` tem tool, entrada (por exemplo, as janelas `{ dataInicio, dataFim }`), sucesso ou falha, **resumo** e duração.
- **Recomendações** criadas ou atualizadas por aquela execução.
- **Mensagens:** nenhuma. O agente não simula cooperação.

Uma falha de tool aparece em `ChamadaTool` (`ok: false`, erro interno só na auditoria) e em `saida.falhasDeConsulta`.

## 15. Execução manual

```http
POST /api/agentes/estoque/executar        (autenticado)
{ "tipo": "ANALISAR_ESTOQUE", "dados": { "dataReferencia": "2026-09-30" } }   // dataReferencia opcional (padrão: hoje em Manaus)
```

```json
{ "execucaoId": 123, "agente": "estoque", "status": "SUCESSO",
  "saida": {
    "resumo": { "alertas": 6, "alertasPorPrioridade": { "ALTA": 0, "MEDIA": 6, "BAIXA": 0 },
                "recomendacoes": 2, "recomendacoesCriadas": 2, "recomendacoesAtualizadas": 0,
                "recomendacoesSuprimidas": 0, "recomendacoesResolvidasAutomaticamente": 0, "modoDegradado": true },
    "qualidade": { "estoqueAcabado": { "confiabilidade": "NAO_RECONCILIADO" }, "materiasPrimas": {…}, "receitas": {…}, "mrp": {…}, "fluxosProducaoVendas": {…} },
    "estoqueAcabado": {…}, "materiasPrimas": {…}, "mrp": {…}, "ritmo": {…},
    "alertas": [ … ], "recomendacoes": [ { "id", "tipo", "prioridade", "titulo", "operacao" } ], … } }
```

- A `dataReferencia` afeta só as janelas de ritmo. O saldo histórico e o de matéria-prima são sempre "até agora".
- Uma data inválida faz a execução falhar de forma controlada (400).

## 16. Cenário acadêmico

Cenário **sintético e reprodutível**, com referência em 30/09/2026 e sem receitas:

```text
Tradicional: produção 80 (25/09); vendas 60 (26/09) + 40 (28/09)  → saldo histórico −20
Maracujá:    produção 100 (24/09); vendas 80 (27/09)              → saldo histórico +20
```

Resultado obtido (teste `estoqueAgente.test.js` e demonstração em 110–280 ms):

| Esperado | Obtido |
|---|---|
| Tradicional: divergência | `SALDO_NEGATIVO` (MEDIA): "o saldo calculado está negativo em 20 unidade(s). É necessária reconciliação física…" |
| Tradicional: ritmo abaixo das vendas | `RITMO_PRODUCAO_ABAIXO_VENDAS` (MEDIA): 80 produzidas × 100 vendidas, razão 0,8, "também nos últimos 7 dias" |
| Tradicional: recomendação de reconciliação | `CONTAGEM_FISICA` (MEDIA, porque 1 de 2 sabores = 50%, que não é mais da metade) |
| Maracujá: sem alerta crítico | Só `RECEITA_AUSENTE`, que vale para todos os sabores. Razão 1,25 e saldo +20 ficam abaixo dos limiares |
| Sistema: MRP indisponível | `MRP_INDISPONIVEL` + `mrp: { disponivel: false, estado: "INDISPONIVEL_POR_DADOS", motivo: "RECEITAS_NAO_CADASTRADAS" }`; `calcularNecessidadesProducao` **não** é chamada |
| — | `DADOS_ESTOQUE_NAO_RECONCILIADOS` (MEDIA); `CADASTRAR_RECEITAS` (MEDIA) |
| Nada além disso | 0 vendas, produções, movimentações, custos, ações ou mensagens criadas pela análise |

Este cenário servirá como caso fixo na avaliação experimental (Etapa 7).

### 16.1 Conferência somente leitura com a cópia real (Etapa 0.2)

Para confirmar que o agente reconhece as limitações **reais**, e não só as sintéticas, as mesmas tools e regras rodaram sobre a cópia restaurada local `doces_maloca_restore_20260929_195116`, em modo **somente leitura**:
- sem runtime e sem persistência: chamada direta de `tool.executar` + funções puras de `regras.js`; nenhuma `ExecucaoAgente`, `ChamadaTool` ou `Recomendacao` gravada;
- um middleware do Prisma rejeitava qualquer operação que não fosse leitura (`find*`, `count`, `aggregate`, `groupBy`): **0 escritas tentadas**;
- `CHECKSUM TABLE` das 12 tabelas **idêntico** antes e depois;
- host local (`127.0.0.1`); script descartável fora do repositório; só agregados impressos.

Referência: 29/09/2026, a data da última venda da cópia.

| Item | Obtido | Etapa 0.2 |
|---|---|---|
| Estoque acabado | `NAO_RECONCILIADO`; 9 sabores: 1 positivo, 1 zerado, **7 negativos**; soma dos negativos **−158**; total −117 (21.060 produzidas × 21.177 vendidas) | 7 de 9 negativos, −158, −117 ✔ |
| Matéria-prima | 3, uma movimentação cada (Açúcar 10.000 g, Coco 20.000 g, Leite Condensado 12 un); `UTILIZAVEL_COM_RESSALVAS`; **nenhum alerta** (os 12 un. seriam "saldo baixo" só pela regra legada < 200, ignorada) | 3 MPs, nenhuma negativa ✔ |
| Receitas / MRP | 0 de 7 sabores ativos com receita → **`INDISPONIVEL_POR_DADOS` / `RECEITAS_NAO_CADASTRADAS`**; simulação não executada | 0 receitas ✔ |
| Ritmo | 7 dias: 317 produzidas × 652 vendidas; 30 dias: 2.325 × 2.662 | — |
| Alertas | 19: `SALDO_NEGATIVO` ×7, `RECEITA_AUSENTE` ×7, `RITMO_PRODUCAO_ABAIXO_VENDAS` ×3, `DADOS_ESTOQUE_NAO_RECONCILIADOS`, `MRP_INDISPONIVEL` (18 MEDIA, 1 BAIXA) | — |
| Recomendações | `CONTAGEM_FISICA` **ALTA** (7/9 = 0,778) e `CADASTRAR_RECEITAS` MEDIA | Opção C (contagem física) ✔ |
| Duração | **205 ms** (`consultarEstoqueAcabado` 101 ms; demais 19–30 ms) | — |

O agente chega sozinho, pelas regras, à mesma conclusão da análise manual da Etapa 0.2: o saldo histórico não serve como estoque, é preciso contar fisicamente, e sem receitas o MRP não existe.

## 17. Teste com receita sintética

Usa a receita fictícia de "Cocada Fictícia" (100 un = 1000 g de açúcar + 500 g de coco) com 1000 g de açúcar em estoque. Há 160 produzidas e 150 vendidas nos últimos 30 dias.
- **MRP `DISPONIVEL`**: `calcularNecessidadesProducao` é chamada (ChamadaTool `ok`), e a simulação repõe 150 unidades, exigindo **1500 g de açúcar**.
- Resultado: `podeProduzir: false` e alerta `MATERIA_PRIMA_INSUFICIENTE`. Nenhuma produção é gravada.
- Com receitas **parciais**, o MRP fica `PARCIAL`: simula só o sabor com receita e mantém `CADASTRAR_RECEITAS` para o outro.

Isso prova que a arquitetura do MRP funciona. **Não** representa o estado real do negócio, que não tem nenhuma receita.

## 18. Performance

Medição no banco de teste com dados **sintéticos**, sem nenhum dado real:

| Cenário | Dados | Duração da análise (3 execuções) | Saída |
|---|---|---|---|
| Acadêmico | 2 sabores, 2 produções, 3 vendas | 283 / 167 / 108 ms | ~4,9 KB |
| Volume parecido com o real (0.2) | 9 sabores, 247 produções (467 itens), 901 vendas (3.042 itens), 3 matérias-primas | **174 / 145 / 128 ms** | ~14 KB (sem truncar) |
| Cópia real restaurada (§16.1, só leitura, sem persistência) | dados reais da 0.2 | **205 ms** (só tools + regras) | — |

- **5 consultas por análise**, ou 6 com o MRP disponível.
- A mais cara é `consultarEstoqueAcabado` (≈ 35–40 ms), que carrega todos os itens de produção e de venda. É um comportamento herdado do service e aceitável nesse volume.
- **Sem N+1:**
  - as receitas vêm numa consulta só (`include`);
  - os fluxos por janela usam `groupBy`, com 1 consulta extra só para os nomes;
  - nenhuma tool é chamada em duplicidade (as duas chamadas de fluxo são as duas janelas).
- Nada precisou ser otimizado.

## 19. Testes

**Novos (42 em `tests/sma`, mais 1 em `periodos.test.js`):**

| Arquivo | Testes | Cobertura |
|---|---|---|
| `estoqueRegras.test.js` | 26 | Regras puras: situações de saldo; `SALDO_NEGATIVO` (texto exato); `VENDA_SEM_PRODUCAO` sem duplicar; `SALDO_ACUMULADO_ALTO` nas fronteiras (49 / 50 e 20% / 19,9%); não reconciliado BAIXA/MEDIA; matéria-prima (negativa ALTA, sem movimento BAIXA, legado ignorado, `[]` e falha); receitas (nenhuma, parcial, completa, sem sabores, falha); pedido de simulação do MRP; **8 fronteiras de ritmo**; janelas na virada do ano; recomendações (MEDIA × ALTA, chaves, textos, nenhuma sem divergência, ritmo nunca vira recomendação); tipos avaliados; contrato `DEMANDA_MEDIA` |
| `estoqueAgente.test.js` | 12 | Banco vazio (modo degradado); **nenhum campo** de mínimo, cobertura, lead time, fornecedor, compra ou previsão; tool com falha (continua sem resolver por engano); data inválida; **cenário acadêmico completo**; **receita sintética** (MRP disponível e insumo insuficiente); MRP parcial; matéria-prima; repetição sem duplicata; resolução automática de matéria-prima corrigida **com `CONTAGEM_FISICA` continuando ABERTA**; IGNORADA suprime e RESOLVIDA reaparece; auditoria completa com DIAGNOSTICO e PING |
| `estoqueHttp.test.js` | 4 | Execução pela API com detalhe reconstruível; recomendações listar, ignorar, resolver, 409, 404 e reaparecimento; 2 rotas novas sem token → 401 |
| `periodos.test.js` | +1 | `diaCivilISO`, `deslocarDiaISO` (bissexto, virada do ano) e `hojeCivilISO` em Manaus |

**Testes da Etapa 1 ajustados**, por evolução **deliberada** de contrato interno do SMA. Nenhum foi removido:

| Teste | Motivo |
|---|---|
| `tools.test.js`: catálogo | 9 → 11 tools (`consultarReceitas`, `consultarProducaoVendasPeriodo`) |
| `tools.test.js`: matéria-prima | `saldoBaixo` → `saldoBaixoLegado`; + `movimentacoes` e `ultimaMovimentacao` |
| `tools.test.js`: arquitetura | A varredura passou a ser **recursiva** (`agentes/estoque/`) e inclui `contratos/`: verificação reforçada |
| `llm.test.js`: tools oferecidas ao estoque | A allowlist do agente ganhou as 2 tools novas |
| `registroRuntime.test.js`: chaves do contexto | + `encerrarRecomendacoesAusentes` |
| `registroRuntime.test.js`: truncamento | O limite da saída subiu para 32.000 caracteres; o teste usa 40.000 |

## 20. Baseline antes e depois

| | Antes (Etapa 1) | Depois (Etapa 2) |
|---|---|---|
| Testes / arquivos | 344 / 20 | **387 / 23** |
| Caracterização (Etapa 0) | 265 | 266 (+1 em `periodos`) |
| SMA | 79 | 121 (+42) |
| Removidos | — | 0 |
| `KNOWN_BEHAVIOR` | 34 | 34 |

O `baseline.json` foi atualizado com motivo e histórico (202 → 232 → 265 → 344 → 387).

**Validação final:**

| Validação | Resultado |
|---|---|
| `npm test` com `TZ=UTC` ×3 | 387/387 em 23/23, 0 falhas, 0 pendentes nas 3 (59 s, 82 s, 65 s); na 2ª, uma queda nativa 0xC0000409 foi refeita pelo mecanismo aprovado |
| `npm test` com `TZ=America/Manaus` ×3 | 387/387 em 23/23, 0 falhas, 0 pendentes nas 3 (52 s, 37 s, 49 s), sem queda |
| `npm run test:guardas` | 33/33 |
| `node --check` | 107/107 arquivos |
| `prisma validate` / `migrate diff` contra o schema da Etapa 1 | schema válido; "This is an empty migration" (só um comentário mudou); nenhuma migration nova |
| `npm run build` | OK |
| Banco dev e banco restaurado da 0.2 | `CHECKSUM TABLE` idêntico ao retrato da 0.3; dev "up to date" com as 2 migrations da Etapa 1 |
| Produção | nenhuma conexão (URLs locais, sem `RAILWAY_*`), nenhuma migration, sem deploy |

**Revalidação em 02/10/2026 (após a mudança de `CONTAGEM_FISICA`):**

| Validação | Resultado |
|---|---|
| Etapa 1 isolada (`git worktree` em `9dfeefe`) | `npm test`: **344/344 em 20/20**, gate aprovado |
| Etapa 2, `npm test` com `TZ=UTC` | **387/387 em 23/23**, gate aprovado |
| Etapa 2, `npm test` com `TZ=America/Manaus` | **387/387 em 23/23**, gate aprovado |
| `npm run test:guardas` / `prisma validate` | 33/33 / schema válido |
| Banco dev | "up to date" (2 migrations, `127.0.0.1:3307`) |

**Incidente durante a validação:** uma execução do Vitest **sem gate** gravou um relatório parcial (6 de 20 arquivos, 165 testes), com o aviso do próprio Vitest "Some tests are still running when generating the JSON report". O **gate reprovaria** esse relatório (10 divergências: "arquivos de teste: 6 (esperado 20)…"). A nova execução foi completa. É uma variação da instabilidade do ambiente Windows já registrada (0.3 e 0.4). **Não** estendi o retry automático a essa assinatura sem aprovação.

## 21. Riscos

| Risco | Situação |
|---|---|
| Os limiares são escolhas iniciais | Documentados e testados; serão revistos quando houver estoque mínimo e parâmetros editáveis. Ver o ruído na demonstração de volume: 27 alertas, a maioria BAIXA |
| Muitos alertas `RECEITA_AUSENTE` (um por sabor) | Ficam na saída da execução. Na tabela de recomendações há **uma só** (`CADASTRAR_RECEITAS`) |
| A simulação do MRP usa "volume vendido em 30 dias" como referência | É ritmo recente, não previsão. Vai ser substituída pela demanda média da Inteligência (Etapa 3) |
| `consultarEstoqueAcabado` carrega todos os itens | ≈ 40 ms com o volume real; acompanhar se o histórico crescer muito |
| Deduplicação sem trava no banco | Duas análises **simultâneas** podem criar uma duplicata, porque a busca e a criação não são atômicas. Hoje a execução é manual; o cron único da Etapa futura evita sobreposição, ou entra uma coluna com índice único |
| `CONTAGEM_FISICA` sem modelo de inventário | Se o gestor marcar `RESOLVIDA` depois de contar, mas o saldo histórico continuar negativo, a próxima análise cria uma nova ABERTA, porque não existe onde registrar a contagem. Até o inventário existir, o gestor deve usar `IGNORADA` depois da contagem |
| A data de referência só vale para o ritmo | Os saldos são sempre "até agora"; fica explícito no relatório e no código |
| Instabilidade do Vitest no Windows | Nova assinatura ("still running") observada uma vez; o gate a barra |
| As 3 ressalvas da Etapa 1 continuam | Ação em `EXECUTANDO`, migrations fora de produção, sem LLM real |

## 22. Arquivos alterados

**Novos:**
- `backend/src/agents/agentes/estoque/{index,analise,regras}.js`
- `backend/src/agents/runtime/recomendacoes.js`
- `backend/src/agents/contratos/demandaMedia.js`
- `backend/tests/sma/{estoqueRegras,estoqueAgente,estoqueHttp}.test.js`
- `docs/tcc/etapa-2-agente-estoque.md`

**Alterados:**
- `backend/src/agents/agentes/stubs.js`: o stub `estoque` foi removido.
- `backend/src/agents/index.js`: registra o agente real.
- `backend/src/agents/runtime/runtime.js`: deduplicação de recomendações, resolução automática e limite da saída.
- `backend/src/agents/tools/{definirTool,estoqueProducao,index}.js`: `resumir`, 2 tools novas e a tool de matéria-prima detalhada.
- `backend/src/services/materiaPrimaService.js` (`resumoMateriasPrimasDetalhado`), `saboresService.js` (`listarReceitas`), `producaoService.js` (`compararProducaoVendasPorSabor`): **só funções novas**; as existentes não mudaram.
- `backend/src/lib/periodos.js`: `diaCivilISO`, `hojeCivilISO`, `deslocarDiaISO`.
- `backend/src/controllers/agentesController.js` e `routes/agentes.js`: resolver e ignorar recomendações.
- `backend/prisma/schema.prisma`: **só o comentário** do status de `Recomendacao` (migration vazia).
- `backend/tests/caracterizacao/{baseline.json,periodos.test.js}`.
- `backend/tests/sma/{tools,llm,registroRuntime}.test.js`: os ajustes do §19.

**Não alterados:** frontend, n8n, dados reais, migrations, rotas e serviços HTTP de domínio. Nenhuma receita foi cadastrada e nenhum estoque foi reconciliado.

## 23. Preparação para a Etapa 3 (Agente de Inteligência)

- **Contrato pronto** (`contratos/demandaMedia.js`):

  ```text
  Estoque → Inteligência: { tipo: "DEMANDA_MEDIA", dados: { dataReferencia, janelaDias, saborIds? } }
  ← { metodo: "MEDIA_SIMPLES_HISTORICA", sabores: [{ saborId, sabor, unidadesVendidas, diasComVenda, mediaDiaria }] }
  ```

  Ambos os lados são validados por Zod. A Etapa 3 implementa a resposta na Inteligência, e o Estoque passa a enviar a mensagem pelo `enviarMensagem`, o que torna a cooperação comprovável pelo histórico.
- Com a demanda média, a simulação do MRP troca a base "vendido em 30 dias" pela demanda da Inteligência. Mesmo assim, ela só é útil com receitas reais.
- Os gatilhos automáticos usarão a mesma `analisarEstoque(contexto)`:
  - **cron:** análise diária;
  - **eventos:** `VENDA_REGISTRADA`, `PRODUCAO_REGISTRADA`, publicados pelos services no barramento da Etapa 1.

  A deduplicação já impede recomendações repetidas.
- **Pré-requisitos do negócio** para conclusões operacionais:
  1. **contagem física** do estoque acabado (com um modelo de inventário e saldo inicial);
  2. **cadastro das receitas**;
  3. **estoque mínimo** por insumo e por sabor, com parâmetros editáveis.

  Até lá, o agente continua dizendo o que **não** sabe.
