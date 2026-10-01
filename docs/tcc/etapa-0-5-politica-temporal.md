# Etapa 0.5 — Política temporal e fuso horário

**Data:** 30/09/2026
**Base:** `docs/tcc/etapa-0-2-analise-dos-dados.md` (P11), `docs/tcc/etapa-0-3-testes-caracterizacao.md` (§9, K16, K17), `docs/tcc/etapa-0-4-extracao-servicos.md` (`lib/periodos.js`)
**Branch de trabalho:** `fix/etapa-0-5-politica-temporal`, a partir de `a8bc2bb` (commit da 0.4). Revisada e **aprovada com ressalvas** em 01/10/2026: fuso `America/Manaus`, respostas com `-04:00`, 174 pagamentos históricos não migrados, deploy coordenado futuro (não publicado).

---

## 1. Problema

O negócio opera em Manaus (UTC−4, sem horário de verão desde 1995; confirmado pelo `Intl` em §6), mas o sistema nunca definiu o que suas datas significam:

- o **frontend** grava o relógio de parede do aparelho com um sufixo `Z`, que afirma UTC sem que o horário seja UTC;
- o **backend** calcula "mês", "hoje" e "semana" com o **fuso do processo** (`new Date(ano, mes - 1, 1)`, `setHours`, `toLocaleDateString`);
- o fim de cada período é `23:59:59.000` com `lte`, o que deixa 999 ms fora de qualquer mês (K16).

Hoje o sistema acerta **por coincidência**: o container do Railway roda em UTC, e com isso os componentes UTC gravados são o relógio de Manaus. Isso só se sustenta enquanto o servidor ficar em UTC e enquanto ninguém enviar um instante UTC de verdade.

## 2. Comportamento anterior (diagnóstico)

### 2.1 O caminho de uma venda às 23:30 de 31/03 em Manaus

| Passo | Antes da 0.5 |
|---|---|
| Frontend | `comHoraAtual("2026-03-31")` → `getHours()` do **aparelho** + `".000Z"` → `"2026-03-31T23:30:00.000Z"` |
| JSON para a API | `{"data":"2026-03-31T23:30:00.000Z"}`: diz 23:30 **UTC** (19:30 em Manaus), o que é falso |
| Node | `new Date(str)` → instante 23:30Z |
| Prisma/MySQL | `DATETIME(3)` sem fuso; o Prisma grava os componentes UTC: `2026-03-31 23:30:00.000`, ou seja, **o relógio de Manaus** |
| Volta pela API | `"2026-03-31T23:30:00.000Z"` (de novo com o `Z` falso) |
| Exibição | `formatarData` corta a string ISO em `T` e mostra `31/03/2026`, lendo os componentes |
| Filtro `mes=3` | `[new Date(2026, 2, 1), new Date(2026, 3, 0, 23, 59, 59)]` **no fuso do processo**; em UTC acerta, em outro fuso desloca a borda |

### 2.2 Causa exata do K16 (23:59:59,5 fora de qualquer mês)

`intervaloDoMes` terminava em `new Date(ano, mes, 0, 23, 59, 59)`, ou seja, `23:59:59.000`, comparado com `lte`. O mês seguinte começa em `00:00:00.000`. Um valor entre `23:59:59.001` e `23:59:59.999` do último dia não satisfaz `lte` do mês nem `gte` do seguinte e **some de todos os relatórios mensais**. O mesmo vale para `dataFim + "T23:59:59"`. O frontend envia segundos `.000`, então isso só ocorre com datas que têm milissegundos: `new Date()` do servidor (padrões, `/vendas/auto`) ou um chamador externo.

### 2.3 O que aconteceria "só trocando o TZ"

Rodei a suíte da 0.4 **sem alterar código** com o processo em `America/Manaus` (suíte parametrizada em §14). Resultado: **10 de 202 testes falharam**, 9 deles de negócio:
- o custo de 01/04 foi para março: resumo de março de 150,50 → **70,50**;
- a venda de 01/04 00:30 entrou em março;
- os totais de março passaram de 38 para **45 unidades**;
- a listagem de produção e o relatório mensal também mudaram.

A causa: o histórico guarda o relógio de Manaus nos componentes UTC, e a regra antiga reinterpretava esses valores no fuso do processo. **Trocar `TZ` sem mudar a regra quebraria o histórico inteiro** (§13).

### 2.4 Outros problemas temporais encontrados

| # | Problema | Onde |
|---|---|---|
| T1 | Hora local com `Z` (o rótulo diz UTC, o valor é Manaus) | `RegistrarVenda.jsx`, `VendaDireta.jsx`, `Relatorios.jsx` (edição) |
| T2 | "Hoje", mês padrão dos filtros e data padrão dos formulários vêm do **fuso do aparelho** | `hojeFormatado()` e `new Date().getMonth()` em 6 componentes |
| T3 | Mês, semana, hoje, rótulos (`porDia`, `nomeMes`, `vendasPorMes`) no **fuso do processo** | services de vendas, produção, custos e clientes (41 pontos) |
| T4 | `dataFim + "T23:59:59"` sem fuso: `new Date` usa o fuso do processo, e a borda repete o K16 | `listarVendas` |
| T5 | Mistura de convenções em `dataPagamento`: o backfill copiou o relógio de Manaus; a marcação manual grava `new Date()` do servidor, um **instante UTC real** | `vendasService.atualizarPagamento`; 0.2 §13 |
| T6 | "Agora" do servidor (padrões sem data) grava instante UTC real num campo que o resto do sistema trata como relógio de Manaus | criação sem `data` em vendas, produção e custos |
| T7 | Pagamento marcado entre 20:00 e 23:59 de Manaus aparece com a data **do dia seguinte** (o UTC dele já virou) | `formatarData(dataPagamento)` |

## 3. Auditoria dos campos temporais

| Campo | Semântica | Frontend cria | JSON que chega | Node (antes) | Prisma/MySQL | Volta pela API (antes) | Filtros/agrupamentos (antes) |
|---|---|---|---|---|---|---|---|
| `Venda.data` | **Data-hora civil** do negócio (dia escolhido + hora do registro; `00:00` = "sem horário" nas vendas antigas) | data escolhida + hora do aparelho + `Z`; edição com hora digitada + `Z` | `"…T14:37:05.000Z"` | instante (o `Z` é tomado como UTC) | `DATETIME(3)` = relógio de Manaus | `"…Z"` | mês/ano, `dataInicio/dataFim`, `porDia`, relatório mensal, estatísticas por mês, resumo de produção: **fuso do processo** |
| `Venda.dataPagamento` | **Instante** da marcação | não envia (PATCH só com `pago`) | — | `new Date()` do servidor (UTC real); backfill = cópia de `data` | `DATETIME(3)`: **misto** (727 cópias civis + 174 instantes UTC, 0.2) | `"…Z"` | nenhum filtro; exibido pela data da string (T7) |
| `Producao.data` | **Data civil** (o dia da produção) | `"AAAA-MM-DD"` | `"2026-03-31"` | meia-noite UTC | `2026-03-31 00:00:00` | `"…T00:00:00.000Z"` | mês/ano, hoje/semana (`setHours` no processo), acumulado |
| `Custo.data` | **Data civil** (o dia da compra) | `"AAAA-MM-DD"` | idem | idem | idem | idem | mês/ano, 12 meses |
| `MovimentacaoMateriaPrima.data` | Data civil (copiada da produção ou do custo) | — | — | cópia | idem | idem (aninhada) | não entra no saldo (que é histórico inteiro) |
| `Usuario.criadoEm`, `MateriaPrima.criadoEm` | **Instante técnico** de auditoria | — | — | `@default(now())` (UTC) | instante UTC | `"…Z"` (verdadeiro) | nenhum |

Constatações:
- **Todo o histórico de negócio segue, na prática, a convenção "relógio de Manaus nos componentes UTC"**. A exceção são os `dataPagamento` manuais (T5) e os raros "agora" do servidor (T6).
- O `DateTime` do Prisma **não** garante "UTC correto": no MySQL ele é um `DATETIME` sem fuso, e o significado é o que a aplicação convenciona.

## 4. Política temporal definida

**P1. O fuso do negócio é `America/Manaus`.** Ele está explícito em `FUSO_NEGOCIO` no backend (`src/lib/periodos.js`) e no frontend (`src/utils/tempo.js`). O fuso da máquina (processo Node, container, aparelho) **nunca** entra em regra de negócio.

**P2. Campos de negócio guardam a data-hora civil de Manaus.** São eles `Venda.data`, `Venda.dataPagamento`, `Producao.data`, `Custo.data` e `MovimentacaoMateriaPrima.data`. O `DATETIME` contém o relógio de parede de Manaus. É a convenção que o histórico já segue, então **nenhum dado precisa ser migrado**. No código, esse valor é um `Date` "civil": seus componentes UTC são o relógio de Manaus.
- **Isso é inequívoco como instante.** Como o fuso é fixo, `instante = civil + deslocamento de Manaus naquela data` (−04:00). A conversão usa o `Intl`, com a base de fusos do Node, e não uma constante; `civilParaInstante` faz o caminho inverso.

**P3. Datas escolhidas pelo usuário são datas civis.** `"2026-09-29"` é o dia 29/09 do negócio (00:00 civil). Esse valor nunca passa por conversão de fuso, então não migra para 28 nem para 30.

**P4. Instantes reais viram relógio de Manaus na entrada.** "Agora" (marcação de pagamento, padrões sem data) é `agoraCivil()`: o instante real convertido para o relógio de Manaus. Uma data recebida **com** fuso (`Z` ou `±hh:mm`) é um instante e também é convertida.

**P5. Períodos de negócio são do calendário de Manaus e semiabertos** `[início, fimExclusivo)`. Isso vale para hoje, semana (domingo a sábado, como antes), mês, 12 meses, `dataInicio..dataFim` (dias inteiros) e acumulado até o fim do mês. Com o intervalo semiaberto, nenhum instante fica sem período (fim do K16).

**P6. Contrato da API (entrada)** para campos de negócio:

| Formato | Significado |
|---|---|
| `"2026-09-29"` | data civil de Manaus (00:00) |
| `"2026-09-29T14:37[:05[.123]]"` (sem fuso) | data-hora civil de Manaus: **formato canônico do frontend** |
| `"…Z"` ou `"…±hh:mm"` | instante real (ISO 8601 honesto), convertido para Manaus |
| outro formato | Invalid Date → 500, como antes para datas inválidas |

**P7. Contrato da API (saída).** Campos de negócio saem como `"2026-09-29T14:37:05.000-04:00"`: o relógio de Manaus mais o deslocamento real. É ao mesmo tempo um instante ISO 8601 correto (`new Date(s)` dá o momento certo) e legível como horário local (a data e a hora são as de Manaus). O `Z` falso deixa de existir. Instantes técnicos (`criadoEm`) continuam em UTC com `Z`, e agora esse `Z` é verdadeiro.

**P8. Instantes técnicos** (`criadoEm`) ficam em UTC (padrão do Prisma) e não participam de regra de negócio.

## 5. Semântica de cada campo

| Campo | Classe | Gravação | Leitura/agregação |
|---|---|---|---|
| `Venda.data` | data-hora civil | `lerDataCivil(data)` ou `agoraCivil()` | mês/dia/semana de Manaus |
| `Venda.dataPagamento` | instante do evento, gravado como relógio de Manaus | `agoraCivil()`, ou `lerDataCivil(dataPagamento)` se informada | exibida no dia de Manaus |
| `Producao.data` | data civil (hora opcional) | `lerDataCivil` / `agoraCivil` | mês, hoje, semana e acumulado de Manaus |
| `Custo.data` | data civil | `lerDataCivil` / `agoraCivil` | mês de Manaus |
| `MovimentacaoMateriaPrima.data` | data civil | mesma data da produção ou do custo, **o mesmo objeto** (antes eram dois `new Date()` separados por milissegundos) | — |
| `criadoEm` | instante técnico UTC | `@default(now())` | — |

## 6. `America/Manaus` como fuso do negócio

- **Offset verificado pelo `Intl`:** −04:00 em janeiro e julho de 1995, 2000, 2019 e 2026. O único horário de verão foi em 1993/94 (−03:00 em janeiro de 1994). Por isso o **relógio civil de Manaus tem uma correspondência 1:1 com o instante** em todo o período do negócio (2026). Se o Brasil voltar a adotar horário de verão no Amazonas, o `Intl` passa a refletir isso pela base de fusos do Node; o único ponto frágil seria uma hora repetida na volta do horário (§17).
- **Sem biblioteca nova.** `Intl.DateTimeFormat` com `timeZone` (IANA, completo no Node 24 e nos navegadores atuais) mais `Date.UTC`/`getUTC*` bastam para tudo o que a política exige: converter um instante para Manaus, montar datas civis e calcular períodos. Uma biblioteca (Luxon, date-fns-tz) só traria ganho real com vários fusos ou horário de verão frequente, e aqui há um fuso fixo. O módulo tem 192 linhas (e o utilitário do frontend, 37), com testes próprios.

## 7. Alterações no backend

| Arquivo | Mudança |
|---|---|
| `src/lib/periodos.js` | Virou o **módulo da política temporal** (§9) |
| `src/server.js` | `app.set("json replacer", replacerJsonTemporal)`: serializa `data`/`dataPagamento` em Manaus (P7). A ordem de middlewares e as rotas não mudaram |
| `services/vendasService.js` | Entrada por `lerDataCivil`; "agora" por `agoraCivil`; mês e `dataInicio/dataFim` semiabertos; `porDia` por `formatarDiaCivil`; `nomeMes` por `nomeDoMes`; ano padrão de Manaus |
| `services/producaoService.js` | Idem. Hoje e semana por `intervaloDoDia`/`intervaloDaSemana` de Manaus; acumulado com `lt` no início do mês seguinte; produção e saídas de insumo com a mesma data |
| `services/custosService.js` | Idem; custo e entrada de insumo com a mesma data |
| `services/clientesService.js` | `vendasPorMes` por `rotuloMesAno` (mês civil) |

Não sobrou nenhum `new Date(`, `toLocale*` ou `lte` em `src/services`. Não houve mudança de schema.

**Mudança de borda (fora dos testes, registrada):** `PUT /api/custos/:id` com `"data": null` num custo vinculado a insumo gerava uma entrada datada em 1970 (`new Date(null)`). Agora dá 500, como qualquer data inválida. O frontend nunca envia `null`.

## 8. Alterações no frontend

Só o necessário para datas, sem mudança visual:

| Arquivo | Mudança |
|---|---|
| `src/utils/tempo.js` (novo) | `hojeFormatado()`, `comHoraAtual(dataIso)` e `mesEAnoAtuais()` com o relógio de **Manaus** via `Intl`, qualquer que seja o fuso do aparelho |
| `RegistrarVenda.jsx`, `VendaDireta.jsx` | Usam o utilitário; enviam `"2026-09-30T23:59:31"`, **sem `Z`** (T1, T2) |
| `Relatorios.jsx` | Edição envia `"…T14:30:00"` / `"…T00:00:00"` sem `Z`; mês e ano padrão de Manaus |
| `Custos.jsx`, `Producao.jsx`, `Dashboard.jsx` | Data e mês/ano padrão de Manaus (já enviavam `"AAAA-MM-DD"`, que continua igual) |

A exibição (`formatarData`, `extrairHora`) **não mudou**: ela lê os componentes da string, que agora vêm com `-04:00` e continuam sendo o relógio de Manaus. `npm run build` passa. O ESLint não acusa nada novo; o erro `'error' is defined but never used` do `VendaDireta.jsx` já existia.

**Rollout:** os bundles têm hash e o HTML é *network-first* no service worker, então um recarregamento já traz o frontend novo. Uma aba aberta **antes** do deploy continua enviando `"…Z"`, que o backend novo lê como UTC real, gravando 4 h antes (por exemplo, uma edição "sem horário" de uma venda antiga iria para 20:00 do dia anterior). Recomendação: publicar o backend e o frontend juntos e recarregar o app; ou versionar o `sw.js` para forçar a atualização (não feito, para não mexer no PWA sem necessidade).

## 9. `periodos.js`

Ponto único da política (antes, 41 pontos espalhados usavam o relógio ou o calendário do processo):

| Função | Papel |
|---|---|
| `FUSO_NEGOCIO`, `CAMPOS_CIVIS` | constantes da política |
| `civil(a, m, d, h, mi, s, ms)` | monta um `Date` civil (transbordo igual ao `Date`, anos < 100 sem o salto para 19xx) |
| `paraCivil(instante)`, `agoraCivil()`, `civilParaInstante(civil)` | conversões pelo `Intl` |
| `lerDataCivil(valor)` | contrato de entrada (P6) |
| `intervaloDoMes`, `intervaloDoDia`, `intervaloDaSemana`, `intervaloEntreDatas` | períodos semiabertos `{ inicio, fimExclusivo }`. O nome do campo mudou de `fim` para `fimExclusivo` de propósito, para não ser usado com `lte` por engano |
| `mesAtualCivil()` | mês e ano correntes em Manaus |
| `formatarDiaCivil`, `nomeDoMes`, `rotuloMesAno` | rótulos pt-BR pelo calendário civil (preservam o formato anterior, inclusive `05/03/206` do registro atípico) |
| `serializarCivil`, `replacerJsonTemporal` | contrato de saída (P7) |

A aritmética usa só `Date.UTC`/`getUTC*` e `Intl` com `timeZone` explícito. Um teste roda as mesmas funções em processos com `TZ=UTC`, `America/Manaus` e `Asia/Tokyo` e exige saídas idênticas.

## 10. Testes que mudaram de expectativa

Foi seguido o processo **expectativa nova → teste falha → implementação → teste passa**:
- **vermelho:** a suíte nova, rodada contra o código da 0.4, falhou em **26 testes (UTC) / 35 (Manaus)**, e `periodos.test.js` inteiro falhou na importação;
- **verde:** 232/232 depois da implementação.

**a) Contrato de representação (valor igual, formato novo), 14 testes.** A entrada passou de `"…Z"` para o formato civil sem fuso, e a saída de `"…Z"` para `"…-04:00"`:
- **vendas (8):** criação; edição; `dataPagamento` explícita; primeira `dataPagamento` preservada; listagem sem filtro; `dataInicio/dataFim`; precedência do intervalo; filtros e `limit`;
- **produção (2):** criação; listagem;
- **custos (1):** criação;
- **clientes (2):** `/:id`; estatísticas;
- **`/vendas/auto` (1):** data informada.

Os valores gravados no banco e as asserções sobre ele **não mudaram**: continuam `"…12:00:00.000Z"` nos componentes, que são o relógio de Manaus. Em `custos.test.js`, três entradas também passaram para o formato canônico (`"2026-03-01"` e horários civis), com as mesmas expectativas.

**b) KNOWN_BEHAVIOR corrigido:** `vendas.test.js`, "venda às 23:59:59,500 do último dia do mês pertence a esse mês (K16 corrigido)". A expectativa antiga ("fora de março e de abril") virou "em março, fora de abril".

**c) K17 (dependência do fuso do servidor):** o teste "mes/ano usa o calendário do fuso do servidor (UTC)" virou "mes/ano usa o calendário civil de Manaus: 31/03 23:30 é março e 01/04 00:30 é abril". Os valores são os mesmos, mas agora valem em qualquer fuso de processo, já que a suíte roda em dois (§14).

**d) Ambiente:** `auth.test.js` passou de "roda com TZ=UTC" para "roda no TZ de processo configurado para a suíte".

**e) Só comentários:** `totais.test.js` (o dataset é o relógio civil de Manaus).

Nenhum teste foi removido.

## 11. Novos testes temporais (30)

**`periodos.test.js` (16, nível A, sem HTTP):**
- conversão instante ↔ Manaus (03:59:59,999Z ainda é o dia anterior);
- os formatos de entrada (civil, `-04:00`, `Z`, `+01:00`, `Date`, ms, só data, fração de segundo);
- rejeição de formatos inválidos, preservando o transbordo do V8 (`2026-02-30` → 02/03);
- limites de dia: 00:00:00,000, 23:59:59, 23:59:59,999 e 00:00 seguinte;
- limites de mês: fevereiro de 28 e de 29 dias, mês de 30, mês de 31, dezembro → janeiro;
- `ano`/`mes` como string e transbordo;
- semana de domingo a sábado atravessando o ano;
- `dataInicio/dataFim`;
- rótulos (inclui o ano 206);
- serialização com `-04:00`;
- replacer JSON (`criadoEm` continua em UTC);
- **independência de fuso**: as mesmas funções em processos UTC, Manaus e Tóquio.

**`temporal.test.js` (14, pela API):**
- venda no último ms do mês fica no mês, e 00:00 do dia 1º vai para o seguinte;
- virada de ano (31/12 23:59:59 × 01/01 00:00, com o relatório mensal dos dois anos);
- `porDia` e `vendasPorMes` pelo dia civil;
- civil, `-04:00` e `Z` gravam o mesmo relógio;
- data sem hora não migra de dia;
- formato inválido → 500 sem gravar;
- `dataInicio/dataFim` com bordas no milissegundo;
- mes/ano;
- produção em fevereiro (28/02 23:59:59,999 × 01/03);
- custos em mês de 30 dias (30/04 × 01/05);
- produção sem data entra em "hoje" e "semana";
- pagamento "agora" no dia de Manaus;
- pagamento às 22:30 fica no dia 20 com os três formatos;
- venda criada já paga e sem data.

## 12. KNOWN_BEHAVIOR temporal corrigido

| # | Antes | Depois |
|---|---|---|
| **K16** | 23:59:59,001–,999 do último dia fora de qualquer mês; o mesmo na borda de `dataFim` | Intervalos semiabertos; o último milissegundo pertence ao mês |
| **K17** | Mês, dia, semana e rótulos no fuso do processo; o frontend gravava a hora local com `Z` | Calendário de Manaus explícito; mesmos resultados em UTC e Manaus; o frontend envia o horário civil sem `Z` e a API responde com `-04:00` |

`KNOWN_BEHAVIOR` expandidos: 42 → **41** (só o K16 saiu). **Não corrigidos (fora do escopo, 0.6):** K1–K15 e K18–K23: edição de venda não atômica, PUT sem sabores, edição de produção apagando consumo, `"!!!"`, resolução ambígua, quantidade × itens, produção sem receita, valor vindo do cliente, conversões de unidade etc. Os testes deles continuam verdes e sem alteração.

## 13. Compatibilidade histórica

**Nenhum dado real foi alterado nem lido.** A venda do ano 0206, a produção do ano 0202, os 727 pagamentos do backfill e os 174 pagamentos manuais continuam exatamente como estão.

Impacto medido com um **histórico sintético** no padrão descrito na 0.2, sem ler o dump. Ele tem:
- 247 produções e 150 custos só com data;
- 901 vendas: 20% sem hora, 77% com hora `.000`, 3% com milissegundos;
- 727 pagamentos de backfill e 174 pagamentos manuais em UTC real;
- 7 bordas em 23:59:59,5.

Comparei a regra antiga com a nova:

| Cenário | Mês muda | Rótulo de dia muda |
|---|---|---|
| **Produção real (processo em UTC): antiga × nova** | **0** em 2.025 registros comuns; **7/7** bordas em 23:59:59,5 passam de "nenhum mês" para o mês certo | **0** |
| "Só trocar o TZ" (regra antiga com processo em Manaus) | 16 produções, 5 custos, 11 vendas, 7 pagamentos | **todas** as 397 produções e custos, 188 vendas e 145 pagamentos |
| Regra nova com processo em Manaus ou em Tóquio | 0 (idêntica a UTC) | 0 |

Conclusão:
- **para o histórico, a política nova é equivalente ao comportamento de produção atual**, exceto pelo K16, que é a correção pretendida;
- a exibição no frontend não muda para nenhum registro (os componentes são os mesmos);
- a saída da API muda de representação (`Z` → `-04:00`), e isso **corrige** o significado para qualquer consumidor que faça `new Date(...)`.

**Resíduo histórico não corrigido (registrado):** os 174 `dataPagamento` manuais anteriores à 0.5 guardam o instante UTC real. Na convenção civil, eles são lidos como 4 h mais tarde. No sintético, 39 de 174 (22%, os marcados entre 20:00 e 23:59 de Manaus) mostram o dia seguinte, **como já mostravam antes** (T7). Nenhum relatório agrega `dataPagamento`. Corrigir esse resíduo seria somar −4 h aos pagamentos com `dataPagamento ≠ data` posteriores a 14/08; é um saneamento explícito, **não executado**, e fica para decisão.

## 14. Validação independente do TZ da máquina

- A suíte passou a aceitar `MALOCA_TZ_TESTE`, que define o fuso do processo de teste e do servidor. O padrão é `UTC`, igual ao container; também é permitido `America/Manaus`, e qualquer outro valor é recusado. O teste de ambiente confere que o fuso realmente aplicado é o configurado.

  ```powershell
  npm test                                              # UTC
  $env:MALOCA_TZ_TESTE='America/Manaus'; npm test       # Manaus
  ```
- **Antes (código da 0.4):** UTC 202/202; Manaus **192/202** (§2.3).
- **Depois:** UTC **232/232** e Manaus **232/232**, com as mesmas expectativas.
- `periodos.test.js` também roda as funções em subprocessos com UTC, Manaus e Tóquio e exige saídas idênticas.

**Validação final (código final, gate oficial):**

| Validação | Resultado |
|---|---|
| `npm test` com `TZ=UTC` ×3 | 232/232 em 13/13, 0 falhas, 0 pendentes (37 s, 26 s, 29 s) |
| `npm test` com `TZ=America/Manaus` ×3 | 232/232 em 13/13, 0 falhas, 0 pendentes (27 s, 23 s, 26 s) |
| Quedas nativas 0xC0000409 nessas 6 execuções | nenhuma |
| `npm run test:guardas` | 33/33 |
| `node --check` | 70/70 arquivos de `src/`, `scripts/`, `prisma/`, `tests/` e `vitest.config.js` |
| `prisma validate` | schema válido |
| `npm run build` (backend) | OK (`prisma generate`, sem conexão) |
| `npm run build` (frontend) | OK |
| Banco dev e restaurado da 0.2 | `CHECKSUM TABLE` idêntico ao retrato da 0.3 |
| Produção | nenhuma conexão: URLs `127.0.0.1:3307`, sem `RAILWAY_*`; o teste manual usou o banco de teste com as guardas da suíte |
| Dump/dados reais | não lidos: a compatibilidade (§13) usou dados sintéticos |

**Teste manual pela interface real.** Usei um Chrome headless com o frontend (Vite) e o backend real, no **banco de teste**, com o servidor em `TZ=UTC` como no Railway. O relógio da **página** foi congelado em 30/09 23:59:30 de Manaus (01/10 03:59:30Z). **17/17 verificações OK:**
- login;
- data padrão da venda **30/09** (e não 01/10, o dia UTC);
- payload `"2026-09-30T23:59:31"` sem `Z`;
- segunda venda às 01/10 00:00:31;
- em Relatórios: o filtro padrão é outubro, com só a venda de 01/10; setembro mostra a venda das 23:59 (captura de tela conferida);
- marcar como paga → "Paga em 30/09/2026";
- produção com data padrão 30/09, envia `"2026-09-30"`, e o resumo de setembro tem 20 produzidas e 10 vendidas;
- custo com data 30/09 filtrado em setembro;
- nenhum corpo de requisição com data terminando em `Z`.

O Chrome do MCP estava ocupado por outra instância, por isso usei um Chrome headless à parte, com perfil temporário. O teste não simula um **aparelho** em outro fuso: não foi possível emular o fuso do navegador. O relógio da página, porém, está explícito em Manaus via `Intl`, com teste de independência no backend.

## 15. Métricas e baseline de testes

| | Antes (0.4) | Depois (0.5) |
|---|---|---|
| Testes / arquivos | 202 / 11 | **232 / 13** |
| `KNOWN_BEHAVIOR` expandidos | 42 | 41 (K16 corrigido) |
| Testes existentes com expectativa alterada | — | 17 (14 de representação, K16, K17, ambiente) |
| Testes removidos | — | **0** |
| Pontos de `src/services` que usavam relógio/calendário do processo | 41 | **0** |
| Suíte com processo em Manaus | 192/202 | 232/232 |
| Dependências novas | — | **0** |

**Baseline do gate** (`tests/caracterizacao/baseline.json`):
- **anterior:** 202 testes / 11 arquivos (Etapa 0.3);
- **nova:** 232 / 13;
- **motivo:** +16 (`periodos.test.js`) e +14 (`temporal.test.js`), sem nenhum teste removido;
- o histórico fica registrado no próprio arquivo;
- o mecanismo da 0.4 para a queda nativa do Windows continua valendo, e o gate segue exigindo a execução integral.

## 16. Arquivos alterados

**Backend:** `src/lib/periodos.js`, `src/server.js`, `src/services/{vendas,producao,custos,clientes}Service.js`.

**Testes:**
- novos: `periodos.test.js`, `temporal.test.js`;
- alterados: `vendas`, `producao`, `custos`, `clientes`, `vendasAuto`, `auth`, `totais` (comentário), `baseline.json`, `setup/ambiente.js` e `setup/globalSetup.js` (`MALOCA_TZ_TESTE`), `vitest.config.js`.

**Frontend:** `src/utils/tempo.js` (novo), `RegistrarVenda.jsx`, `VendaDireta.jsx`, `Relatorios.jsx`, `Custos.jsx`, `Producao.jsx`, `Dashboard.jsx`.

**Docs:** este arquivo.

**Não alterados:** `prisma/schema.prisma`, rotas, middlewares, controllers, `package.json`/`package-lock.json`, `n8n/`, `sw.js`, os dados.

## 17. Riscos restantes

| Risco | Situação |
|---|---|
| Aba aberta antes do deploy envia o formato antigo (`…Z`) | O backend lê como UTC real e grava 4 h antes. Publicar backend e frontend juntos e recarregar; opcionalmente, versionar o `sw.js` (§8) |
| Clientes externos que dependiam do `Z` nas respostas | Não há nenhum ativo (o n8n não funciona, 0.2). O formato `-04:00` é ISO válido e dá o instante correto |
| 174 `dataPagamento` manuais antigos em UTC real | Registrado em §13; saneamento só com decisão explícita e fora desta etapa |
| Volta do horário de verão no Amazonas | O `Intl` acompanha a base de fusos do Node; a hora repetida na volta seria ambígua no relógio civil. Hoje é irrelevante |
| Agentes chamando services com `Date` | A política trata `Date` como instante real (P6); tools devem usar `lerDataCivil`/`serializarCivil` (preparação da 1.3) |
| Semana começa no domingo | Comportamento anterior preservado; mudar para segunda seria decisão de negócio |
| Fuso do aparelho no teste manual | Não emulado (§14); coberto pelo uso explícito do `Intl` no frontend |

## 18. Preparação para a 0.6

- As datas ficaram coerentes e centralizadas. A 0.6 pode corrigir os `KNOWN_BEHAVIOR` restantes (K1–K5, K7–K9 etc.) com o mesmo processo usado aqui (teste falha → implementação → teste passa).
- As tools dos agentes (1.3) devem receber e devolver datas no contrato P6/P7: `lerDataCivil` na entrada e `serializarCivil` na saída. Períodos como "vendas desta semana" e "produção de hoje" já existem como funções puras testadas (`intervaloDaSemana`, `intervaloDoDia`, `mesAtualCivil`).
- O saneamento opcional dos 174 pagamentos manuais pode ser planejado como uma operação separada e auditável.
