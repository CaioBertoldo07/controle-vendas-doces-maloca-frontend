# Etapa 0.3 — Testes de caracterização

**Data:** 29/09/2026
**Base:** `docs/tcc/auditoria-tecnica-inicial.md`, `docs/tcc/etapa-0-ambientes-e-baseline.md`, `docs/tcc/etapa-0-2-analise-dos-dados.md`
**Branch de trabalho:** `test/etapa-0-3-caracterizacao` (sem commit, aguardando revisão)

---

## 1. Objetivo

Congelar o comportamento **observável** do backend atual antes da Etapa 0.4 (extração da regra de negócio dos controllers para services/tools). A pergunta que a suíte responde:

> "Depois da refatoração, o comportamento observável continua o mesmo?"

A suíte **não** melhora o sistema. Nenhum controller, rota, middleware, service, schema ou frontend foi alterado. Comportamentos ruins já conhecidos estão **registrados** (marcados `KNOWN_BEHAVIOR`), não corrigidos.

## 2. Estratégia de testes

| Nível | O que faz | Onde |
|---|---|---|
| **A. Função real, sem HTTP** | Chama diretamente funções já exportadas | `resolverNomes.test.js` (`resolverCliente`, `resolverSabores`). É o único módulo de regra exportado hoje. Conforme pedido, **nenhuma função foi extraída** dos controllers para facilitar testes. |
| **B. Integração controller/API** | Supertest contra o **`src/server.js` real**, que o setup global sobe como processo filho numa porta livre, apontando para o banco de teste | Todos os demais arquivos |
| **C. Efeitos no banco** | Asserções via Prisma: registros criados, atualizados, removidos; movimentações; rollbacks e não atomicidade observáveis | Em todos os arquivos de nível B |

**Por que subir o servidor real em vez de importar o `app`:** o `server.js` não exporta o `app` e chama `listen()` ao ser importado. Alterá-lo seria mexer em código funcional. Rodando o arquivo como está, a suíte exercita exatamente o que vai para produção: ordem dos middlewares, montagem das rotas, `express.json()` e o tratador de erros.

## 3. Framework escolhido

| Item | Escolha | Motivo |
|---|---|---|
| Runner | **Vitest 5.0.2** | ESM nativo, sem as flags experimentais de VM que o Jest exige para ESM; configuração mínima |
| HTTP | **Supertest 7.3** | Padrão para Express, funciona contra uma URL |
| Dependências novas | só `vitest` e `supertest` (devDependencies) | Nada em `dependencies`; `npm audit fix` **não** executado |

Scripts (`backend/package.json`):

```bash
npm test              # suíte completa + GATE da baseline (§18.2); sempre no banco de teste protegido
npm run test:watch    # vitest em modo watch (desenvolvimento; sem gate)
npx vitest run <arq>  # um arquivo isolado (sem gate)
npm run test:guardas  # node --test das ferramentas das Etapas 0.1/0.2 e do próprio gate
```

Não foi criado `test:integration`: com o único módulo de nível A dependendo do banco, a separação não traria ganho. Toda a suíte é integração com o banco de teste.

## 4. Segurança do banco de teste

Antes de qualquer acesso, `tests/caracterizacao/setup/ambiente.js` exige (no processo principal **e** em cada processo de teste):

| Verificação | Regra |
|---|---|
| Máquina de desenvolvimento declarada | `APP_ENV=development` no `backend/.env` |
| Banco | `DATABASE_URL_TEST` local, terminado em `_test`, **diferente** de `DATABASE_URL` |
| Produção | Recusa `APP_ENV`/`NODE_ENV=production`, qualquer `RAILWAY_*` e hosts `*.rlwy.net`, `*.railway.app` ou `*.railway.internal` (guardas da Etapa 0.1) |

Depois disso:
- o schema do `doces_maloca_test` é recriado pelo wrapper protegido `scripts/ambiente/prisma.js teste db push --force-reset`;
- o servidor sobe com `DATABASE_URL` = banco de teste, `TZ=UTC` e `JWT_SECRET`/`N8N_API_KEY` **fictícios**;
- o `PrismaClient` da suíte recebe a URL de teste explicitamente (`datasourceUrl`) e se recusa a iniciar se ela não terminar em `_test`.

**Nenhum `.env` precisa ser editado** para alternar ambientes.

Tentativas bloqueadas (verificadas):

| Cenário | Resultado |
|---|---|
| `DATABASE_URL_TEST` apontando para `doces_maloca_dev` | ⛔ bloqueada (sem `_test` e mesmo banco) |
| `RAILWAY_ENVIRONMENT_NAME` presente | ⛔ bloqueada |
| `APP_ENV=production` | ⛔ bloqueada |
| Host `*.proxy.rlwy.net` (fictício) | ⛔ bloqueada |

## 5. Fixtures

`tests/caracterizacao/helpers/`:

| Arquivo | Conteúdo |
|---|---|
| `db.js` | `prisma` (só banco de teste), `limparBanco()` (esvazia as 11 tabelas na ordem das chaves estrangeiras), `n()` (Decimal → Number) |
| `http.js` | `api(token?, apiKey?)` e `cru()` sobre Supertest |
| `fixtures.js` | `criarUsuario`, `tokenPara`, `autenticar`, `criarCliente`, `criarSabor`, `criarMateriaPrima`, `definirReceita`, `movimentar`, `criarVenda`, `criarProducao`, `movimentacoesDe`, `cenarioReceitaBasica` |

- **Isolamento:** `beforeEach` global limpa o banco; cada teste cria o próprio estado. Nenhum teste depende de outro nem da ordem.
- **Dados 100% fictícios** ("Mercearia Fictícia Aurora", "Coco Fictício", `gestora@exemplo.test`); bcrypt de custo 4 só para a senha fictícia. O `prisma/seed.js` **não** é usado (é destrutivo, desatualizado e contém nomes reais).
- **Dados reais:** proibidos e verificados. Nenhuma referência a `.coleta-tcc`, dumps, bancos `restore_*` ou hosts de produção em `tests/`.

## 6. Produção/MRP (`producao.test.js`, 30 testes)

| Área | Casos |
|---|---|
| Cálculo de necessidades | 50/100 → 500 g + 250 g; igual ao rendimento; acima (250 → 2500/1250); dois sabores compartilhando insumo → **uma** SAÍDA somada; decimais arredondados a 3 casas (1000×10/22 = 454,545; 395×10/22 = 179,545); mistura com e sem receita |
| Saldo na validação | Saldo exatamente igual à necessidade é aceito (`saldo < necessidade`); AJUSTE entra no saldo (em `materiaPrima.test.js`) |
| Criação | 201 com `Producao`, `ProducaoSabor` e `SAIDA/PRODUCAO` (`producaoId`, `observacao "Produção #id"`, data da produção); `trim` da observação; sem data usa agora |
| Insuficiência | **422** `{error, faltantes}` com o texto exato por insumo; vários insumos; **nada gravado** |
| Validação | sem sabores; quantidade 0, negativa, sem `saborId` → 400 |
| Edição | Remove as saídas antigas e grava as novas (sem duplicar); checa o saldo **depois** de reverter as saídas desta produção; sem saldo → 422 com **rollback completo** (itens e saídas antigos preservados); nova data propagada para as saídas; 404 |
| Exclusão | Remove produção, itens (cascade) e saídas; o saldo volta; não afeta outras produções nem entradas; 404 |
| Listagem | Filtro por mês/ano e ordem decrescente |

## 7. Custos/matéria-prima (`custos.test.js` 34, `materiaPrima.test.js` 17)

| Área | Casos |
|---|---|
| Custo sem insumo | Cria custo, **nenhuma** movimentação; categoria padrão "Matéria Prima" |
| Custo com insumo | Cria `ENTRADA/CUSTO` com `custoId`, observação `Compra: <nome>` e data do custo |
| Conversões corretas | kg→g ×1000; L→ml ×1000; g→g, ml→ml, un→un sem fator |
| Conversões ausentes (`KNOWN_BEHAVIOR`) | `cx`, `pct`, `saco`, `un` sobre base `g`; kg sobre base `ml`; `l` minúsculo; `KG` maiúsculo: **a quantidade entra crua** |
| Edição | Nova quantidade, unidade e data recalculam a entrada (uma só); sem `materiaPrimaId` mantém o vínculo; `null` desvincula e remove; vincular na edição cria; insumo inexistente → 400 sem alteração; 404 |
| Exclusão | Remove custo e sua movimentação, sem tocar em outras |
| Consultas | Listagem com filtros mês/ano/categoria; resumo (`totalGeral` string, por categoria, 12 meses) |
| Saldo de MP | ENTRADA +, SAÍDA −, AJUSTE com o próprio sinal; saldo zero; negativo sinalizado; "saldo baixo" = 0 < saldo < 200; tipo desconhecido ignorado; só ativas, em ordem alfabética |
| CRUD de MP | Validações; duplicado ativo → 400; recriar nome inativo **reativa o mesmo registro**; DELETE é desativação e mantém as movimentações |

## 8. Vendas (`vendas.test.js`, 37 testes)

| Área | Casos |
|---|---|
| Criação | 201, `pago=false`, `dataPagamento=null`, itens `VendaSabor`, desconto padrão 0, data padrão agora, `pago=true` grava data |
| Validações | Sem cliente/quantidade, quantidade não numérica ou negativa (middleware); sem valor ou sabores ("Dados incompletos"); cliente inexistente 404; sabor inexistente 500 **sem gravar nada** |
| Edição | Substitui itens e campos; desconto 0 aplicado; `pago` true/false; 404 |
| Não atomicidade | **Reproduzida de forma determinística:** `clienteId` numérico inexistente passa na validação, os itens são apagados e só então o update falha por chave estrangeira. A venda fica intacta, mas **sem itens**. |
| Exclusão | Venda e itens (cascade); 404 |
| Pagamento | Marca com data atual ou explícita; aceita `"true"`; marcar de novo **preserva a primeira data**; voltar para pendente limpa; sem `pago` → 400; 404 |
| Filtros | Ordem decrescente; mês/ano no fuso do servidor; intervalo inclui o dia final; intervalo tem precedência sobre mês/ano; cliente; `pago=true/false`; valor inválido de `pago` ignorado; `limit` |

## 9. Totais/relatórios (`totais.test.js`, 8 testes)

Dataset de 5 vendas (4 em março, 1 em abril), com valores, status e horários escolhidos para cair nas bordas do mês:

| Endpoint | Congelado |
|---|---|
| `/vendas/totais?mes=3&ano=2026` | `totalGeral 38`, `valorTotal "199.00"`, `valorPago "155.00"`, `valorPendente "44.00"`, 4 vendas (2/2), por cliente (**agrupado por nome**), por dia (`dd/mm/aaaa` em pt-BR), média 9,5 |
| `/vendas/totais` (filtros) | Por cliente; sem filtro; período vazio (zeros e média 0); o `valor` gravado já é líquido (o desconto não é abatido de novo) |
| `/vendas/relatorio-mensal` | 12 meses; `nomeMes` "março"/"abril"; valores como string; ano sem vendas zerado |
| `/producao/resumo?mes&ano` | Produzido, vendido e saldo do mês; acumulado até o fim do mês (a produção posterior não entra); série de 12 meses |

**Fuso horário:**
- A suíte fixa **TZ=UTC**, tanto no processo de teste quanto no servidor. É o fuso do container de produção (Railway, MySQL `SYSTEM`).
- Com isso, 31/03 23:30Z conta em março e 01/04 00:30Z em abril. Esses casos estão testados.
- O frontend grava a hora **local** com sufixo `Z` (`RegistrarVenda.jsx:24`). Com o servidor em UTC, o calendário dos filtros coincide com o relógio de parede do gestor.
- **Se o servidor passar a rodar em `America/Manaus`, as bordas se deslocam 4 h.** Isso não foi executado nem alterado; é decisão da Etapa 0.5.
- `dataInicio` é interpretada como meia-noite UTC e `dataFim + "T23:59:59"` no fuso do servidor. Hoje isso é consistente só porque o servidor está em UTC.

## 10. Estoque acabado (`estoque.test.js`, 7 testes)

Congela `saldo = Σ produção − Σ vendas` por sabor:
- positivo, zero e negativo, com vários sabores, totais e ordem alfabética;
- sabor só com vendas (negativo);
- sabor só com produção;
- sabor sem movimento (não aparece);
- `KNOWN_BEHAVIOR`: sabor inativo aparece; **não há data de corte** (vendas anteriores a qualquer produção contam); datas futuras contam.

Valida a **regra de software**, não os dados reais. A Etapa 0.2 recomendou a reconciliação por contagem física (Opção C).

## 11. Clientes/rankings (`clientes.test.js`, 15 testes)

- **CRUD:** `trim`; validações de 3 a 100 caracteres; duplicidade ignorando maiúsculas; renomear para o nome de outro cliente → 400; DELETE bloqueado com vendas e permitido sem; `GET /:id` com as 10 vendas mais recentes e a contagem total.
- **Estatísticas:** totais, média 6,67, `vendasPorMes` com chaves `"março de 2026"`, últimas 5 vendas.
- **Sabores por cliente:** quantidade, vezes e porcentagem como string com 1 casa, em ordem decrescente.
- **Cliente sem venda:** tudo zerado ou vazio.
- **Ranking:** ordenado por total, com sabor favorito; clientes sem venda ficam de fora.
- `KNOWN_BEHAVIOR`: a duplicidade não normaliza acentos; o ranking agrupa por **nome**, não por id.

## 12. Resolução de nomes (`resolverNomes.test.js`, 12 testes, nível A)

| Caso | Comportamento |
|---|---|
| Exato ignorando maiúsculas, acentos, espaços e pontuação | resolve |
| Texto contido no nome / nome contido no texto | resolve |
| Exato × parcial | Exato vence, mesmo se o parcial tiver id menor |
| Sem correspondência / banco vazio | `null` |
| Sabores | Vários nomes, quantidades preservadas, lista de não encontrados; inativo não é resolvido |
| `KNOWN_BEHAVIOR` | **Ambíguo escolhe em silêncio o PRIMEIRO (menor id)** ("quitanda" com 3 candidatos); texto que normaliza para vazio (`""`, `"!!!"`) casa com o primeiro cliente; "leite" → "Doce de Leite"; o mesmo sabor pode ser resolvido duas vezes |

## 13. `/vendas/auto` (`vendasAuto.test.js`, 15 testes)

| Área | Casos |
|---|---|
| Autenticação | `KNOWN_BEHAVIOR`: **só a API Key não basta** (401 "Token não fornecido"); JWT sem chave → 401; chave errada → 401; JWT + chave → 201 |
| Registro | Resolve cliente e sabores por texto; `quantidade = Σ itens` (diferente do `POST /vendas`); nasce pendente; aceita `data` e `pago`; `KNOWN_BEHAVIOR`: valor vem do chamador |
| Idempotência | Mesma chave → 200 `duplicata:true`, sem nova venda (mesmo com outro valor); chaves diferentes ou sem chave → cria |
| Erros | Validações 400; cliente não encontrado → 404 com sugestão **fixa** (sem candidatos); sabor não encontrado → 404 com lista, nada gravado; `KNOWN_BEHAVIOR`: `clienteNome: "!!!"` registra a venda para o **primeiro cliente** |

## 14. Autenticação (`auth.test.js`, 14 testes)

- **Login:** válido (token de 7 dias, sem senha no retorno); senha errada e email inexistente → 401 com mensagem genérica; `/auth/registro` → 404.
- **Rotas protegidas:** `GET /` é pública; sem header; `Bearer` sem token; assinatura inválida; token expirado; usuário removido; válido (inclui `/auth/verificar`).
- `KNOWN_BEHAVIOR`: login sem email → 500; o esquema do `Authorization` não é verificado ("Qualquer <token>" funciona).
- Também verifica que a suíte roda em TZ=UTC.

## 15. Comportamentos conhecidos

### 15.1 Comportamento esperado e correto (deve ser preservado)

- MRP: necessidade proporcional ao rendimento, soma por insumo, arredondamento a 3 casas, bloqueio 422 com faltantes, transação com rollback na criação e na edição, reversão na exclusão.
- Movimentações de insumo por custo: criação, recálculo, desvínculo e remoção coerentes; conversões kg→g e L→ml.
- Saldo de insumo como soma de movimentações.
- Vendas: criação atômica (nested write), pagamento com preservação da primeira data, filtros, totais e relatório mensal.
- Autenticação: rejeições por token ausente, inválido, expirado ou de usuário removido.
- Idempotência do `/vendas/auto`; resolução exata com prioridade sobre a parcial.

### 15.2 Comportamentos atuais conhecidos que NÃO devem ser preservados para sempre

Estão congelados só para proteger a Etapa 0.4 (refatoração pura). **Não são requisitos do novo sistema.** Cada um deve ser alterado depois, de propósito, atualizando o teste correspondente.

| # | Comportamento | Teste | Origem | Gravidade para o SMA |
|---|---|---|---|---|
| K1 | Editar só a observação da produção **apaga as saídas de insumo** e não as recria | producao | **novo (0.3)** | Alta (corrompe o saldo de MP) |
| K2 | `PUT /vendas/:id` sem `sabores` **apaga os itens** | vendas | **novo (0.3)** | Alta |
| K3 | Edição de venda não atômica (itens apagados antes de um update que falha) | vendas | auditoria | Alta |
| K4 | Resolução ambígua escolhe o primeiro candidato em silêncio | resolverNomes | auditoria | Alta (Agente de Vendas) |
| K5 | Texto que normaliza para vazio resolve o primeiro cliente; `/vendas/auto` com `"!!!"` grava venda | resolverNomes, vendasAuto | **novo (0.3)** | Alta |
| K6 | `/vendas/auto` exige JWT além da API Key | vendasAuto | auditoria | Média |
| K7 | Valor da venda vem do cliente HTTP (manual e automática) | vendas, vendasAuto | auditoria | Média |
| K8 | `quantidade` do `POST /vendas` não é recalculada pelos itens | vendas | **novo (0.3)** | Média |
| K9 | Venda não valida estoque; aceita sabor inativo | vendas | auditoria | Média |
| K10 | Conversão de unidade limitada a kg→g e L→ml (sensível a maiúsculas) | custos | auditoria | Média |
| K11 | Custo com insumo gera ENTRADA em qualquer categoria | custos | **novo (0.3)** | Baixa |
| K12 | Sabor sem receita, ou receita sem rendimento, é produzido sem consumo | producao | auditoria | Média |
| K13 | Saldo negativo exibido como "disponível 0.0", mas a falta usa o saldo real | producao | **novo (0.3)** | Baixa |
| K14 | Sabor inexistente → 500 na produção e na venda (deveria ser 4xx) | producao, vendas | **novo (0.3)** | Baixa |
| K15 | "Saldo baixo" fixo em < 200 em qualquer unidade; tipo de movimentação desconhecido ignorado | materiaPrima | auditoria | Média |
| K16 | Venda às 23:59:59,500 do último dia não entra em mês nenhum (`lte 23:59:59.000`) | vendas | **novo (0.3)** | Baixa |
| K17 | Filtros de data dependem do fuso do servidor (hoje UTC; o frontend grava hora local como UTC) | vendas, totais | auditoria | Média (Etapa 0.5) |
| K18 | Estoque sem data de corte; inclui inativos e datas futuras | estoque | auditoria/0.2 | Alta (Opção C) |
| K19 | Ranking e totais agrupam por nome do cliente | clientes, totais | **novo (0.3)** | Baixa |
| K20 | Duplicidade de cliente não normaliza acentos | clientes | **novo (0.3)** | Baixa |
| K21 | Edição de custo ignora valores "falsy" (0) | custos | **novo (0.3)** | Baixa |
| K22 | `PUT /vendas/:id` exige `clienteId` e `quantidade` | vendas | **novo (0.3)** | Baixa |
| K23 | Login sem email → 500; esquema do `Authorization` não verificado | auth | **novo (0.3)** | Baixa |

Total: **42 testes `KNOWN_BEHAVIOR`** (os `it.each` expandidos), cobrindo 23 grupos. Para listá-los: `grep -rn KNOWN_BEHAVIOR backend/tests/caracterizacao`.

## 16. Cobertura funcional

| Arquivo | Testes | KNOWN | Endpoints/funções |
|---|---|---|---|
| auth.test.js | 14 | 2 | `/auth/login`, `/auth/verificar`, middleware `verificarAuth`, `GET /` |
| producao.test.js | 30 | 6 | `POST/PUT/DELETE/GET /producao` (+ `calcularNecessidades` e `getSaldoMateriaPrima` observados) |
| materiaPrima.test.js | 17 | 4 | `/materias-primas` (CRUD + resumo) |
| custos.test.js | 34 | 9 | `/custos` (CRUD + resumo; `converterParaBase` observado) |
| vendas.test.js | 37 | 9 | `/vendas` (CRUD, pagamento, filtros) |
| totais.test.js | 8 | 0 | `/vendas/totais`, `/vendas/relatorio-mensal`, `/producao/resumo` |
| estoque.test.js | 7 | 3 | `/estoque` |
| clientes.test.js | 15 | 2 | `/clientes` (CRUD, estatísticas, sabores, ranking) |
| sabores.test.js | 13 | 0 | `/sabores` (CRUD, receita) |
| resolverNomes.test.js | 12 | 4 | `resolverCliente`, `resolverSabores` (nível A) |
| vendasAuto.test.js | 15 | 3 | `/vendas/auto` |
| **Total** | **202** | **42** | **41 dos 42 endpoints da API** + o único service exportado; **387 chamadas `expect()`** no código (mais em `it.each`) |

Único endpoint sem teste: `GET /api/sabores/:id` (leitura simples por id).

## 17. O que NÃO está coberto e por quê

| Item | Motivo |
|---|---|
| Frontend / E2E | Fora do escopo da etapa |
| `totalHoje` / `totalSemana` do `/producao/resumo` | Dependem do relógio real; congelá-los exigiria mockar o tempo do servidor (processo separado) |
| Servidor em `America/Manaus` | A regra de fuso não deve mudar nesta etapa; documentado em §9 e K17 (Etapa 0.5) |
| Concorrência (idempotência sob corrida, check-then-act do saldo na produção) | Exigiria testes não determinísticos; o risco está registrado na auditoria |
| `/vendas/auto` com `sabores[].nome` ausente | Resultado atual é 500 por `TypeError`; não priorizado |
| Seed e scripts de backfill | Protegidos na 0.1; não são comportamento da API |
| n8n | Artefato não funcional (auditoria e 0.2); não reativado |
| Desempenho, segurança (CORS, rate limit) e logs | Não são comportamento funcional; pendências da 0.2 |
| `backend/tests/api.test.js` | Smoke test manual obsoleto; mantido intacto e **excluído** do Vitest |

## 18. Validações

| Validação | Resultado |
|---|---|
| Suíte completa | **202/202** aprovados |
| Execuções completas | **30** (default, JSON, ordem embaralhada). Antes do ajuste de isolamento (§18.1): 17, com 3 perdas de resultado. Depois: **13 de 13** (10 JSON + 2 embaralhadas + 1 `npm test`) sem falha e **sem teste pendente** |
| Duração | ~22–33 s por execução completa (inclui recriar o schema e subir o servidor) |
| Arquivo isolado (`vendas.test.js`, 8×) | 37/37 em todas |
| Banco dev | Checksum das 11 tabelas **idêntico** antes e depois de todas as execuções; banco restaurado da 0.2 também intacto |
| Produção | Nenhuma conexão; os hosts de produção são bloqueados pelas guardas (testado) |
| Dados reais | Nenhuma leitura de dumps, `.coleta-tcc` ou `restore_*` (verificado por busca em `tests/` e `vitest.config.js`) |
| Código de negócio | `git diff -- src prisma/schema.prisma frontend n8n` vazio |
| `node --check` | OK em `src/`, `prisma/`, `scripts/` e nos 17 arquivos novos de `tests/` |
| `prisma validate` | Schema válido |
| `npm run test:guardas` | 27/27 (ferramentas 0.1/0.2 intactas) |

### 18.1 Intermitência encontrada e corrigida

- **Sintoma:** com um processo por arquivo (`isolate: true`, padrão do Vitest), algumas execuções completas **perderam resultados** do `vendas.test.js`:
  - uma vez 10 testes (a execução mostrou "10 de 11 arquivos", sem nenhuma falha listada);
  - uma vez 1 teste;
  - uma vez 21 testes, que ficaram `pending`.
  - Nos três casos, o Vitest **ainda reportou sucesso**.
- **Diagnóstico:**
  - o arquivo isolado passou 8 de 8 vezes;
  - os testes perdidos eram sempre os finais de um arquivo, o que sugere que o processo de teste encerrava antes de enviar os últimos resultados;
  - a causa-raiz exata, interna ao Vitest ou ao Windows, **não foi comprovada**.
- **Correção (só configuração):** `isolate: false` com `maxWorkers: 1`, ou seja, um único processo para todos os arquivos. O isolamento entre testes continua garantido pela limpeza do banco antes de cada teste.
- **Resultado:** 10 de 10 execuções verificadas por JSON e mais 2 embaralhadas, todas com 202 aprovados e 0 pendentes.
- **Segunda barreira:** o gate da baseline (§18.2).

### 18.2 Gate da baseline (reforço pós-revisão)

A configuração de um único processo resolve o sintoma, mas não impede que um falso sucesso volte a acontecer. Por isso, `npm test` passou a exigir o **conjunto completo** da baseline:

| Peça | Função |
|---|---|
| `tests/caracterizacao/baseline.json` | Valores esperados: **202 testes, 11 arquivos, 0 pendentes**. Só muda de forma consciente, com motivo registrado. |
| `scripts/testes/verificarBaseline.js` | Função pura `verificarResultado(relatorioJson, baseline)`: confere arquivos, total, aprovados, falhas, pendentes/todo, status por arquivo e por teste, e `success` |
| `scripts/testes/executarSuite.js` | `npm test`: roda o Vitest com o reporter JSON e aplica o gate. Sai com **código ≠ 0** se o Vitest falhar **ou** se o gate reprovar. Recusa argumentos (execução parcial usa `npx vitest run <arquivo>`, sem gate). |
| `scripts/testes/verificarBaseline.test.js` | 5 testes do gate (`npm run test:guardas`) |

Validação do gate:

| Cenário | Resultado |
|---|---|
| `npm test` ×3 | 202/202 em 11/11 arquivos; gate aprovado; exit 0 |
| **Relatório real** da intermitência (181 aprovados + 21 pendentes, `success: true`) | Gate **reprovado**: 23 divergências, apontando cada teste pendente; exit 1 |
| `npm test` ponta a ponta com a baseline adulterada para 203 | O Vitest saiu com 0 (202 passed); o gate **reprovou**; `npm test` exit 1. Baseline restaurada para 202. |
| `npm run test:guardas` | 32/32 (27 anteriores + 5 do gate) |
| Banco dev e banco restaurado da 0.2 | Checksums idênticos ao retrato inicial |

## 19. Arquivos criados/alterados

| Arquivo | Tipo |
|---|---|
| `backend/package.json` | alterado: scripts `test`/`test:watch`; devDependencies `vitest`, `supertest` |
| `backend/package-lock.json` | alterado (instalação) |
| `backend/vitest.config.js` | novo |
| `backend/tests/caracterizacao/setup/{ambiente,globalSetup,porArquivo}.js` | novos |
| `backend/tests/caracterizacao/helpers/{db,http,fixtures}.js` | novos |
| `backend/tests/caracterizacao/*.test.js` (11) | novos |
| `backend/tests/caracterizacao/baseline.json` | novo (gate) |
| `backend/scripts/testes/{executarSuite,verificarBaseline,verificarBaseline.test}.js` | novos (gate) |
| `docs/tcc/etapa-0-3-testes-caracterizacao.md` | novo (este) |

Nenhum arquivo em `backend/src`, `backend/prisma/schema.prisma`, `frontend/` ou `n8n/` foi alterado.

## 20. Preparação para a Etapa 0.4

**Como usar a suíte durante a extração:**
1. `npm test` antes de cada passo, para ter a linha de base verde (**o gate precisa confirmar 202/202**).
2. Extrair **uma** regra por vez (sugestão abaixo) sem mudar o contrato HTTP.
3. `npm test` depois: **os 202 testes, inclusive os 42 `KNOWN_BEHAVIOR`, devem continuar verdes.** Um `KNOWN_BEHAVIOR` que quebra indica que a refatoração mudou o comportamento sem querer.
4. Mudar um comportamento conhecido é uma decisão **separada**, posterior à 0.4, com o teste atualizado no mesmo commit e registro no relatório.

**Ordem sugerida de extração, do menor para o maior risco:**
1. `db.js` compartilhado (1 `PrismaClient` no lugar dos 10 atuais).
2. Saldo de matéria-prima (`getSaldoMateriaPrima` + `resumoMateriasPrimas`).
3. Estoque acabado (`listarEstoque`).
4. Conversão de unidade (`converterParaBase`) e custos.
5. `calcularNecessidades` e produção.
6. Totais e relatórios de vendas.
7. Vendas (atenção a K2/K3 durante a extração).
8. Resolução de nomes (a evolução para candidatos + score **não** é refatoração: é mudança de comportamento, planejada para depois).

**Nível A passa a ser possível:** com as funções extraídas e exportadas, a 0.4 pode acrescentar testes unitários diretos (sem HTTP) das regras puras, mantendo estes testes de integração como rede de proteção.
