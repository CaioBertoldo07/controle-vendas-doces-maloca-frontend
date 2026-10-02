# Etapa 3 — Agente de Inteligência e cooperação Estoque ↔ Inteligência

**Data:** 02/10/2026
**Base:** Etapa 0.2 (dados reais), Etapa 0.5 (política temporal), Etapa 1 (infraestrutura SMA), Etapa 2 (Agente de Estoque)
**Branch de trabalho:** `feat/etapa-2-agente-estoque`, a partir de `50fcf6d` (commit da Etapa 2). **Sem commit**, aguardando revisão. Sem push e sem deploy.

---

## 1. Objetivo

Dois objetivos centrais:
1. transformar o stub `inteligencia` em um **especialista funcional e determinístico**;
2. demonstrar a **primeira cooperação real** entre dois agentes especializados: o Estoque pede ao Agente de Inteligência a demanda média recente (`DEMANDA_MEDIA`) e usa a resposta no próprio diagnóstico.

A troca passa inteira pelo runtime SMA da Etapa 1 e fica registrada em `MensagemAgente`, nas duas `ExecucaoAgente` (pai e filha) e nas `ChamadaTool` de cada uma.

## 2. Limites acadêmicos

A Etapa 0.2 sustenta: 901 vendas, 21.177 unidades, 32 semanas contínuas sem semana vazia (28/02 a 29/09/2026), pagamentos confiáveis só a partir de 14/08/2026.

| Pode ser defendido (e foi implementado) | Não pode (e não existe no código) |
|---|---|
| Indicadores descritivos (vendas, unidades, faturamento registrado, ticket) | Previsão estatística, forecasting |
| Demanda média recente por sabor | Machine learning, regressão, modelo preditivo |
| Média móvel de 4 semanas | Sazonalidade anual (só há ~7 meses) |
| Variação entre janelas e tendência **recente** | Projeção de longo prazo |
| Perfil por dia da semana | Custo ou margem por sabor (0 receitas) |
| Custo **agregado** por unidade e sobre o faturamento | Comportamento de pagamento antes de 14/08 |

Terminologia usada em todo o código e nas saídas: **"demanda média recente"**, nunca "previsão de demanda". Um teste varre as chaves da saída e falha se aparecer `previs`, `forecast`, `projec`, `margem` ou `cliente`.

> **A tendência representa apenas a comparação recente entre janelas históricas e não constitui previsão futura.**

## 3. Arquitetura

```text
agents/agentes/inteligencia/
├── index.js     o agente: ANALISAR_INTELIGENCIA, DEMANDA_MEDIA, DIAGNOSTICO, PING, PERGUNTA
├── analise.js   analisarInteligencia(contexto, parametros) e calcularDemandaMedia(contexto, pedido)
└── calculos.js  funções PURAS: semanas, série, média móvel, variação, tendência,
                 suficiência, demanda média, perfil, indicadores, insights
agents/contratos/demandaMedia.js   contrato Estoque → Inteligência (Zod, os dois lados validam)
```

- **Fluxo obrigatório:** dados → tools → funções determinísticas → indicadores → insights estruturados. Nenhum número vem de LLM.
- **`calculos.js` não tem relógio:** a data de referência é sempre recebida. Isso torna as funções reproduzíveis e prontas para a avaliação experimental.
- **Sem acesso direto a dados:** o agente fala só pelo `contexto` e não importa Prisma, services nem controllers.
- **Sem acoplamento entre agentes:** um teste estático novo garante que `agentes/estoque` e `agentes/inteligencia` **não se importam mutuamente**. A cooperação só existe pelo runtime.
- **Nada é gravado:** o agente não escreve dados de domínio nem persiste recomendações nesta etapa (§13).

## 4. Tools

| Tool | Nova? | Service | Uso |
|---|---|---|---|
| `consultarVendasDiariasPorSabor` | **nova** | `vendasService.vendasDiariasPorSabor` (novo) | Unidades por **dia × sabor** agregadas no banco + primeira venda (plausível) por sabor + nº de vendas com data implausível |
| `consultarVendasPeriodo` | reutilizada (+`resumir`) | `vendasService.resumoVendasPeriodo` | Vendas, unidades, faturamento, pago/pendente de uma janela |
| `consultarCustosPeriodo` | **nova** | `custosService.totalCustosPeriodo` (novo) | Custo total e por categoria (`aggregate` + `groupBy`) |

**Eficiência (§16 do pedido).** A série diária é **uma consulta `GROUP BY`** (`DATE_FORMAT(v.data, '%Y-%m-%d')` × `saborId`), restrita à janela. O agente recebe ~1 linha por dia e sabor, e não as vendas. Em 12 semanas do histórico real são 28 ms. Escolhi SQL agregado porque o Prisma não agrupa por expressão de data; o `DATE_FORMAT` sobre o relógio de Manaus gravado (Etapa 0.5) dá o dia civil **sem depender** do fuso do processo nem da sessão MySQL. Os parâmetros são ligados (`$queryRaw` com template), sem concatenação.

**Auditoria sem dados pessoais.** `consultarVendasPeriodo` (Etapa 1) passou a ter `resumir`: a `ChamadaTool` guarda totais e a **contagem** de clientes, não a lista de nomes. As tools novas também guardam só resumo.

## 5. Metodologia temporal

- **Semana:** domingo a sábado no calendário de Manaus, a mesma de `intervaloDaSemana` (Etapa 0.5). Novos auxiliares em `lib/periodos.js`: `diaDaSemanaISO` e `inicioDaSemanaISO`.
- **Data de referência:** toda análise recebe `dataReferencia` (`AAAA-MM-DD`). Sem ela, usa **hoje em Manaus** (`hojeCivilISO`). `calculos.js` nunca chama `new Date()`.
- **Semana parcial:** a semana que contém a data de referência é **sempre parcial**, mesmo que a referência seja um sábado. Ela aparece separada (`semanaParcial`, com suas unidades) e fica **fora** de médias, variações, tendências e perfil.
- **Janelas** para a referência de quarta, 30/09/2026:

  ```text
  anteriores  02/08 ─ 29/08   (4 semanas completas)
  recentes    30/08 ─ 26/09   (4 semanas completas)
  parcial     27/09 ─ 30/09   (fora das médias)
  série       12 semanas completas; perfil: 8 semanas completas
  ```

- **Independência do fuso:** a aritmética usa só dias civis em texto e `Date.UTC`. Um teste roda os cálculos com `TZ=UTC`, `America/Manaus` e `Asia/Tokyo` e exige saída idêntica. A suíte inteira passa nos dois fusos, e a validação real deu resultados idênticos em ambos (§18).

## 6. Indicadores

Para a janela recente (e a anterior, para variação):

| Indicador | Definição |
|---|---|
| `quantidadeVendas`, `unidades` | Contagem e soma no período |
| `faturamentoRegistrado` | Soma de `Venda.valor` **como registrado** |
| `ticketMedio` | faturamento ÷ vendas (`null` sem vendas, nunca `NaN`) |
| `unidadesPorVenda` | unidades ÷ vendas |
| `variacao` | De vendas, unidades e faturamento, entre as duas janelas (§9) |
| Distribuição por sabor | `sabores[].participacao` (§13) |
| `pagamentos` | Pagas, pendentes e valores, com `confiabilidade` |
| `custos` | `AGREGADO`: custo registrado, **custo agregado por unidade vendida**, **custo sobre o faturamento** |

**Pagamentos.**
- Se a janela começa **antes de 14/08/2026**, a confiabilidade é `COM_RESSALVA`, com o texto: "o status veio de um backfill… não reflete comportamento real de pagamento".
- Depois dessa data, é `SITUACAO_ATUAL_DO_REGISTRO`, com o texto: "Pendente = ainda não marcada como paga hoje; **não é inadimplência**."
- Nenhuma inadimplência histórica é inferida.

**Custos.** Contam pela **data de lançamento** (compra), não de consumo; o aviso acompanha o indicador. Na validação real isso apareceu: nas 4 semanas recentes o custo agregado foi R$ 1,06/un. (19,2%), contra R$ 1,52/un. (28,1%) no histórico inteiro. A janela curta oscila com o calendário de compras. **Não existe custo nem margem por sabor.**

## 7. Demanda média recente

```text
demanda média recente (sabor) = unidades vendidas nas N semanas completas ÷ N      (un./semana)
média diária observada        = unidades ÷ (N × 7)                                 (inclui dias sem venda)
N = janelaSemanas: padrão 4, mínimo 4, máximo 12
```

- O mínimo 4 é igual à largura da média móvel. O máximo 12 equivale a cerca de um trimestre.
- Também saem `unidadesVendidas`, `diasComVenda`, `semanasObservadas`, `primeiraVenda` e `qualidade` (§12).
- **Só `SUFICIENTE` tem média.** O contrato **rejeita** resposta com média sem amostra suficiente, ou sem média com amostra suficiente.

## 8. Média móvel

MM4 simples sobre a série semanal: `mm4[i] = média(serie[i−3..i])`. As 3 primeiras posições são `null`: não há 4 semanas para suavizar, e nada é preenchido artificialmente. É **suavização descritiva**, e a saída diz isso.

Testes: série constante, crescente, decrescente, com zeros, menor que 4, exatamente 4 e vazia. A série total sai com `mediaMovel4` em cada semana.

## 9. Variação

`variacao(anterior, recente)`:

| Situação | `estado` | `percentual` |
|---|---|---|
| anterior > 0 | `CALCULADA` | `(recente − anterior) ÷ anterior × 100`, 1 casa |
| anterior = 0, recente > 0 | `BASE_ZERO` | `null` (não é "+∞%") |
| ambos 0 | `AMBOS_ZERO` | `null` |
| valor ausente/não numérico | `INDISPONIVEL` | `null` |

A saída nunca contém `Infinity` nem `NaN`: há testes para isso e uma varredura do JSON final.

## 10. Tendência

`classificarTendencia(variacao, { suficiente })`:

| Condição (nesta ordem) | Tendência |
|---|---|
| As 8 semanas não foram todas observadas | `INDETERMINADA` / `DADOS_INSUFICIENTES` |
| `estado ≠ CALCULADA` | `INDETERMINADA` / `BASE_ZERO`, `AMBOS_ZERO`… |
| anterior + recente < **20** unidades | `INDETERMINADA` / `VOLUME_BAIXO` |
| variação ≥ **+15%** | `ALTA` |
| variação ≤ **−15%** | `QUEDA` |
| senão | `ESTAVEL` |

- A comparação é feita em **inteiros**: `(r − a)·100 ≥ 15·a`. Assim as fronteiras (+15% e −15% exatos) não dependem de arredondamento. Há testes em 114, 115, 85 e 86.
- **Por que 15%:** o coeficiente de variação semanal real é 0,24 (Etapa 0.2). Só por ruído, a diferença relativa entre duas somas independentes de 4 semanas oscila cerca de 0,24 × √(2/4) ≈ 17%. Abaixo de ~15%, a mudança não se distingue do ruído e vira `ESTAVEL`.
- **Por que 20 unidades:** evita "+100%" de 1 para 2 unidades.

As constantes ficam em `PARAMETROS` (`calculos.js`), com o comentário da justificativa.

> **A tendência representa apenas a comparação recente entre janelas históricas e não constitui previsão futura.** O mesmo texto vai em `tendencias.observacao`.

## 11. Perfil por dia da semana

Nas **8 semanas completas** mais recentes, para cada dia: unidades, `ocorrencias` (= 8), `diasComVenda`, `mediaPorOcorrencia` e `participacao` (%). É calculado no total e, com `perfilPorSabor: true`, por sabor.

Responde "em quais dias normalmente vendemos mais?". É **perfil descritivo**, e não sazonalidade estatística.

O perfil é marcado `DADOS_INSUFICIENTES` se as 8 semanas não foram observadas. Nesse caso o insight de "dia de maior venda" **não é gerado**.

## 12. Dados insuficientes

- **Critério:** uma janela de N semanas só é `SUFICIENTE` para um sabor se **todas** as N semanas foram observadas. "Observada" significa que a semana começa no dia da primeira venda do sabor ou depois. Em outras palavras, o sabor já vendia antes de a janela começar.

  | Qualidade | Quando | Média |
  |---|---|---|
  | `SUFICIENTE` | primeira venda ≤ início da janela | calculada |
  | `DADOS_INSUFICIENTES` | primeira venda dentro da janela (sabor novo) | `null`, sem extrapolação |
  | `SEM_HISTORICO` | nenhuma venda até o fim da janela | `null` |

- **Tendência:** exige as **8** semanas (4 + 4) observadas.
- **Datas implausíveis:** o histórico real tem uma venda datada no **ano 0206** (Etapa 0.2, P1). Se ela contasse como "primeira venda", um sabor novo pareceria vendido há séculos e passaria como `SUFICIENTE`. Por isso a primeira venda só considera datas ≥ **2020-01-01** (`DATA_MINIMA_PLAUSIVEL`, em `vendasService`). As vendas com data implausível são contadas e expostas em `qualidadeDados.historicoVendas.vendasComDataImplausivel`. A falha foi encontrada na validação real e tem teste de regressão.

## 13. Resumo gerencial

`ANALISAR_INTELIGENCIA { dataReferencia?, janelaSemanas? (4–12), perfilPorSabor? }` devolve:

```json
{
  "periodo": { "semanaParcial", "recente", "anterior", "serie", "perfil" },
  "resumo": { "insights", "sabores", "tendenciaTotal", "modoDegradado" },
  "indicadores": { "recente", "anterior", "variacao", "custos" },
  "serieSemanal": { "semanas": [{ "inicio", "fim", "unidades", "mediaMovel4" }], "semanaParcial" },
  "sabores": [{ "sabor", "unidadesRecentes", "participacao", "mediaSemanal", "qualidade", "variacao", "tendencia", "serieSemanal" }],
  "tendencias": { "total", "sabores": { "ALTA", "ESTAVEL", "QUEDA", "INDETERMINADA" } },
  "perfilDiaSemana": { "total", "porSabor?" },
  "insights": [{ "tipo", "texto", "dados" }],
  "qualidadeDados": {}, "limitacoes": [], "falhasDeConsulta": []
}
```

- **Insights:** frases geradas **a partir dos números**, sem LLM. São no máximo 6 tipos, cada um só quando o dado o sustenta: `VARIACAO_VENDAS`, `CONCENTRACAO_MIX`, `DIA_DE_MAIOR_VENDA`, `SABORES_EM_ALTA`, `SABORES_EM_QUEDA` e `HISTORICO_INSUFICIENTE`.
- **Recomendações:** **nenhuma** é persistida nesta etapa. Nenhum achado tinha uma ação clara e de valor real para o gestor, e o pedido priorizava poucos resultados bons a alertas artificiais.

## 14. Cooperação Estoque ↔ Inteligência

```text
Estoque  (ExecucaoAgente, ANALISAR_ESTOQUE, profundidade 0)
   │
   │ DEMANDA_MEDIA  { dataReferencia, janelaSemanas: 4, saborIds }      ← MensagemAgente
   ▼
Inteligência  (ExecucaoAgente filha, gatilho MENSAGEM, profundidade 1)
   │
   ├── vendas recentes        consultarVendasDiariasPorSabor (ChamadaTool)
   ├── série semanal          calculos.serieSemanal
   ├── média móvel            calculos.mediaMovel
   └── tendência              (no ANALISAR_INTELIGENCIA; a DEMANDA_MEDIA devolve só médias)
   │
   ▼
Resposta estruturada  (validada por DEMANDA_MEDIA.resposta)              → MensagemAgente.resposta
   │
   ▼
Estoque continua o diagnóstico
   ├── consultarProducaoVendasPeriodo na MESMA janela devolvida (ChamadaTool)
   ├── produção média semanal × demanda média recente, por sabor
   └── divergência histórica em "semanas de demanda"
```

- **Pedido:**
  - O Estoque chama `contexto.enviarMensagem({ para: "inteligencia", tipo: "DEMANDA_MEDIA", dados })`. Não importa o outro agente nem chama função interna dele.
  - Sabores pedidos: os que tiveram produção ou venda nos últimos 30 dias. Sem movimento recente, nada é pedido (`SEM_MOVIMENTO_RECENTE`).
- **Contrato** (`contratos/demandaMedia.js`):
  - Pedido `.strict()`: `dataReferencia` precisa ser um dia **existente**, `janelaSemanas` 4–12 e `saborIds` de 1 a 50.
  - A Inteligência valida o pedido (400) e o Estoque valida a resposta (`RESPOSTA_INVALIDA`).
  - A Inteligência também passa a própria resposta pelo `parse`, cumprindo o contrato.
  - O contrato preparado na Etapa 2 (janela em dias) foi substituído pelo formal (janela em semanas completas, `metodologia` explícita), como previsto.
- **Uso da resposta** (`regras.compararProducaoDemanda`), por sabor:
  - `SUFICIENTE`: produção média semanal das mesmas semanas ÷ demanda média. Com os limiares da Etapa 2 (0,9 e 1,5), o resultado é `PRODUCAO_ABAIXO_DA_DEMANDA`, `ALINHADA` ou `PRODUCAO_ACIMA_DA_DEMANDA`. Texto gerado: *"A demanda média recente de Tradicional é 30 un./semana (4 semanas completas, 30/08 a 26/09). A produção no mesmo período foi de 20 un./semana, abaixo desse ritmo."*
  - `DADOS_INSUFICIENTES`, `SEM_HISTORICO` ou sem venda na janela: `SEM_CONCLUSAO`. Nenhuma conclusão operacional é tirada dessa média.
  - **Divergências:** o saldo negativo vira *semanas de demanda* (por exemplo, −20 un. ÷ 30 un./semana = 0,67). Isso dá escala ao problema; não é estoque nem cobertura.
- **Sem quantidade a produzir:** nada de "produza N" e nada de `AcaoProposta`. O estoque não foi reconciliado, não há estoque mínimo e não há receitas reais. A seção `demanda` diz isso em `observacao`.
- **Saída do Estoque:**
  - nova seção `demanda` (`solicitada`, `disponivel`, `metodologia`, `sabores`, `divergencias`);
  - `qualidade.demandaMediaRecente`;
  - alertas e recomendações da Etapa 2 inalterados.

## 15. Auditoria da cooperação

`GET /api/agentes/execucoes/:id` (pai) mostra:
- **a execução do Estoque:** gatilho, status, duração e `saida.demanda`, que é o resultado usado;
- **`mensagens`:** origem `estoque`, destino `inteligencia`, tipo `DEMANDA_MEDIA`, status `RESPONDIDA`, `conteudo` (o pedido), `resposta` e `execucaoDestinoId`;
- **`filhas`:** a execução `inteligencia` / `DEMANDA_MEDIA` / `SUCESSO`;
- **`chamadasTool` do pai:** inclui `consultarProducaoVendasPeriodo` com **exatamente** o `metodologia.periodo` devolvido pela Inteligência. É a prova de que a resposta foi usada.

`GET /api/agentes/execucoes/:idDaFilha` mostra:
- `gatilho: MENSAGEM`, `execucaoPaiId` e `metadados.profundidade: 1`;
- `recebidas`: a mesma mensagem;
- `chamadasTool`: a tool de vendas, com entrada, resumo e duração.

Os testes `cooperacao.test.js` verificam cada um desses vínculos, também pela API autenticada.

## 16. Modo degradado

**Inteligência (`ANALISAR_INTELIGENCIA`):**
- Se a tool de série diária falha, os indicadores continuam. Série, tendência, perfil e insights ficam `disponivel: false`, com o motivo.
- Se as tools de vendas e custos falham, série e tendências continuam e os indicadores ficam indisponíveis.
- Com banco vazio, a análise dá SUCESSO com zeros, `INDETERMINADA` e nenhum insight.

**Inteligência (`DEMANDA_MEDIA`):** sem dados de vendas, a execução **falha explicitamente** (503) em vez de devolver média vazia. O solicitante sabe que não recebeu média nenhuma.

**Estoque:** se a Inteligência falha, ele **não falha**:

| Causa | `demanda.motivo` | Registro |
|---|---|---|
| Agente lança erro | `FALHA_AGENTE_INTELIGENCIA` | MensagemAgente `FALHA`, filha `FALHA`, `execucaoInteligenciaId` na saída |
| Tool da Inteligência falha | `FALHA_AGENTE_INTELIGENCIA` | Filha `FALHA` com "Dados de vendas indisponíveis…"; ChamadaTool `ok: false` |
| Resposta fora do contrato | `RESPOSTA_INVALIDA` | Resposta descartada; produção nem é consultada |
| Profundidade máxima esgotada | `FALHA_AGENTE_INTELIGENCIA` | Nenhuma mensagem criada (o runtime recusa antes) |

Em todos os casos:
- `resumo.modoDegradado` fica `true`;
- `qualidade.demandaMediaRecente` fica `INDISPONIVEL`;
- a falha aparece em `falhasDeConsulta`;
- alertas e recomendações locais continuam sendo produzidos.

**Loop:** uma Inteligência "maliciosa" que devolve a pergunta ao Estoque é contida pelo limite de profundidade da Etapa 1. A cadeia para em 5 execuções (profundidades 0 a 4), todas com SUCESSO.

## 17. Cenário acadêmico

Arquivo `tests/sma/cenarioInteligencia.js`. É **sintético e reprodutível**, com referência na quarta 30/09/2026.

```text
               anteriores (02/08–29/08)   recentes (30/08–26/09)   produção recente
Tradicional    80 un. (20/sem)            120 un. (30/sem)         20/sem     saldo histórico −20
Maracujá       100 un. (25/sem)           80 un. (20/sem)          20/sem     saldo histórico 0
Os dois já vendiam em 15/07; 50 Tradicional na semana parcial (28/09), fora das médias.
```

| Esperado | Obtido |
|---|---|
| Tradicional +50%, `ALTA` | +50%, `ALTA`; média 30 un./sem (4,29/dia) |
| Maracujá −20%, `QUEDA` | −20%, `QUEDA`; média 20 un./sem (2,86/dia) |
| Total | 180 → 200 (+11,1%): `ESTAVEL` (abaixo de 15%) |
| Estoque pede `DEMANDA_MEDIA` | 1 `MensagemAgente` `RESPONDIDA`; filha `SUCESSO` |
| Estoque compara com a produção | Tradicional `PRODUCAO_ABAIXO_DA_DEMANDA` (20 ÷ 30 = 0,667); Maracujá `ALINHADA` (1,0) |
| Estoque contextualiza a divergência | Tradicional −20 un. = 0,67 semana de demanda |
| Nada operacional | 0 escritas de domínio, 0 `AcaoProposta`, nenhuma quantidade a produzir |

**Dados insuficientes (§28 do pedido).** O cenário acadêmico da Etapa 2 tem vendas só na última semana. Nele, a Inteligência responde `DADOS_INSUFICIENTES` para Tradicional e `SEM_HISTORICO` para Maracujá, que só vendeu na semana parcial. O Estoque marca os dois como `SEM_CONCLUSAO`, sem divergência contextualizada, e nem consulta a produção.

## 18. Validação nos dados restaurados (somente leitura)

A validação rodou na cópia local `doces_maloca_restore_20260929_195116`, com referência em 29/09/2026 (última venda).

**Proteções:**
1. O usuário MySQL `maloca` tem **só `SELECT`** nesse banco. Uma escrita deliberada (`UPDATE … WHERE id = -1`) foi **negada pelo banco**.
2. Um middleware do Prisma recusava qualquer operação que não fosse leitura: **0 tentativas** de escrita.
3. O `CHECKSUM TABLE` das 12 tabelas ficou **idêntico** antes e depois (`91590b4c`).
4. Host `127.0.0.1`; nenhuma conexão com produção; script descartável fora do repositório; **só agregados**, sem nome de cliente.

**Método:** o código **real** dos agentes rodou com um contexto em memória. As tools foram executadas diretamente (sem `ChamadaTool`), a mensagem `DEMANDA_MEDIA` foi roteada em processo para o agente real (sem `MensagemAgente`) e as recomendações ficaram só em memória. Rodou com `TZ=UTC` e `TZ=America/Manaus`: **saídas idênticas**, exceto pelos tempos.

**Coerência com a Etapa 0.2:**

| Fato | Etapa 0.2 | Etapa 3 |
|---|---|---|
| Dias com venda | 185 | 185 ✔ |
| Semanas com venda | 32, nenhuma vazia | 32 ✔ (31 completas + a parcial 27–29/09) |
| Mediana semanal | 707 (32 semanas, com as 2 parciais) | 706 (31 completas) ✔ |
| Mix | Tradicional 33,5%, Doce de Leite 31,1%, Maracujá 13,3% | 33,5% / 31,1% / 13,3% ✔ |
| Perfil (dom/qua/qui/sex/sáb) | 320 / 2.020 / 3.910 / 4.794 / 1.787 | idêntico ✔ |
| Perfil (seg/ter) | 3.777 / 4.549 | 3.647 / 4.367: a diferença (130 + 182 = 312) é exatamente a semana parcial excluída ✔ |
| Custo agregado | R$ 1,52/un. | R$ 1,52/un. ✔ |
| Primeira venda | 28/02/2026 (+1 venda no ano 0206) | 28/02/2026; `vendasComDataImplausivel: 1` ✔ |

**Análise recente** (recentes 30/08–26/09 × anteriores 02/08–29/08):
- **Totais:** 2.535 → 2.350 un. (−7,3%), tendência `ESTAVEL`. É coerente com a queda leve já vista na 0.2 (ago→set −10,3% no mês). A MM4 caiu de 661,75 para 587,5.
- **Janela recente:** 101 vendas, R$ 12.920, ticket R$ 127,92, 19 pendentes (situação atual). O pagamento da janela anterior saiu como `COM_RESSALVA`, porque ela começa antes de 14/08.
- **Sabores:**

  | Sabor | Unidades | Participação | Média | Variação | Tendência |
  |---|---|---|---|---|---|
  | Tradicional | 866 | 36,9% | 216,5/sem | +3,3% | `ESTAVEL` |
  | Doce de Leite | 774 | 32,9% | 193,5/sem | −5,7% | `ESTAVEL` |
  | Maracujá | 341 | 14,5% | 85,25/sem | −2% | `ESTAVEL` |
  | Castanha | 269 | 11,4% | 67,25/sem | +15,9% | `ALTA` |
  | Prestígio | 100 | 4,3% | 25/sem | −62% | `QUEDA` |
  | Amendoim | 0 | — | — | −100% | `QUEDA` |
  | Whey Protein | 0 | — | — | sem venda nas 8 semanas (`AMBOS_ZERO`) | `INDETERMINADA` |

- **Perfil** das 8 semanas: sexta 24,9% (152,1 un. por sexta), terça 20,7%, quinta 17,5%, segunda 17,3%, sábado 9,5%, quarta 8,0%, domingo 2,1%. É o mesmo padrão de rota de entrega da 0.2.
- **Insights gerados:** "ficaram 7,3% abaixo… variação dentro da faixa considerada estável"; "Tradicional (36,9%) e Doce de Leite (32,9%) somam 69,8%"; "Sexta-feira tem a maior média observada"; "Em alta: Castanha (+15,9%)"; "Em queda: Prestígio (−62%), Amendoim (−100%)".

**Cooperação com dados reais:**
- **Demanda:** 5 sabores com movimento recente, todos `SUFICIENTE`.
- **Produção × demanda:**
  - Tradicional: 201,5 × 216,5, `ALINHADA`;
  - Doce de Leite: 197,5 × 193,5, `ALINHADA`;
  - Prestígio: 24,25 × 25, `ALINHADA`;
  - Castanha: 63,5 × 67,25, `ALINHADA`;
  - Maracujá: 67,5 × 85,25, **`PRODUCAO_ABAIXO_DA_DEMANDA`**.
- **Divergências em semanas de demanda:** Tradicional −56 = 0,26; Doce de Leite −37 = 0,19; Maracujá −34 = 0,40; Prestígio −11 = 0,44; Castanha −12 = 0,18. Isso é coerente com a 0.2: "o déficit equivale a ~0,2 semana de vendas".
- **Recomendações do Estoque:** continuam `CONTAGEM_FISICA` (ALTA) e `CADASTRAR_RECEITAS` (MEDIA).

## 19. Performance

| Medição | Inteligência (`ANALISAR`) | Estoque + cooperação completa | Filha `DEMANDA_MEDIA` |
|---|---|---|---|
| Dados reais, contexto em memória (sem gravar auditoria) | 61–105 ms | 119–138 ms | ~13 ms (mensagem) |
| Cenário acadêmico, runtime **com auditoria**, 3 execuções | 319 / 188 / 86 ms | 809 / 347 / 255 ms | 63 / 32 / 35 ms |

- **Tools mais caras (dados reais):** `consultarEstoqueAcabado` 44 ms (Etapa 2, carrega todos os itens); `consultarVendasDiariasPorSabor` 28 ms em 12 semanas e 10 ms em 4; `consultarVendasPeriodo` 10–22 ms.
- **Custo da auditoria:** na execução auditada, o tempo extra vem das escritas de `ChamadaTool` (8 a 12 por análise), da mensagem e das recomendações. A 1ª execução inclui o aquecimento de conexões.
- **Tamanho das saídas:** Inteligência 7,6 KB e Estoque 6,3 KB no cenário, abaixo do limite de 32 KB da auditoria.
- **Consultas:** sem N+1 e sem consulta duplicada. As duas chamadas a `consultarVendasPeriodo` são as duas janelas.
- Nada precisou ser otimizado.

## 20. Testes

**Novos: 70.**

| Arquivo | Testes | Cobertura |
|---|---|---|
| `inteligenciaCalculos.test.js` | 43 | Semanas (quarta, sábado parcial, domingo, virada do ano); série com zeros e parcial excluída; **MM4** (7 casos); **variação** (8 casos, sem Infinity/NaN); **tendência** (11 fronteiras + insuficiente); **suficiência** (5 casos); demanda média; **perfil** (empate, por sabor, vazio); indicadores e ressalva de 14/08; custo agregado; sabores e **insights com texto exato**; **independência de TZ** (UTC, Manaus, Tóquio) |
| `inteligenciaAgente.test.js` | 17 | `ANALISAR_INTELIGENCIA` completo no cenário acadêmico (sem escrita, sem nome de cliente, sem chave de previsão); perfil por sabor e janela 8; auditoria com resumo; `DEMANDA_MEDIA` com vários sabores, sabores ativos, curto, sem histórico e janela 8; **data implausível**; 5 pedidos inválidos; tool falhando; modo degradado (2); banco vazio; histórico curto; DIAGNOSTICO e PING |
| `cooperacao.test.js` | 8 | Cenário multiagente; **cadeia de auditoria completa**; Inteligência lança erro; tool da Inteligência falha; resposta fora do contrato; profundidade 0; **loop contido**; API autenticada (Estoque, `DEMANDA_MEDIA`, `ANALISAR_INTELIGENCIA`, 401) |
| `tools.test.js` | +1 | Estoque e Inteligência não se importam |
| `periodos.test.js` | +1 | `diaDaSemanaISO` e `inicioDaSemanaISO` (virada do ano; iguais a `intervaloDaSemana`) |

**Testes anteriores ajustados por evolução deliberada (nenhum removido):**

| Teste | Motivo |
|---|---|
| `estoqueAgente`: cenário acadêmico | A contagem de "nenhuma escrita" deixou de incluir mensagens: agora há uma mensagem por desenho. O teste passou a **afirmar** a cooperação (`DADOS_INSUFICIENTES`/`SEM_HISTORICO` → `SEM_CONCLUSAO`) |
| `estoqueAgente`: auditoria | Antes exigia `mensagens = []` ("não simula cooperação"). Agora exige a mensagem `DEMANDA_MEDIA` `RESPONDIDA` e a filha |
| `estoqueRegras`: contrato | O contrato preparado foi formalizado (semanas, `metodologia`, coerência qualidade × média, dia existente) |
| `tools.test.js`: catálogo | 11 → 13 tools |

**Bug real encontrado pelos testes:** no Zod 4, o `refine` de "dia existente" roda mesmo depois de o regex falhar. Com `"30/09/2026"`, isso lançava `Invalid time value` em vez de dar erro de validação. Foi corrigido e o caso ficou no teste do contrato.

## 21. Baseline antes e depois

| | Antes (Etapa 2) | Depois (Etapa 3) |
|---|---|---|
| Testes / arquivos | 387 / 23 | **457 / 26** |
| Novos | — | +70 (3 arquivos novos; +1 em `tools.test.js`; +1 em `periodos.test.js`) |
| Removidos | — | 0 |
| `KNOWN_BEHAVIOR` | 34 | 34 (fora do escopo) |

O `baseline.json` foi atualizado com motivo e histórico (202 → 232 → 265 → 344 → 387 → 457).

**Validação final:**

| Validação | Resultado |
|---|---|
| Parte A: gate em `50fcf6d` (antes do commit da Etapa 2) | 387/387 em 23/23, aprovado, com 1 queda nativa 0xC0000409 refeita pelo mecanismo aprovado |
| `npm test` com `TZ=UTC` | **457/457 em 26/26**, gate aprovado |
| `npm test` com `TZ=America/Manaus` | **457/457 em 26/26**, gate aprovado |
| `npm run test:guardas` | 33/33 |
| `node --check` | 113/113 arquivos |
| `prisma validate` / migrations | schema válido e **inalterado**; as mesmas 2 migrations; dev "up to date" |
| Produção | nenhuma conexão, nenhuma migration, sem deploy |

## 22. Limitações

| Limitação | Situação |
|---|---|
| Limiar de 15% calibrado no **total** | Por sabor, o ruído é maior (Castanha +15,9% está colada no limiar). A tendência por sabor deve ser lida com cautela; o volume mínimo de 20 un. é baixo para sabores pequenos. Revisável na avaliação experimental |
| Duas visões de ritmo no Estoque | A janela de 30 dias da Etapa 2 (alertas `RITMO_*`) e a comparação por semanas completas desta etapa coexistem e podem divergir nas bordas. Ao montar o cenário, uma produção às segundas caía fora da janela de 30 dias e gerava um alerta "abaixo" contra uma comparação semanal "alinhada". Unificar fica para a Etapa 4 |
| SQL específico de MySQL | `DATE_FORMAT` em `vendasDiariasPorSabor`; o projeto é só MySQL |
| `MensagemAgente.resposta` limitada a 8.000 caracteres na auditoria | Com até 7 sabores ocupa ~2 KB. Com 50 sabores pode ser guardada truncada; o Estoque recebe a resposta inteira |
| Custos por data de compra | A janela de 4 semanas oscila (R$ 1,06 × R$ 1,52/un.); o aviso acompanha o indicador |
| "Pendente" | É a situação atual do registro; a análise de recebíveis só vale desde 14/08 |
| Sem recomendações da Inteligência | Por escolha: nenhum achado justificava ação persistida |
| Ressalvas anteriores | Limiares iniciais; deduplicação sem trava única; sem inventário físico; ação pode ficar em `EXECUTANDO`; migrations fora de produção; sem LLM real; instabilidade nativa do Vitest no Windows (vista de novo na Parte A) |

## 23. Arquivos alterados

**Novos:**
- `backend/src/agents/agentes/inteligencia/{index,analise,calculos}.js`
- `backend/src/agents/tools/indicadores.js` (`consultarVendasDiariasPorSabor`, `consultarCustosPeriodo`)
- `backend/tests/sma/{inteligenciaCalculos,inteligenciaAgente,cooperacao}.test.js`
- `backend/tests/sma/cenarioInteligencia.js` (cenário acadêmico compartilhado)
- `docs/tcc/etapa-3-agente-inteligencia.md`

**Alterados:**
- `backend/src/agents/agentes/stubs.js`: o stub `inteligencia` foi removido.
- `backend/src/agents/index.js`: registra o agente real.
- `backend/src/agents/agentes/estoque/{analise,regras}.js`: pede `DEMANDA_MEDIA`, compara produção × demanda, contextualiza divergências, qualidade da demanda e modo degradado.
- `backend/src/agents/contratos/demandaMedia.js`: contrato formalizado.
- `backend/src/agents/tools/{index,vendas}.js`: 2 tools no catálogo; `resumir` em `consultarVendasPeriodo`.
- `backend/src/services/vendasService.js` (`vendasDiariasPorSabor`, `DATA_MINIMA_PLAUSIVEL`) e `custosService.js` (`totalCustosPeriodo`): **só funções novas**.
- `backend/src/lib/periodos.js`: `diaDaSemanaISO` e `inicioDaSemanaISO`.
- `backend/tests/caracterizacao/{baseline.json,periodos.test.js}`.
- `backend/tests/sma/{estoqueAgente,estoqueRegras,tools}.test.js`: os ajustes do §20.

**Não alterados:**
- schema e migrations;
- frontend e n8n;
- rotas, controllers e serviços HTTP de domínio;
- dados reais, receitas e pagamentos.

Nenhum cron, evento ou provedor de LLM foi adicionado.

## 24. Preparação para a Etapa 4

- **Saídas estruturadas prontas para consumo:** o resumo gerencial e a `DEMANDA_MEDIA` são JSON validado, com `qualidadeDados`, `limitacoes` e textos determinísticos. Atendimento e Coordenador podem usá-los sem LLM, e o LLM futuro só reformula o que já está calculado.
- **Agente de Vendas:** pode reutilizar `consultarVendasPeriodo` (agora com auditoria sem nomes) e o critério de suficiência.
- **Coordenador:** a intenção `DIAGNOSTICO_INTELIGENCIA` continua; uma intenção "resumo gerencial" pode rotear para `ANALISAR_INTELIGENCIA`.
- **Sugestão de produção:** a comparação produção × demanda por semanas completas é a base. Ela só vira sugestão depois de três pré-requisitos do negócio: contagem física (inventário), estoque mínimo e receitas.
- **Avaliação experimental:** `calculos.js` é puro e recebe a data de referência, então dá para reprocessar qualquer data histórica e comparar com o realizado nas semanas seguintes (avaliação **descritiva**, não de previsão). Os cenários de `cenarioInteligencia.js` e da Etapa 2 servem de casos fixos.
