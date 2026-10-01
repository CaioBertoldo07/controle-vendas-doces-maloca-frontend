# Etapa 0.6 — Correção deliberada de invariantes críticas

**Data:** 01/10/2026
**Base:** `docs/tcc/etapa-0-3-testes-caracterizacao.md` (§15.2, K1–K23), `docs/tcc/etapa-0-4-extracao-servicos.md`, `docs/tcc/etapa-0-5-politica-temporal.md`
**Branch de trabalho:** `fix/etapa-0-6-invariantes-criticas`, a partir de `7fef006` (commit da 0.5). Revisada e **aprovada com ressalvas** em 01/10/2026 (dívidas K22, K14 e item 0/negativo registradas, sem bloquear a Etapa 1). Sem deploy.

---

## 1. Objetivo

Corrigir **de propósito**, e só eles, os comportamentos conhecidos que ameaçam a integridade dos dados ou a futura camada de agentes:
- edição de venda não atômica;
- edição que apaga itens ou consumo de insumo;
- resolução de nomes que escolhe uma entidade sem base;
- quantidade de venda que diverge dos itens.

Cada correção seguiu o mesmo processo:

```text
comportamento ruim atual → regra correta → teste alterado primeiro
→ falha comprovada contra o código antigo → implementação → verde
```

## 2. Baseline inicial

| | Valor |
|---|---|
| Commit de partida | `7fef006 fix: establish consistent Manaus time policy` |
| Gate | **232 testes, 13 arquivos**, 0 falhas, 0 pendentes (`npm test` antes do commit da 0.5) |
| `KNOWN_BEHAVIOR` expandidos | 41 |

## 3. Bugs selecionados

| Prioridade | ID (0.3) | Comportamento antigo | Teste antigo |
|---|---|---|---|
| 1 | **K3** | Edição de venda não atômica: os itens eram apagados **fora de transação**, e um update que falhava depois (cliente inexistente → FK) deixava a venda sem itens | `vendas.test.js` "edição não atômica…" |
| 2 | **K2** | `PUT /vendas/:id` sem `sabores` **apagava** todos os itens | `vendas.test.js` "PUT sem 'sabores' APAGA…" |
| 3 | **K1** | Editar só a observação (ou só a data) de uma produção **apagava as saídas** de insumo e não as recriava | `producao.test.js` "editar só a observação APAGA…" |
| 4 | **K5** | Texto que normaliza para vazio (`""`, `"!!!"`) resolvia o **primeiro cliente**; `/vendas/auto` gravava a venda para ele | `resolverNomes.test.js`, `vendasAuto.test.js` |
| 5 | **K4** | Resolução ambígua escolhia em silêncio o **primeiro** candidato (clientes e sabores) | `resolverNomes.test.js` (2 testes) |
| 6 | **K8** | `Venda.quantidade` era o valor enviado pelo chamador, independente da soma dos itens | `vendas.test.js` "a quantidade total NÃO é recalculada…" |

**Não corrigidos de propósito (§13):**
- produção sem receita (K12);
- venda sem estoque (K9);
- MRP e lista de compras;
- conversões de unidade (K10);
- valor da venda (K7);
- os 174 pagamentos históricos;
- JWT + API Key no `/vendas/auto` (K6);
- n8n.

## 4. Edição atômica de venda

**Regra:** a edição aplica todas as alterações ou nenhuma.

```text
venda existe?                         → 404
sabores presente: array não vazio?    → 400 "Informe ao menos um sabor"
sabores presente: Σ itens > 0?        → 400 "Quantidade deve ser maior que zero"
clienteId: cliente existe?            → 404 "Cliente não encontrado"   ← antes era 500 depois de apagar os itens
──────────────── só então escreve ────────────────
$transaction:
  (se sabores) apaga itens
  update da venda (+ itens novos, quantidade = Σ)
  qualquer erro → rollback (venda e itens originais)
```

- Tudo o que é validável sem escrever é validado **antes** da transação.
- Um sabor inexistente continua sendo detectado pela chave estrangeira **dentro** da transação. É o caso de "falha no meio da operação": a transação desfaz a exclusão dos itens. O status continua 500 (K14, mantido).
- O teste lê `Venda` e `VendaSabor` direto via Prisma antes e depois e exige **igualdade exata**. Isso vale para cliente inexistente, sabor inexistente, `sabores: []` e soma zero.

## 5. Semântica de edição parcial

| `sabores` no corpo | Efeito |
|---|---|
| **ausente** | itens **preservados**; a quantidade não muda |
| `[]` (ou não-array, como `null`) | **400** `"Informe ao menos um sabor"`, sem alterar nada |
| array válido | itens substituídos na transação; `quantidade = Σ itens` |

Os demais campos (`valor`, `desconto`, `data`, `clienteId`, `pago`) mudam só quando enviados. Os testes cobrem:
- só desconto;
- só valor;
- só data;
- só cliente;
- só sabores;
- array vazio;
- sabores omitidos.

**Nenhum fluxo legítimo usa `sabores: []`.** O modal de edição (Relatórios) sempre envia `sabores`. Quando o usuário remove todos, a quantidade enviada é 0 e o middleware `validateVenda` já respondia 400 antes desta etapa.

**Interação com o K22 (mantido):** o middleware `validateVenda` continua exigindo `clienteId` e `quantidade` no `PUT`. Por isso, "alterar só o desconto" significa enviar `clienteId` e `quantidade`, que é exigida e **ignorada**, mais o desconto. Relaxar essa exigência é uma mudança de contrato à parte (§18).

## 6. Produção parcial e atômica

| `sabores` no corpo | Efeito |
|---|---|
| **ausente** | itens e saídas de insumo **preservados**; muda só o que foi enviado. Uma **data** nova também é aplicada às saídas existentes, com as mesmas quantidades |
| array válido | validado **como na criação** (não vazio; `saborId` e quantidade > 0), depois necessidades recalculadas, saldo verificado depois de reverter as saídas desta produção, itens e saídas substituídos, tudo em **uma transação** |
| `[]` ou item inválido | **400**, com as mesmas mensagens da criação; nada muda |

Validação de atomicidade, lendo direto do banco a produção, os itens e **todas** as movimentações:
- insumo insuficiente → 422 e estado idêntico;
- falha **no meio da transação** → 500 e estado idêntico. O caso usado é uma observação com mais de 255 caracteres: o MySQL rejeita o update **depois** que itens e saídas já foram apagados dentro da transação;
- `[]` e item com quantidade 0 → 400 e estado idêntico.

**Não alterado:** a produção sem receita continua aceita e sem consumo (K12). As produções reais ainda não têm receitas.

## 7. Resolução de nomes

Em `src/services/resolverNomes.js`, a normalização é a mesma (minúsculas, sem acentos, só `[a-z0-9]`), mas o resultado passou a ser **classificado**:

| Tipo | Quando | Devolve |
|---|---|---|
| `EXATO` | um único registro com o nome normalizado igual | `{ tipo, cliente }` |
| `PARCIAL_UNICO` | nenhum exato e um único que contém ou está contido | `{ tipo, cliente }` |
| `AMBIGUO` | dois ou mais exatos, **ou** nenhum exato e dois ou mais parciais | `{ tipo, candidatos: [{ id, nome }] }` |
| `NAO_ENCONTRADO` | nenhum candidato | `{ tipo }` |
| `INVALIDO` | texto ausente, não-string ou que normaliza para vazio (`""`, `"   "`, `"!!!"`, `"..."`, `"—"`) | `{ tipo }` |

Detalhes:
- **Exato tem prioridade sobre parcial**, inclusive nos sabores, onde antes exato e parcial eram avaliados juntos.
- **Não existe fallback** para "primeiro registro". Os candidatos vêm na ordem do id e só com `id` e `nome`.
- `resolverSabores` devolve `{ sabores, naoEncontrados, ambiguos: [{ nome, candidatos }], invalidos }`.
- Só sabores **ativos** entram, como antes. Um inativo não é resolvido nem aparece como candidato.
- A função pura `classificar(texto, registros)` é exportada para reuso pelas futuras tools.
- Correção lateral: um registro cujo próprio nome normaliza para vazio não casa mais com qualquer texto. Antes, `alvo.includes("")` era sempre verdadeiro.
- **Mantido (KNOWN_BEHAVIOR):** o mesmo sabor pode ser resolvido em dois itens.

## 8. Desambiguação

Os testes de nível A (`resolverNomes.test.js`, de 12 para 22) cobrem:

| | Cliente | Sabor |
|---|---|---|
| Exato | ✅ | ✅ |
| Maiúsculas e minúsculas | ✅ | ✅ |
| Acento | ✅ | ✅ |
| Parcial único (texto contido e nome contido) | ✅ (2) | ✅ |
| Parcial múltiplo → AMBIGUO | ✅ | ✅ |
| Exatos duplicados (só acento difere, K20) → AMBIGUO | ✅ | — |
| Vazio, espaços, pontuação, travessão, `null`, `undefined`, número → INVALIDO | ✅ (8) | ✅ (`"!!!"`, `""`, ausente) |
| Inexistente | ✅ | ✅ |
| Base vazia | ✅ | — |
| Inativo | — | ✅ (nem como candidato) |
| Exato vence parcial | ✅ | ✅ |

## 9. `/vendas/auto`

A ordem de decisão é esta. **Nenhuma escrita** acontece antes de tudo estar resolvido, porque a venda é um único nested write no final:

| Situação | Status | Corpo |
|---|---|---|
| validações atuais (`clienteNome` em branco, sem sabores, valor) | 400 | inalterado |
| `idempotencyKey` já usada | 200 | inalterado (`duplicata: true`) |
| cliente **INVALIDO** (ex.: `"!!!"`) | **400** | `{ error: 'clienteNome inválido: "!!!" não contém letras nem números', tipo: "INVALIDO" }` |
| cliente **AMBIGUO** | **422** | `{ error: 'Cliente ambíguo: "frutaria"', tipo: "AMBIGUO", candidatos: [{ id, nome }] }` |
| cliente não encontrado | 404 | inalterado |
| algum sabor **INVALIDO** (nome vazio, pontuação ou ausente) | **400** | `{ error: "Sabores inválidos", tipo: "INVALIDO", invalidos: [...] }` |
| algum sabor não encontrado | 404 | inalterado |
| algum sabor **AMBIGUO** | **422** | `{ error: "Sabores ambíguos", tipo: "AMBIGUO", ambiguos: [{ nome, candidatos }], encontrados }` |
| tudo resolvido | 201 | inalterado |

**Por que esses códigos:**
- **422** é para uma entrada sintaticamente válida que exige uma decisão (desambiguação). O 422 já é usado pela API para "estoque insuficiente".
- **400** é para uma entrada que não tem conteúdo resolvível; é a mesma família das demais validações.
- Os corpos 404 existentes não mudaram.
- O campo `tipo` só aparece nos corpos novos e serve como código de máquina para o futuro Agente de Atendimento.

**Idempotência:** uma tentativa rejeitada (422/400) **não consome** a `idempotencyKey`. A tentativa corrigida com a mesma chave registra uma vez, e a repetição devolve 200 com `duplicata`. Há teste para isso.

## 10. Quantidade da venda

**Regra:** `Venda.quantidade = Σ VendaSabor.quantidade`. O backend não confia mais na quantidade enviada.

| Fluxo | Antes | Depois |
|---|---|---|
| `POST /vendas` | gravava `parseInt(quantidade)` do corpo (99 com itens somando 15 → 99) | grava a soma dos itens (→ 15) |
| `POST /vendas/auto` | já era a soma dos itens resolvidos | inalterado; uma `quantidade` enviada é ignorada (teste) |
| `PUT /vendas/:id` com `sabores` | gravava a quantidade do corpo | grava a soma dos itens novos |
| `PUT /vendas/:id` sem `sabores` | gravava a quantidade do corpo (e apagava os itens) | **não muda** a quantidade (os itens não mudaram) |

Contrato atual caracterizado, **sem regras novas para os itens**:
- **Decimais:** cada item continua passando por `parseInt` (2,7 → 2), e a soma usa o valor efetivamente gravado (2 + 3 = 5).
- **Total:** a regra "quantidade > 0", que o middleware aplica ao corpo, passou a valer **também para a soma gravada**. Se a soma for ≤ 0 (ou inválida), a resposta é 400 `"Quantidade deve ser maior que zero"`, e nada é gravado.
- **Item 0 ou negativo:** continua aceito se a soma for positiva (5 − 2 → 3). Estava caracterizado só implicitamente e agora está registrado como **KNOWN_BEHAVIOR novo** (§13).
- A `quantidade` do corpo continua **obrigatória** no `POST` e no `PUT` por causa do middleware `validateVenda`. A compatibilidade é total: o frontend sempre a envia, e ela já é a soma dos itens.

## 11. Alterações de contrato

| Endpoint/função | Antes | Depois |
|---|---|---|
| `PUT /api/vendas/:id` sem `sabores` | apagava os itens | preserva os itens e a quantidade |
| `PUT /api/vendas/:id` com `sabores: []` ou `null` | 200, venda sem itens | **400** `"Informe ao menos um sabor"` |
| `PUT /api/vendas/:id` com cliente inexistente | 500 (e venda sem itens) | **404** `"Cliente não encontrado"`, nada muda |
| `PUT /api/vendas/:id` com sabor inexistente | 500 (e venda sem itens) | 500, **rollback total** |
| `POST/PUT /api/vendas` e `quantidade` | gravada como veio | soma dos itens; soma ≤ 0 → 400 |
| `PUT /api/producao/:id` sem `sabores` | apagava as saídas | preserva itens e saídas; data nova aplicada às saídas |
| `PUT /api/producao/:id` com `sabores: []` ou item inválido | 200, produção sem itens ou com consumo errado | **400**, as mesmas mensagens da criação |
| `POST /api/vendas/auto` com cliente `"!!!"` | 201 para o primeiro cliente | **400** INVALIDO |
| `POST /api/vendas/auto` com cliente ou sabor ambíguo | 201 com o primeiro candidato | **422** com candidatos |
| `POST /api/vendas/auto` com sabor sem `nome` | 500 (`TypeError`) | **400** INVALIDO |
| `resolverCliente(texto)` (interno) | entidade ou `null` | `{ tipo, cliente? , candidatos? }` |
| `resolverSabores(itens)` (interno) | `{ sabores, naoEncontrados }` | `+ ambiguos, invalidos`; exato tem prioridade |

**Frontend:** nenhuma alteração foi necessária.
- A edição de venda já envia `sabores` e a quantidade somada. A edição pela tela foi testada (§16).
- A produção já bloqueia o envio sem itens.
- O `/vendas/auto` não tem tela: o contrato fica pronto para o futuro Agente de Atendimento.

## 12. KNOWN_BEHAVIOR corrigidos nesta etapa

| ID | Comportamento antigo | Comportamento novo | Testes que mudaram |
|---|---|---|---|
| **K1** | Editar só a observação da produção apagava as saídas | Itens e saídas preservados | `producao.test.js` (1) |
| **K2** | `PUT` de venda sem `sabores` apagava os itens | Itens preservados | `vendas.test.js` (1) |
| **K3** | Edição de venda não atômica | Validação antes, escrita em transação, rollback total | `vendas.test.js` (1) |
| **K4** | Ambiguidade escolhia o primeiro | `AMBIGUO` com candidatos; `/auto` → 422 | `resolverNomes.test.js` (2) |
| **K5** | Vazio ou pontuação resolvia o primeiro cliente | `INVALIDO`; `/auto` → 400 | `resolverNomes.test.js` (1, agora 8 casos) e `vendasAuto.test.js` (1) |
| **K8** | Quantidade não derivada dos itens | `quantidade = Σ itens` | `vendas.test.js` (1) |

São **8 testes `KNOWN_BEHAVIOR` convertidos** em testes do comportamento correto, com o marcador removido e o comentário "Etapa 0.6: era KNOWN_BEHAVIOR Kx".

## 13. KNOWN_BEHAVIOR mantidos

**Total: 34**, ou seja, 41 − 8 corrigidos + 1 recém-caracterizado.

| ID | Comportamento | Por que fica |
|---|---|---|
| K6 | `/vendas/auto` exige JWT além da API Key | Fora do escopo: os agentes serão in-process, e a autenticação máquina-a-máquina é decisão posterior |
| K7 | `valor` vem do chamador | A Venda Direta usa preços praticados que não existem por item; precisa de modelagem própria |
| K9 | Venda não valida estoque; aceita sabor inativo | O estoque acabado real ainda não foi reconciliado por contagem física (0.2, Opção C) |
| K10 | Conversões de unidade limitadas | Fora do escopo desta etapa |
| K11 | Custo com insumo gera ENTRADA em qualquer categoria | Baixa gravidade; fora do escopo |
| K12 | Produção sem receita não consome insumo | As produções reais não têm receitas; bloquear pararia a operação |
| K13 | Saldo negativo aparece como "disponível 0.0" | Cosmético |
| K14 | Sabor inexistente → 500 na venda e na produção | Fora da seleção. Agora é **atômico** na edição de venda |
| K15 | "Saldo baixo" < 200 em qualquer unidade; tipo de movimentação desconhecido ignorado | Depende do estoque mínimo por insumo (Etapa 1.1) |
| K18 | Estoque sem data de corte; inclui inativos e datas futuras | Depende da reconciliação física |
| K19 / K20 | Agrupamento por nome; duplicidade sem normalizar acentos | Baixa gravidade. O K20 agora resulta em **AMBIGUO** na resolução, e não em escolha arbitrária |
| K21 | Edição de custo ignora valores "falsy" | Fora do escopo |
| K22 | `PUT /vendas/:id` exige `clienteId` e `quantidade` | Não foi selecionado. A `quantidade` virou um campo exigido e ignorado (§5); relaxar é decisão separada |
| K23 | Login sem e-mail → 500; esquema do `Authorization` não verificado | Fora do escopo |
| — | O mesmo sabor pode aparecer em dois itens (resolução) | Baixa gravidade; o total continua correto |
| **novo** | Item com quantidade 0 ou negativa é aceito se a soma for positiva | Caracterizado nesta etapa. Uma regra por item seria regra nova, o que não foi pedido |

## 14. Testes novos e alterados

**Processo vermelho → verde:** a suíte nova, rodada contra o código da 0.5, teve **24 falhas**, e `resolverNomes.test.js` falhou inteiro na carga, porque o contrato ainda não existia. Depois da implementação: **265/265**. Todas as falhas do vermelho eram esperadas:

| Arquivo | Antes → depois | Mudanças |
|---|---|---|
| `vendas.test.js` | 37 → **49** | K8, K2 e K3 invertidos; +8 de edição parcial/atômica (só desconto, só valor, só data, cliente, sabores, `[]`, falha no meio, soma zero); +4 de quantidade (999 → 5, decimal, soma zero, KNOWN novo) |
| `resolverNomes.test.js` | 12 → **22** | Os 12 originais reescritos para o contrato classificado, sem nenhum removido (K4 ×2 e K5 invertidos; o K5 virou 8 casos); +exatos duplicados; +exato vence parcial em sabores; +sabor inválido |
| `vendasAuto.test.js` | 15 → **21** | K5 (`"!!!"`) invertido; +parcial único, cliente ambíguo, sabor ambíguo, sabor inválido, idempotência após 422, quantidade ignorada |
| `producao.test.js` | 30 → **35** | K1 invertido; +só data, 422 com retrato completo, falha no meio da transação, `[]`, item inválido |

**Testes de atomicidade** (leitura direta via Prisma: estado depois da falha **idêntico** ao inicial):
- **venda:** cliente inexistente, sabor inexistente (falha no meio), `[]`, soma zero;
- **produção:** insumo insuficiente, falha no meio da transação, `[]`, item inválido.

## 15. Baseline final

| | Antes | Depois |
|---|---|---|
| Testes / arquivos | 232 / 13 | **265 / 13** |
| `KNOWN_BEHAVIOR` expandidos | 41 | **34** (−8 corrigidos, +1 caracterizado) |
| Testes removidos | — | **0** |

O `baseline.json` foi atualizado de forma consciente, com motivo e histórico (202 → 232 → 265).

## 16. Validação

| Validação | Resultado |
|---|---|
| `npm test` com `TZ=UTC` ×3 | 265/265 em 13/13, 0 falhas, 0 pendentes nas 3 (35 s, 45 s, 28 s); na 2ª, uma queda nativa 0xC0000409 foi refeita pelo mecanismo aprovado na 0.4, e a execução integral seguinte passou |
| `npm test` com `TZ=America/Manaus` ×3 | 265/265 em 13/13, 0 falhas, 0 pendentes nas 3 (32 s, 31 s, 28 s), sem queda |
| Política temporal da 0.5 (`periodos`, `temporal`) | verde nos dois fusos (dentro das execuções acima) |
| `npm run test:guardas` | 33/33 |
| `node --check` | 70/70 |
| `prisma validate` | schema válido; **nenhuma alteração de schema** |
| Build backend | OK (`prisma generate`, sem conexão com banco) |
| Build frontend | não aplicável (frontend não alterado) |
| Banco dev e restaurado da 0.2 | `CHECKSUM TABLE` idêntico ao retrato da 0.3 |
| Produção | nenhuma conexão (URLs `127.0.0.1:3307`, sem `RAILWAY_*`); sem deploy |
| Dados reais / dump | não lidos nem alterados |

**Teste manual local:** servidor real, banco **de teste** recriado do zero, dados fictícios. **18/18 verificações pela API**:
- **Venda:**
  - criar (quantidade 999 → 10);
  - editar só desconto (itens e quantidade preservados);
  - editar só data;
  - trocar itens (4 + 6);
  - três erros provocados — sabor inexistente (500), cliente inexistente (404) e `[]` (400) — com venda e itens **idênticos** depois de cada um.
- **Produção:**
  - criar (saída de 500 g);
  - editar só observação (consumo preservado);
  - trocar itens (800 g);
  - falta de insumo (422) e falha no meio (500), ambas com **rollback total**.
- **Venda automática:**
  - nome exato e parcial único (201);
  - cliente ambíguo (422 com os 2 candidatos) e sabor ambíguo (422), sem gravar nada;
  - `"!!!"` (400);
  - idempotência (201 e depois 200 duplicata, uma venda só).

**Mais 2/2 pela interface real**, com Chrome headless e o modal de edição de Relatórios:
- o modal envia `sabores` e a quantidade somada;
- a venda editada ficou com desconto 3, os mesmos itens e a mesma quantidade.

## 17. Compatibilidade

- **Dados:** nenhum registro existente é alterado. As regras novas valem para escritas novas.
- **Histórico:** a 0.2 encontrou 0 vendas com divergência entre total e itens, e 0 vendas sem itens. A derivação da quantidade é coerente com o histórico. Uma venda antiga editada **sem** `sabores` mantém a quantidade gravada.
- **Frontend atual:** compatível sem mudanças. Ele sempre envia `sabores` e a quantidade igual à soma, e nunca envia `[]` (§5).
- **`/vendas/auto`:** não há consumidor ativo (o n8n não funciona). Os corpos 404 e 201 continuam iguais. Os códigos 400 e 422 novos são aditivos.
- **Política temporal da 0.5:** inalterada e verde nos dois fusos.

## 18. Riscos restantes

| Risco | Situação |
|---|---|
| K22: `PUT` ainda exige `quantidade`, agora ignorada | Contrato confuso para clientes externos e agentes. Recomenda-se torná-la opcional numa mudança dedicada |
| Item 0 ou negativo aceito se a soma for positiva | KNOWN novo; uma regra por item pode vir com a modelagem de preço por item |
| Sabor inexistente → 500 (K14) | Atômico agora, mas o status ainda não é 4xx |
| Corrida entre a validação do cliente e a escrita | Um cliente apagado entre as duas cai na chave estrangeira **dentro** da transação: 500 com rollback, sem estado parcial |
| Corrida na idempotência do `/vendas/auto` | Inalterada: a unicidade de `idempotencyKey` no banco impede duplicata, e a segunda requisição concorrente recebe 500 |
| Resolução por "contém" | Nomes muito curtos ("a") tendem a ficar AMBIGUO. Esse é o resultado seguro; uma pontuação (score) pode vir com o Agente de Atendimento |

## 19. Arquivos alterados

**Backend:**
- `src/services/resolverNomes.js` (reescrito: classificação);
- `src/services/vendasService.js` (edição atômica e parcial, quantidade derivada, desambiguação no `/auto`);
- `src/services/producaoService.js` (edição parcial e atômica, validação compartilhada).

**Testes:**
- `vendas.test.js`, `resolverNomes.test.js`, `vendasAuto.test.js`, `producao.test.js`;
- `baseline.json`.

**Docs:** este arquivo.

**Não alterados:** `prisma/schema.prisma`, controllers, rotas, middlewares, `server.js`, `lib/`, frontend, `n8n/`, `package*.json`, dados.

## 20. Preparação para a camada SMA

- **Invariantes que o executor de ações aprovadas** (`AcaoProposta`, auditoria §12.4) pode assumir:
  - uma edição de venda ou produção nunca deixa estado parcial;
  - campos omitidos não são destruídos;
  - a quantidade da venda é a soma dos itens.
- **Resolução de entidades para o LLM:**
  - `classificar`, `resolverCliente` e `resolverSabores` devolvem `EXATO | PARCIAL_UNICO | AMBIGUO | NAO_ENCONTRADO | INVALIDO`, com candidatos mínimos `{ id, nome }`;
  - o Agente de Atendimento pode transformar `AMBIGUO` numa pergunta ao gestor ("você quis dizer Frutaria Norte ou Frutaria Sul?") **sem nenhuma escrita**, que é o fluxo da §12.4 item 4 da auditoria.
- **Erros de domínio** (`ErroDominio`) carregam o `status` e um `corpo` com `tipo` (`INVALIDO`/`AMBIGUO`) que a tool pode repassar ao agente sem interpretar HTTP.
- **Próximos candidatos a correção deliberada,** com o mesmo processo:
  - K22 (quantidade opcional no `PUT`);
  - K14 (sabor inexistente → 4xx);
  - regra de quantidade por item, junto com a modelagem de preço praticado por item (K7).
