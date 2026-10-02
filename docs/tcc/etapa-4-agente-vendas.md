# Etapa 4 — Agente de Vendas e cooperação entre três especialistas

**Data:** 02/10/2026
**Base:** Etapa 0.2 (dados reais), Etapa 0.5 (política temporal), Etapa 1 (infraestrutura SMA), Etapas 2 e 3 (Estoque, Inteligência)
**Branch de trabalho:** `feat/etapa-2-agente-estoque`, a partir de `5348da0` (commit da Etapa 3). **Sem commit**, aguardando revisão. Sem push e sem deploy.

---

## 1. Objetivo

1. Transformar o stub `vendas` em um **agente funcional e determinístico**: indicadores, recebíveis, recorrência de clientes, mix e exposição por sabor.
2. Permitir **propostas seguras** de venda e de pagamento: `AcaoProposta` sempre `PENDENTE`, nunca executada pelo agente.
3. Adicionar a cooperação **Estoque → Vendas** (`EXPOSICAO_CLIENTES_POR_SABOR`) ao lado da cooperação **Estoque → Inteligência** (`DEMANDA_MEDIA`).
4. Pagar a dívida da Etapa 3: **unificar as duas visões de ritmo** do Estoque.

Com isso, o Estoque deixa de dizer só "a produção está abaixo da demanda recente". Quando há dados, ele também diz: "esse sabor teve compras de N clientes com histórico de recompra (X% das unidades)". Ele não prevê compra e não afirma que esses clientes vão comprar de novo.

## 2. Base real disponível

A Etapa 0.2 registrou: 901 vendas, 21.177 unidades, 32 semanas contínuas, cerca de 90% dos clientes com recompra, Tradicional + Doce de Leite ≈ 64,5% das unidades, pagamentos reais só desde 14/08/2026 e, em 29/09, 36 pendentes (≈ R$ 4.963).

Esses números foram usados como **contexto e conferência**. O agente calcula tudo a partir das tools, e a validação somente leitura (§21) reproduziu, por exemplo:
- **36 pendentes e R$ 4.963,00**;
- **47 de 52 clientes com recompra (90,4%)**.

## 3. Limites semânticos

| Pode afirmar (fato observado) | Nunca afirma (sem regra real) |
|---|---|
| cliente comprou / recomprou | cliente inadimplente |
| intervalo histórico entre compras (mediana) | cliente "deveria" ter pago ou comprado |
| venda **pendente** há X dias (**tempo em aberto**) | venda **vencida** ou **atrasada** (não existe vencimento no sistema) |
| sabor representa X% das unidades | cliente vai comprar / abandonou |
| cliente está **fora do próprio padrão histórico** de compra | previsão de compra |

**Vocabulário do código:** `PENDENTE_NO_REGISTRO`, `TEMPO_EM_ABERTO` (as faixas), `FORA_DO_PADRAO_HISTORICO`, `DENTRO_DO_PADRAO` e `DADOS_INSUFICIENTES`.

**Proteção nos testes:** os testes varrem as saídas e falham se aparecer "inadimpl", "atrasad", "vencid", "vai comprar", "deveria", "abandonou" ou "previs". As únicas exceções são as **negações explícitas**, como "não é atraso nem inadimplência".

## 4. Arquitetura

```text
agents/agentes/vendas/
├── index.js     o agente: ANALISAR_VENDAS, EXPOSICAO_CLIENTES_POR_SABOR, PROPOR_VENDA,
│                PROPOR_MARCAR_VENDA_PAGA, DIAGNOSTICO, PING, PERGUNTA
├── analise.js   analisarVendas(contexto, parametros), calcularExposicao, proporVenda, proporPagamento
└── regras.js    funções PURAS: tempo em aberto, recorrência, mediana, mix, exposição,
                 recomendações agregadas, insights
agents/contratos/exposicaoClientes.js   contrato Estoque → Vendas (Zod)
agents/contratos/marcosDados.js         14/08/2026 e a qualidade do pagamento (compartilhado)
agents/comum/indicadoresVendas.js       indicadores de vendas (extraído da Inteligência; a mesma regra nos dois)
lib/periodos.js                         + semanasCompletas (janela canônica) e diasEntre
```

- **Data de referência:** toda análise aceita `dataReferencia`. Sem ela, usa hoje em `America/Manaus`.
- **Funções puras sem relógio:** um teste roda recebíveis, recorrência e mix com `TZ=UTC`, `America/Manaus` e `Asia/Tokyo` e exige saídas idênticas.
- **Sem acoplamento entre agentes:** o teste estático de arquitetura agora cobre os **três** especialistas (nenhum importa outro) e as pastas `comum/` e `contratos/` (sem Prisma, services ou controllers).

## 5. Tools

| Tool | Nova? | Uso |
|---|---|---|
| `consultarVendasPeriodo` | reutilizada | Indicadores da janela |
| `consultarVendasDiariasPorSabor` | reutilizada (Etapa 3) | Mix e nomes dos sabores |
| `consultarRecebiveis` | reutilizada (+`resumir`) | Pendências atuais. **Antes, a auditoria gravava os nomes dos clientes; agora guarda só totais** |
| `consultarComprasClientes` | **nova** | Ocasiões de compra por cliente e **dia** (`GROUP BY` no banco; só ids) |
| `consultarUnidadesClienteSabor` | **nova** | Unidades por cliente × sabor na janela (`GROUP BY`; só ids) |
| `proporAcao` | reutilizada (Etapa 1) | Única escrita: `AcaoProposta` `PENDENTE` |

**Eficiência:** as duas tools novas agregam no banco (`DATE_FORMAT` sobre o relógio de Manaus, com parâmetros ligados) e **excluem datas implausíveis** (< 2020). O agente recebe uma linha por cliente e dia, e não as vendas: no histórico real, 26 ms.

## 6. Indicadores

Na janela canônica de 4 semanas completas, os indicadores são: vendas, unidades, faturamento registrado, ticket médio, unidades por venda, vendas pagas e pendentes, valor pendente, sabores, clientes compradores e participação por sabor.

A regra é a **mesma** da Inteligência: `indicadoresVendas` foi extraída para `agents/comum/`, sem duplicação. Ela ganhou `historicoPagamento: { confiavelDesde: "2026-08-14", classificacao: OPERACIONAL | COM_RESSALVA }`.

## 7. Recebíveis

São as vendas com `pago = false` **no registro atual**, com data até a referência. Para cada uma, a saída traz: `vendaId`, `clienteId` (**sem nome**), `valor`, `unidades`, `dataVenda`, **`diasEmAberto`** e a faixa.

| Faixa (`FAIXAS_TEMPO_EM_ABERTO`) | Significado |
|---|---|
| `0-7`, `8-15`, `16-30`, `31+` | **Tempo em aberto** desde a venda, não prazo de vencimento |

**Totais:** quantidade, valor pendente, clientes distintos, valor por faixa e maior tempo em aberto.

**Casos de borda:**
- vendas posteriores à referência são contadas à parte (`posterioresAReferencia`);
- se a tool listar menos que o total, a saída avisa (`truncado`).

**O agente nunca propõe marcar pagamento a partir dessa análise.** Testes garantem que `ANALISAR_VENDAS` não cria nenhuma `AcaoProposta`.

## 8. Qualidade de pagamentos

Toda saída sobre pagamento carrega o metadado:

```json
"historicoPagamento": { "confiavelDesde": "2026-08-14", "classificacao": "OPERACIONAL" | "COM_RESSALVA" }
```

- **Indicadores:** a classificação é `COM_RESSALVA` se a janela começa antes de 14/08 e `OPERACIONAL` se começa depois.
- **Recebíveis:** é `COM_RESSALVA` se a pendência mais antiga é anterior a 14/08.
- **Texto padrão:** "Pendente = venda ainda não marcada como paga no registro atual. Não existe data de vencimento: tempo em aberto não é atraso nem inadimplência. `dataPagamento` registra quando o gestor marcou a venda, não o recebimento."
- **Prazo de recebimento:** não é calculado. O período confiável é curto (6,5 semanas), e o backfill **nunca** é usado para medir comportamento de pagamento.

## 9. Recorrência

**Compra = dia com venda para o cliente.** Várias vendas no mesmo dia contam como uma ocasião, o que evita intervalos de 0 dia.

Para cada cliente: número de compras, primeira e última compra, **intervalos** entre compras consecutivas (dias civis), **mediana** dos intervalos, maior intervalo e **dias desde a última compra**.

**A mediana é usada, e não a média:** uma pausa longa isolada (férias, por exemplo) não distorce o intervalo típico. No teste, `[7, 60, 7, 7]` dá mediana 7 e máximo 60.

**Amostra mínima:** `MIN_COMPRAS_RECORRENCIA = 4`, ou seja, 3 intervalos completos. Abaixo disso, o cliente fica `DADOS_INSUFICIENTES`, sem limite nem classificação de padrão. Clientes com 2 ou 3 compras estão testados.

A escolha foi validada na cópia real: com mínimo 3, seriam **45** clientes elegíveis de 52; com 4, **41**; com 5, **40**. O número é estável, e 4 segue a sugestão.

## 10. Heurística de padrão histórico

```text
FORA_DO_PADRAO_HISTORICO  ⇔  diasDesdeUltimaCompra > 2 × mediana(intervalos do próprio cliente)
```

Ou seja: **"já se passou mais que o dobro do intervalo típico desse cliente"**. Exatamente 2× fica dentro do padrão (testado: 20 dias com mediana 10).

**Calibração na cópia real** (41 elegíveis, referência 29/09, só agregados):

| Regra candidata | Fora do padrão | Observação |
|---|---|---|
| **> 2 × mediana (escolhida)** | **5** | Simples e explicável; usa o comportamento do próprio cliente |
| > mediana + 3 × MAD | 5 | Mesmos 5 casos, mais complexa |
| > max(2 × mediana, mediana + 7) | 5 | Piso absoluto não mudou nada no volume real |
| > maior intervalo já visto | 3 | **Não detecta** quem teve uma única pausa longa no passado (ex.: mediana 11,5, 39 dias sem comprar, mas uma pausa antiga de 70) |
| > percentil 90 dos intervalos | 3 | Com poucos intervalos, o p90 vira o máximo (mesmo problema) |

**Os 5 casos reais** (compras / mediana / dias desde a última): 4/23/61; 9/11,5/39; 8/15/32; 9/6,5/26; 5/6/74.

É um **desvio do comportamento observado**, não previsão: a saída e a recomendação dizem isso explicitamente.

## 11. Mix de sabores

Na janela, o mix traz unidades por sabor, **participação** (soma ≈ 100%, testado), **ranking** e **concentração**: maior participação, duas maiores e índice de Herfindahl.

A concentração é **insight, não alerta**. A saída diz: "Concentração descreve o mix; não é problema por si só." Um período vazio dá participações `null` e nenhum insight de mix.

## 12. Exposição por sabor

O contrato `EXPOSICAO_CLIENTES_POR_SABOR` (`contratos/exposicaoClientes.js`) funciona assim:

- **Pedido** `{ dataReferencia?, janelaSemanas? (4–12), saborIds (1–50, obrigatório) }`, validado pelo Vendas (`.strict()`).
- **Janela:** as **mesmas** 4 semanas completas do ritmo e da demanda.
- **Resposta por sabor:** `unidadesRecentes`, `clientesComCompraRecente`, `clientesRecorrentes` (clientes com 4+ dias de compra até a referência), `clientesSemHistoricoSuficiente`, `unidadesDeClientesRecorrentes`, `participacaoClientesRecorrentes` (%) e `qualidade` (`COM_VENDAS_NA_JANELA` ou `SEM_VENDAS_NA_JANELA`).
- **Privacidade:** a resposta é **só agregada**. O contrato **rejeita** campos extras (por exemplo, uma lista de `clienteIds`). Nomes e ids de clientes nunca saem na mensagem. Isso protege a privacidade e mantém a `MensagemAgente` pequena: 727 bytes no cenário e 1.755 bytes com 5 sabores reais, longe do limite de 8 KB.
- **Semântica:** "Exposição recente a clientes que historicamente recompram; não indica que eles vão comprar de novo."

## 13. Recomendações

São **no máximo duas, agregadas e deduplicadas**, pelo mecanismo da Etapa 2 (chave em `dados.controle`):

| Tipo | Quando | Prioridade | Dados |
|---|---|---|---|
| `REVISAR_RECEBIVEIS_PENDENTES` | Enquanto houver pendência (**sem limiar monetário**) | BAIXA; **MEDIA** se alguma estiver na faixa `31+` | Quantidade, valor, faixas, `vendaIds` |
| `REVISAR_CLIENTES_FORA_PADRAO` | Algum elegível fora do padrão | BAIXA | `clienteId`, compras, mediana, dias desde a última |

- **Uma recomendação por tema**, com a lista nos dados. Na base real seriam 5 clientes numa recomendação só, e não 5 recomendações.
- **Resolução automática:** com todas as pendências marcadas como pagas, a recomendação de recebíveis é resolvida na análise seguinte (testado).
- **Falha de consulta:** se uma área falha, a recomendação dela **não** é resolvida por engano.

## 14. Propostas de ação

| Intenção | Ação proposta | Regras |
|---|---|---|
| `PROPOR_VENDA` | `REGISTRAR_VENDA` **PENDENTE** | Ids explícitos (`clienteId`, `sabores[].saborId`); **`valor` informado pelo gestor** (KNOWN_BEHAVIOR K7: não é calculado pelo preço); `desconto`, `data` e `pago` opcionais, como o executor já suporta |
| `PROPOR_MARCAR_VENDA_PAGA` | `MARCAR_VENDA_PAGA` **PENDENTE** | Só com `vendaId` informado; a venda precisa existir (404) e não estar paga (409) |

- **Só pela tool:** o agente chama apenas a tool `proporAcao`. O payload é validado pelo **contrato da ação** (Etapa 1); o agente não importa o executor. Falha de validação, 404 ou 409 viram execução `FALHA` controlada, com mensagem clara.
- **Sem texto livre:** não há resolução de nomes. Payload com nome em vez de id é rejeitado (testado).
- **Nada é executado:** a venda continua pendente até o gestor aprovar em `/api/agentes/acoes/:id/aprovar`.

**Idempotência (sem migration):**
- **Regra:** em `servicoAcoes.proporAcao`, se já existe uma ação `PENDENTE` do mesmo tipo com o **mesmo payload validado** (igualdade de JSON no banco), ela é devolvida com `reaproveitada: true` em vez de criar outra.
- **Depois de decidida**, a mesma intenção volta a criar ação nova, porque pode ser uma venda legítima repetida (testado com rejeição).
- **Limite:** duas propostas **simultâneas** idênticas ainda podem duplicar (risco registrado).
- **Teste ajustado:** um teste da Etapa 1 criava duas propostas idênticas de propósito e foi ajustado (§23).

## 15. Cooperação Estoque ↔ Vendas

**Quando o Estoque consulta o Vendas** (`saboresParaExposicao`), o sabor precisa:
- ter **produção ou venda na janela canônica**; e
- ter **produção abaixo da demanda** na janela canônica **ou** uma **divergência histórica** (`SALDO_NEGATIVO` ou `VENDA_SEM_PRODUCAO`).

O filtro de movimento veio da validação real. Sem ele, 7 sabores eram consultados, 2 deles **parados** na janela ("Sabores Diversos" e "Whey Protein", com saldo antigo negativo e exposição zero). Com ele, são 5. A divergência é critério **local**, então a consulta acontece mesmo se a Inteligência falhar.

**Como o Estoque usa a resposta:**
- valida pelo contrato **e pela janela**: período diferente → `JANELA_DIVERGENTE`, descartado;
- cria a seção `clientes`, com os motivos da consulta por sabor e um texto: *"Tradicional teve compras de 2 cliente(s) nas 4 semanas completas (30/08 a 26/09); 2 deles com histórico de recompra, responsáveis por 100% das unidades do sabor."*

O Estoque **não** transforma isso em "produza X" nem em "esses clientes comprarão X".

## 16. Cooperação combinada com Inteligência

```text
                  Inteligência
                  ▲          │
                  │          │ demanda
                  │          ▼
                Estoque
                  │
                  │ exposição
                  ▼
                 Vendas
```

```text
Estoque (ANALISAR_ESTOQUE, profundidade 0)
   ├── tools locais: estoque, matéria-prima, receitas, fluxos da janela canônica
   ├── DEMANDA_MEDIA ─────────────────▶ Inteligência (filha, prof. 1) ─▶ consultarVendasDiariasPorSabor
   ├── ritmo canônico + alertas
   ├── EXPOSICAO_CLIENTES_POR_SABOR ──▶ Vendas (filha, prof. 1) ─▶ diárias, cliente×sabor, compras
   ▼
Diagnóstico consolidado (ritmo, divergências em semanas de demanda, contexto de clientes)
```

O **Estoque continua sendo o agente que consolida** este diagnóstico específico: a decisão sobre o que é relevante para estoque e produção é dele.
- **Inteligência:** conhecimento **temporal** (demanda média recente e suficiência da amostra).
- **Vendas:** conhecimento **relacional** (quem compra e com que recorrência).

As duas não conversam entre si nesta etapa, e nenhuma importa a outra.

## 17. Unificação do ritmo do Estoque

**Antes:**
- a Etapa 2 gerava alertas `RITMO_*` com janelas de **7 e 30 dias** terminando na referência;
- a Etapa 3 comparava produção × demanda em **semanas completas**.

As duas visões podiam se contradizer. Em dados reais, a de 30 dias gerava **3** alertas `RITMO_PRODUCAO_ABAIXO_VENDAS` e a semanal só 1.

**Agora há uma visão só:**
- **Janela:** a canônica, 4 semanas completas de `lib/periodos.semanasCompletas`. É a **mesma função** usada por Inteligência e Vendas, e a resposta da Inteligência é aceita só se `metodologia.periodo` for igual a ela.
- **Consulta:** uma só (`consultarProducaoVendasPeriodo` na janela). As janelas de 7 e 30 dias **saíram da decisão e do código**.
- **Situação por sabor** (`ritmo.sabores[].situacao`): `PRODUCAO_ABAIXO_DA_DEMANDA` (vendido ≥ 20 e razão < 0,9), `PRODUCAO_ACIMA_DA_DEMANDA` (produzido ≥ 20 e razão > 1,5 ou sem venda), `ALINHADA` ou `SEM_CONCLUSAO` (`DADOS_INSUFICIENTES`, `SEM_HISTORICO` ou `VOLUME_BAIXO`).
- **Com a Inteligência:** sabor sem amostra suficiente não gera conclusão, e o alerta "abaixo" sai como **MEDIA**.
- **Sem ela:** os mesmos fluxos locais; alerta **BAIXA**, `fonteDemanda: "FLUXO_LOCAL"`.
- **Alertas:** `alertasRitmo` deriva **só** dessa visão, sem alertas contraditórios.
- **MRP:** a simulação técnica passou a usar o volume vendido na janela canônica.

**Efeito no cenário acadêmico da Etapa 2.** Ele tem 1 semana de histórico. Antes, Tradicional recebia `RITMO_PRODUCAO_ABAIXO_VENDAS` porque a janela de 30 dias contava a venda de 28/09, que está na semana **parcial**. Agora Tradicional é `DADOS_INSUFICIENTES` e o ritmo fica `SEM_CONCLUSAO`. **Uma semana não estabelece ritmo.** A divergência e a contagem física continuam.

**Real (29/09):** só Maracujá fica abaixo (0,79, MEDIA). Tradicional (0,93), Doce de Leite (1,02), Castanha (0,94) e Prestígio (0,97) ficam alinhados, coerente com a comparação semanal já vista na Etapa 3.

## 18. Modo degradado

**Vendas (`ANALISAR_VENDAS`):**
- cada área depende de tools diferentes;
- recebíveis indisponíveis → recorrência e mix continuam;
- compras e série indisponíveis → indicadores e recebíveis continuam;
- a saída traz `resumo.modoDegradado` e `falhasDeConsulta`.

**Vendas (`EXPOSICAO`):** sem dados, a execução **falha explicitamente** (503), para o solicitante saber que não recebeu contexto.

**Estoque:** as falhas são independentes e todas testadas:

| Situação | Resultado |
|---|---|
| Vendas falha | Estoque conclui; `clientes` `FALHA_AGENTE_VENDAS` (com `execucaoVendasId`); a Inteligência responde normalmente; mensagem e filha com `FALHA` |
| Inteligência falha | O Vendas **ainda é consultado** (divergência local); ritmo `FLUXO_LOCAL` (BAIXA) |
| As duas falham | Estoque conclui só com dados locais; as duas mensagens `FALHA`; recomendações mantidas |
| Vendas responde com outra janela | `JANELA_DIVERGENTE`, descartado |

Em todos os casos, `resumo.cooperacao` mostra `{ inteligencia, vendas }` como `RESPONDIDA`, `FALHA` ou `NAO_SOLICITADA`, e `modoDegradado` fica `true`.

## 19. Auditoria

- **Execução direta de Vendas:** `ExecucaoAgente` → 5 `ChamadaTool` com **resumo**, sem nomes de clientes (testado) → indicadores, recebíveis, recorrência e mix na saída → `Recomendacao` agregadas.
- **Cooperação:** `GET /api/agentes/execucoes/:id` mostra:
  - as **duas** `MensagemAgente` (pedido, resposta, `execucaoDestinoId`);
  - as **duas filhas** (`gatilho: MENSAGEM`, `profundidade: 1`);
  - no detalhe de cada filha, `recebidas` e as tools com entrada e duração;
  - a prova de uso: a seção `clientes` do Estoque contém exatamente os números da resposta, e os fluxos foram consultados na janela devolvida pela Inteligência.
- **Ação proposta:** `vendas` → `proporAcao` (`ChamadaTool`) → `AcaoProposta` `PENDENTE` com `criadaPorAgente: "vendas"` e `execucaoId`. Nada é aprovado, executado ou marcado como pago.

## 20. Cenário acadêmico

Arquivo `tests/sma/cenarioVendas.js`, sintético e reprodutível, com referência na quarta 30/09/2026 e janela 30/08–26/09:

| Elemento | Dados | Esperado | Obtido |
|---|---|---|---|
| Cliente A | Tradicional a cada 10 dias, última 05/09 (há 25 dias) | `FORA_DO_PADRAO_HISTORICO` | ✔ (mediana 10, limite 20) |
| Cliente B | 2 compras | `DADOS_INSUFICIENTES` | ✔ |
| Cliente C | toda segunda + Maracujá no mesmo dia de uma delas | dentro do padrão; mesmo dia = 1 compra | ✔ (8 compras, 9 dias, limite 14) |
| Tradicional | 90 un., todas de A e C | alta exposição | 2 clientes, 2 recorrentes, **100%** |
| Maracujá | 45 un., 5 de recorrentes | baixa exposição | 3 clientes, 1 recorrente, **11,1%** |
| Recebíveis | 3 pendentes | faixas e ressalva | `31+`, `16-30`, `8-15`; R$ 247,50; `COM_RESSALVA` (a mais antiga é de 06/08); recomendação MEDIA |

**Fluxo de três especialistas:**
1. Estoque detecta Tradicional: produção 10/sem × demanda 22,5/sem (0,44), alerta MEDIA, e saldo −20.
2. Inteligência responde com a demanda (Tradicional `SUFICIENTE`; Maracujá `DADOS_INSUFICIENTES`).
3. Vendas responde com a exposição **só de Tradicional**. Maracujá não é relevante e não é consultado.
4. Estoque consolida: divergência = 0,89 semana de demanda; 2 clientes recorrentes (100% das unidades).

Nenhuma venda, produção ou ação é criada.

## 21. Validação opcional em dados restaurados

A validação rodou na cópia local `doces_maloca_restore_20260929_195116`, com referência em 29/09/2026.

**Proteções:**
1. O usuário MySQL tem só `SELECT`, e a escrita deliberada de teste foi **negada pelo banco**.
2. O middleware do Prisma registrou **0** tentativas de escrita.
3. O `CHECKSUM TABLE` ficou **idêntico** antes e depois (`91590b4c`) em todas as rodadas.
4. Nenhuma conexão com produção.

**Método:** o código **real** dos agentes rodou com contexto em memória (mensagens roteadas em processo, sem gravar auditoria). Os resultados foram **idênticos** com `TZ=UTC` e `America/Manaus`. Abaixo, **só agregados, sem nomes**.

| Item | Resultado | Etapa 0.2 |
|---|---|---|
| Recebíveis | **36 pendentes, R$ 4.963,00**, 27 clientes; tempo em aberto 0–7: 22 (R$ 2.987), 8–15: 0, 16–30: 8 (R$ 1.133), 31+: 6 (R$ 843); maior 41 dias; `OPERACIONAL` (todas depois de 14/08) | 36, R$ 4.963 ✔ |
| Clientes com recompra | **47 de 52 (90,4%)** | ~90% ✔ |
| Compras (dias) por cliente | 1: 5 · 2: 2 · 3: 4 · 4: 1 · 5: 1 · 6–9: 10 · 10–19: 11 · 20–49: 16 · 50+: 2 | — |
| Elegíveis (≥ 4 compras) | 41 (36 dentro do padrão, **5 fora**); 11 com dados insuficientes | — |
| Intervalos (826) | 0–1: 14 · 2–3: 143 · 4–7: 325 · 8–14: 221 · 15–21: 61 · 22–30: 36 · 31–60: 21 · 61+: 5; mediana geral **7**; mediana das medianas por cliente **10,5** | "≈ 13 dias" com outro recorte (ver §25) |
| Janela 30/08–26/09 | 101 vendas, 2.350 un., R$ 12.920, ticket R$ 127,92, 19 pendentes (R$ 2.404), 37 compradores | — |
| Mix | Tradicional 36,9%, Doce de Leite 32,9%, Maracujá 14,5%, Castanha 11,4%, Prestígio 4,3%; duas maiores 69,8%; Herfindahl 0,28 | Tradicional + DdL concentram ✔ |
| Exposição | Os 5 sabores com **94–96%** das unidades vindas de clientes recorrentes (Tradicional: 35 clientes, 32 recorrentes) | — |
| Estoque consolidado | Inteligência e Vendas `RESPONDIDA`; ritmo: 1 alerta (Maracujá 0,79, MEDIA); 5 sabores com contexto de clientes; divergências de 0,18 a 0,44 semana de demanda; `CONTAGEM_FISICA` (ALTA) e `CADASTRAR_RECEITAS` mantidas | — |

**Achado honesto:** a exposição a recorrentes é alta e **parecida para todos os sabores**. O negócio é uma rota de entrega com clientes fixos. Nos dados reais, o indicador distingue pouco entre sabores; ele serve mais para mostrar que a demanda de cada sabor vem de uma base recorrente.

## 22. Performance

| Medição | Vendas (`ANALISAR`) | `EXPOSICAO` | Estoque + Inteligência + Vendas |
|---|---|---|---|
| Dados reais, contexto em memória | 116–188 ms | 32–67 ms | 120–236 ms (mensagens: Inteligência 12–13 ms, Vendas 22–40 ms) |
| Cenário acadêmico, runtime **com auditoria** (3 rodadas) | 140–192 ms | 55–66 ms | 290–328 ms (filhas: Inteligência 26–33 ms, Vendas 50–58 ms) |

- **Tools mais caras (reais):** `consultarEstoqueAcabado` 59 ms (herdada); `consultarVendasPeriodo` 33 ms; `consultarVendasDiariasPorSabor` 31 ms; `consultarComprasClientes` 26 ms.
- **Consultas:** sem N+1. As tools novas são um `GROUP BY` cada.
- **Tamanhos reais:** saída de Vendas **22,2 KB** (a recorrência sozinha ocupa 14,1 KB) e do Estoque 17,2 KB, abaixo do limite de 32 KB da auditoria; resposta de `EXPOSICAO` 1.755 bytes.
- Nada precisou ser otimizado.

## 23. Testes

**Novos: 54.**

| Arquivo | Testes | Cobertura |
|---|---|---|
| `vendasRegras.test.js` | 25 | Recebíveis: nenhum, vários, **8 fronteiras de faixa**, anterior a 14/08, posterior à referência, valor total, sem nomes, recomendação BAIXA/MEDIA. Recorrência: regular, **fronteira 2×**, irregular (mediana × pausa), amostra mínima (1, 2 e 3 compras), mesmo dia, posteriores à referência, resumo, recomendação agregada. Mix: ranking, soma 100%, concentração, vazio. Exposição: recorrentes × não recorrentes, sem venda, vários sabores, contrato (sem ids de clientes). TZ (UTC, Manaus, Tóquio) |
| `vendasAgente.test.js` | 18 | `ANALISAR_VENDAS` completo no cenário (sem nomes, sem linguagem preditiva, sem escrita, sem ação); deduplicação e resolução automática; auditoria; 3 cenários de modo degradado; `EXPOSICAO` (vários sabores, 3 pedidos inválidos, falha explícita); `PROPOR_VENDA` (válida, **idempotência**, reaberta após rejeição, 4 inválidas); `PROPOR_MARCAR_VENDA_PAGA` (pendente, 404, 409, a venda continua pendente); análise nunca propõe pagamento; DIAGNOSTICO e PING |
| `cooperacaoTres.test.js` | 8 | Cenário de três especialistas; **auditoria das duas cadeias** (privacidade e tamanho da mensagem); sem sabor relevante não há consulta ao Vendas; Vendas falha; Inteligência falha (Vendas ainda consultado); **ambas falham**; janela divergente; API autenticada |
| `estoqueRegras.test.js` | +2 | +1 caso no ritmo canônico; regra de consulta ao Vendas (movimento na janela) |
| `periodos.test.js` | +1 | `semanasCompletas` (sábado continua parcial) e `diasEntre` |

**Testes anteriores ajustados deliberadamente (nenhum removido):**

| Teste | Motivo |
|---|---|
| `agentesHttp`: aprovar/rejeitar (Etapa 1) | Criava duas propostas **idênticas** para ter duas pendentes. Com a idempotência, a 2ª agora difere na quantidade, e o teste **afirma** `reaproveitada: true` no reenvio |
| `tools.test.js`: catálogo e arquitetura | 13 → 15 tools; o teste "nenhum agente importa outro" cobre Vendas e `comum/` |
| `estoqueRegras`: MRP e bloco de ritmo | Janelas de 7 e 30 dias → janela canônica; as mesmas fronteiras (19 vendas; 0,9 e 1,5 exatos; 20/19 produzidos), + MEDIA confirmada pela Inteligência, BAIXA local e sem conclusão com amostra insuficiente |
| `estoqueAgente`: "nunca inventa" | `compra` sozinho saiu da varredura de chaves (agora há fatos de compra de clientes). Continua proibido tudo que é **lista de compras** |
| `estoqueAgente`: cenário acadêmico da Etapa 2 | Perde `RITMO_PRODUCAO_ABAIXO_VENDAS` (histórico de 1 semana, §17) e passa a afirmar a consulta ao Vendas pela divergência |
| `estoqueAgente`: MRP sintético | A 2ª venda saiu de 29/09 (semana parcial) para 22/09, mantendo 150 un. e o propósito (insumo insuficiente) |
| `estoqueAgente` e `estoqueHttp`: auditoria | 5 → 4 tools (uma consulta de fluxos); 2 mensagens (Inteligência + Vendas) |
| `cooperacao` (Etapa 3): 6 testes | A comparação produção × demanda foi para o ritmo canônico; a cadeia agora também consulta o Vendas. O teste "Inteligência falha" passou a **provar** que o Vendas continua sendo consultado; o teste do loop conta as consultas ao Vendas em cada nível |

**KNOWN_BEHAVIOR:** nenhum novo comportamento de domínio problemático. Achado de infraestrutura da Etapa 1, corrigido: `consultarRecebiveis` gravava nomes de clientes na auditoria (`ChamadaTool.saida`); agora grava só totais. Os 34 restantes continuam fora do escopo.

## 24. Baseline antes e depois

| | Antes (Etapa 3) | Depois (Etapa 4) |
|---|---|---|
| Testes / arquivos | 457 / 26 | **511 / 29** |
| Novos | — | +54 |
| Removidos | — | 0 |
| `KNOWN_BEHAVIOR` | 34 | 34 |

**Validação final:**

| Validação | Resultado |
|---|---|
| Parte A: gate antes do commit da Etapa 3 | 457/457 em 26/26, aprovado (1 queda nativa 0xC0000409 refeita pelo mecanismo aprovado) |
| `npm test` com `TZ=UTC` | **511/511 em 29/29**, gate aprovado |
| `npm test` com `TZ=America/Manaus` | **511/511 em 29/29**, gate aprovado |
| `npm run test:guardas` | 33/33 |
| `node --check` | 124/124 arquivos |
| `prisma validate` / migrations | schema válido e **inalterado**; as mesmas 2 migrations; dev "up to date" |
| Imports | Nenhum agente importa Prisma, services, controllers ou outro agente |
| Produção | nenhuma conexão, nenhuma migration, sem deploy |

## 25. Limitações

| Limitação | Situação |
|---|---|
| Exposição pouco discriminante em dados reais | 94–96% em todos os sabores (rota com clientes fixos). Útil como contexto, fraca como critério de priorização |
| "Intervalo mediano ≈ 13 dias" da 0.2 | Não reproduzido com o mesmo recorte. Aqui a compra é o **dia com venda**: mediana geral 7 e mediana das medianas 10,5. A diferença é de método, não de dado |
| Heurística 2 × mediana | Um parâmetro só, calibrado num histórico de 7 meses; clientes com intervalos muito irregulares podem oscilar entre dentro e fora |
| Saída de Vendas cresce com o histórico | 22,2 KB hoje (recorrência 14,1 KB); com cerca de 1,5× o histórico passaria de 32 KB e seria **guardada truncada** na auditoria (o runtime recebe a saída inteira). Solução futura: resumir os intervalos na auditoria |
| Idempotência sem trava | Propostas idênticas **simultâneas** podem duplicar (mesmo limite das recomendações) |
| Status de pagamento | Sempre o do registro atual, mesmo com `dataReferencia` no passado; sem prazo de recebimento |
| Muitos sabores divergentes | Com 7 de 9 sabores negativos, a regra de relevância consulta o Vendas para 5 sabores em dados reais. Depois da contagem física, o critério de divergência perde força naturalmente |
| Ressalvas anteriores | Limiar de tendência calibrado no agregado; deduplicação sem trava única; sem inventário físico; ação pode ficar em `EXECUTANDO`; migrations fora de produção; sem LLM real; instabilidade nativa do Vitest no Windows (vista na Parte A). **Resolvidas nesta etapa:** as duas visões de ritmo (§17) e, para a exposição, o risco de truncamento da mensagem (resposta agregada de ~1–2 KB) |

## 26. Arquivos alterados

**Novos:**
- `backend/src/agents/agentes/vendas/{index,analise,regras}.js`
- `backend/src/agents/contratos/{exposicaoClientes,marcosDados}.js`
- `backend/src/agents/comum/indicadoresVendas.js`
- `backend/src/agents/tools/clientes.js` (`consultarComprasClientes`, `consultarUnidadesClienteSabor`)
- `backend/tests/sma/{vendasRegras,vendasAgente,cooperacaoTres}.test.js` e `cenarioVendas.js`
- `docs/tcc/etapa-4-agente-vendas.md`

**Alterados:**
- `agents/agentes/stubs.js`: o stub `vendas` e o gerador de stubs, sem uso, foram removidos.
- `agents/index.js`: registra o Vendas.
- `agents/agentes/estoque/{analise,regras}.js`: ritmo canônico, consulta ao Vendas, seção `clientes` e `resumo.cooperacao`.
- `agents/agentes/inteligencia/calculos.js`: usa `semanasCompletas`, `indicadoresVendas` e o marco compartilhados.
- `agents/contratos/demandaMedia.js`: exporta `diaExistente`.
- `agents/acoes/servicoAcoes.js`: idempotência.
- `agents/tools/{acoes,index,vendas}.js`: `reaproveitada`, catálogo e `resumir` em recebíveis.
- `services/vendasService.js`: **só funções novas** (`comprasPorClienteDia`, `unidadesPorClienteSabor`).
- `lib/periodos.js`: `semanasCompletas` e `diasEntre`.
- `tests/caracterizacao/{baseline.json,periodos.test.js}` e `tests/sma/{agentesHttp,tools,estoqueRegras,estoqueAgente,estoqueHttp,cooperacao}.test.js` (§23).

**Não alterados:**
- schema e migrations;
- frontend e n8n;
- rotas e controllers HTTP (o endpoint genérico `/api/agentes/:nome/executar` já servia);
- dados reais e os 174 pagamentos.

Nenhum cron, evento, LLM, chat ou mensagem a cliente foi adicionado.

## 27. Preparação para a Etapa 5

- **Atendimento (LLM/linguagem natural)**, com as peças já prontas:
  - intenções estruturadas (`PROPOR_VENDA` e `PROPOR_MARCAR_VENDA_PAGA` com ids);
  - o resolver seguro de nomes da Etapa 0.6;
  - saídas determinísticas com textos prontos (`insights`, `texto` por sabor, `limitacoes`).

  O LLM só interpreta o pedido e reformula; os números vêm dos agentes.
- **Coordenador:** pode ganhar intenções como "resumo de vendas", que roteia para `ANALISAR_VENDAS`, e "situação do estoque", que roteia para `ANALISAR_ESTOQUE`, que já coopera com os outros dois.
- **Gatilhos futuros:** `analisarEstoque` e `analisarVendas` já recebem a data de referência e deduplicam recomendações, então o cron e os eventos `VENDA_REGISTRADA` e `PRODUCAO_REGISTRADA` podem chamá-las sem mudança.
- **Pré-requisitos do negócio:** os mesmos de antes, contagem física, receitas e estoque mínimo, para que a cooperação vire, um dia, sugestão de produção.
