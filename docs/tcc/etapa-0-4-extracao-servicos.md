# Etapa 0.4 — Extração da camada de domínio/serviços

**Data:** 29–30/09/2026
**Base:** `docs/tcc/auditoria-tecnica-inicial.md` (§3, §12.2, §17), `docs/tcc/etapa-0-ambientes-e-baseline.md`, `docs/tcc/etapa-0-2-analise-dos-dados.md`, `docs/tcc/etapa-0-3-testes-caracterizacao.md`
**Branch de trabalho:** `refactor/etapa-0-4-servicos`, a partir de `62d8fc8` (commit da 0.3). Revisada e **aprovada com ressalvas** em 30/09/2026; mudanças na infraestrutura de teste (§14.2) aprovadas, desde que o gate exija execução integral 202/202.

---

## 1. Objetivo

Separar o HTTP da regra de negócio no backend, sem alterar o comportamento observável:

```text
antes:  routes → controllers (HTTP + validação + regra + agregação + Prisma)
depois: routes → controllers HTTP finos → services de domínio → Prisma compartilhado
```

A camada extraída será consumida pelos controllers atuais, pelas futuras tools determinísticas e pelos agentes (Opção A/híbrida da auditoria, §12.2), e também pelos testes.

**Contrato da refatoração:** os 202 testes de caracterização da 0.3, **inclusive os 42 `KNOWN_BEHAVIOR`**. Nenhum bug conhecido foi corrigido nesta etapa.

## 2. Arquitetura antes

```text
HTTP
 → server.js: cors → express.json()
 → verificarAuth (JWT + usuário no banco; PrismaClient próprio)
 → routes/<domínio>.js (validateVenda / validateCliente / verificarApiKey)
 → controllers/<domínio>Controller.js
     ├─ lê req.params/req.query/req.body
     ├─ valida
     ├─ regra de negócio (MRP, saldo, conversão, agregações, transações)
     ├─ new PrismaClient() próprio
     └─ res.status(...).json(...)
 → MySQL
```

- **10** `new PrismaClient()` em `src/` (8 controllers, o middleware `auth.js` e `services/resolverNomes.js`).
- **2.030** linhas nos 8 controllers. A pasta `services/` só tinha `resolverNomes.js`.
- Nenhuma regra podia ser chamada sem HTTP, exceto a resolução de nomes. `calcularNecessidades` e `getSaldoMateriaPrima` eram funções privadas do `producaoController`, e `converterParaBase` era privada do `custosController`.

## 3. Arquitetura depois

```text
HTTP
↓
Controller        (lê req, chama o service, traduz resultado/erro em resposta)
↓
Service           (regra de negócio; sem req/res/Express; devolve dados ou lança ErroDominio)
↓
Prisma            (instância única: src/lib/prisma.js)
↓
MySQL
```

```text
backend/src/
├── lib/
│   ├── prisma.js        instância única do PrismaClient
│   ├── erros.js         ErroDominio + adaptador HTTP responderErroDominio
│   └── periodos.js      intervaloDoMes (expressão de datas antes repetida 9×)
├── services/
│   ├── producaoService.js      MRP, faltantes, CRUD de produção, resumo
│   ├── materiaPrimaService.js  saldo (puro e por id), CRUD, resumo
│   ├── custosService.js        conversão, CRUD com ENTRADA de insumo, resumo
│   ├── estoqueService.js       estoque acabado + reexporta o saldo de insumos
│   ├── vendasService.js        criação manual/por texto, edição, pagamento, consultas, totais
│   ├── clientesService.js      CRUD, estatísticas, sabores do cliente, ranking
│   ├── saboresService.js       CRUD, receita (rendimento + itens)
│   ├── authService.js          autenticar (bcrypt + JWT)
│   └── resolverNomes.js        (já existia; só passou a usar o Prisma compartilhado)
├── controllers/   8 arquivos, agora finos
├── middlewares/   auth.js usa o Prisma compartilhado; o resto está intacto
└── routes/        intactas
```

**A futura camada SMA vai consumir os services diretamente, no mesmo processo** (`import { calcularNecessidades } from "../services/producaoService.js"`), sem chamar HTTP do próprio backend. Assim:
- não passa de novo por JWT/API Key, serialização JSON nem formatação feita para a interface;
- reaproveita as mesmas transações, validações e o 422 de insumo insuficiente;
- evita duplicar a lógica de agregação numa segunda camada;
- ganha testes diretos das funções (nível A) sem servidor.

Na §12.4 da auditoria, as escritas feitas por agentes continuam planejadas para passar por `AcaoProposta` + aprovação do gestor. Os services são o que o **executor determinístico** vai chamar depois da aprovação, e não uma tool entregue ao LLM.

## 4. Prisma compartilhado

`src/lib/prisma.js`:

```js
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
```

| | Antes | Depois |
|---|---|---|
| `new PrismaClient()` em `src/` | 10 | **1** |
| Fora de `src/` (processos próprios) | `prisma/seed.js`, `scripts/marcarVendasAntigasPagas.js`, `scripts/tcc/coletarDadosReadOnly.js`, `tests/.../helpers/db.js` | inalterados |

As quatro instâncias fora de `src/` rodam em **processos separados** (seed, backfill, coleta read-only com URL própria, suíte com URL de teste explícita) e não entram no servidor. Por isso não foram tocadas. A configuração do banco e o `schema.prisma` não mudaram.

Primeiro passo, isolado e testado antes da extração dos domínios: **202/202, 24,8 s**.

**Dependência do Prisma nos services:** cada service importa o Prisma compartilhado. Onde uma função precisa rodar **dentro de uma transação** existente, ela recebe um `client` opcional (padrão: o Prisma global). É o caso de `obterSaldoMateriaPrima(id, client)`, `calcularNecessidades(sabores, client)` e `verificarFaltantes(necessidades, client)`. É a mesma técnica que o controller original já usava em `getSaldoMateriaPrima(client, id)`. Não há framework de DI.

## 5. Produção (`producaoService.js`)

| Função | Origem | Uso futuro |
|---|---|---|
| `calcularNecessidades(sabores, client?)` | função privada do controller, idêntica | Agente de Estoque: "quanto insumo X lotes consomem?" |
| `verificarFaltantes(necessidades, client?)` | bloco duplicado em criar e editar | Agente de Estoque: "dá para produzir?" sem gravar nada |
| `criarProducao(dados)` | `criarProducao` | executor de ação aprovada |
| `atualizarProducao(id, dados)` | `atualizarProducao` | idem |
| `excluirProducao(id)` | `deletarProducao` | idem |
| `listarProducao({ mes, ano })` | `listarProducao` | consultas |
| `obterResumoProducao({ mes, ano })` | `resumoProducao` | Agente de Inteligência |

Preservado exatamente:
- verificação do saldo **antes** da transação na criação e **dentro** dela, depois de reverter as saídas, na edição;
- mensagens de faltantes com `toFixed(1)`, saídas arredondadas a 3 casas e data da saída;
- 422 lançado dentro do `$transaction` da edição, o que provoca o rollback completo;
- sabor inexistente como `Error` comum, portanto **500** (K14);
- `rendimentoBase` nulo ou receita vazia → sem consumo (K12);
- edição sem `sabores` apaga as saídas e não as recria (**K1**).

O bloco de gravação das saídas (`registrarSaidas`), antes duplicado entre criar e editar, virou uma função interna com os mesmos parâmetros.

## 6. Matéria-prima (`materiaPrimaService.js`)

- `calcularSaldo(movimentacoes)` é **pura**: ENTRADA soma, SAIDA subtrai, AJUSTE soma com o próprio sinal, e tipo desconhecido é ignorado (K15). Antes, a mesma regra aparecia copiada em `producaoController.getSaldoMateriaPrima` e em `materiasPrimasController.resumoMateriasPrimas`. Hoje as duas usam `calcularSaldo`.
- `obterSaldoMateriaPrima(id, client?)`: saldo de um insumo, também dentro de transação.
- `resumoMateriasPrimas()`: `saldoBaixo` continua fixo em `0 < saldo < 200` em qualquer unidade (K15).
- CRUD: `listarMateriasPrimas`, `criarMateriaPrima` (reativa o registro inativo de mesmo nome), `atualizarMateriaPrima`, `desativarMateriaPrima` (DELETE continua sendo desativação).

## 7. Custos (`custosService.js`)

- `converterParaBase(quantidade, unidade, unidadeBase)` exportada **sem alteração**: só `kg→g` e `L→ml`, sensível a maiúsculas; o resto entra cru (**K10**).
- `criarCusto`: custo e `ENTRADA/CUSTO` na mesma transação, em qualquer categoria (K11).
- `atualizarCusto`: apaga e recria a entrada. `undefined` mantém o vínculo; `null` desvincula. Valores "falsy" continuam ignorados no update (K21).
- `excluirCusto`, `listarCustos`, `resumoCustos`.

## 8. Estoque (`estoqueService.js`)

- `obterEstoqueAcabado()`: `saldo = Σ produção − Σ vendas` por sabor, desde sempre, com totais e ordem alfabética. Mantém a falta de data de corte, os sabores inativos e as datas futuras (**K18**).
- Reexporta `obterSaldoMateriaPrima` e `resumoMateriasPrimas`, para que o futuro Agente de Estoque tenha um ponto único de leitura de estoque (acabado + insumos).
- **Não implementado** (fora do escopo): inventário físico, estoque inicial, mínimo, cobertura em dias. A decisão da Opção C (0.2) continua pendente.

## 9. Vendas (`vendasService.js`)

| Função | Endpoint |
|---|---|
| `criarVenda(dados)` | `POST /vendas` (nested write, atômico) |
| `criarVendaPorTexto(dados)` | `POST /vendas/auto`; devolve `{ duplicata, venda, cliente, saboresResolvidos }`, e o controller monta os dois formatos de resposta (200 duplicata / 201) |
| `listarVendas(filtros)` | `GET /vendas` |
| `buscarVenda(id)` | `GET /vendas/:id` |
| `atualizarVenda(id, dados)` | `PUT /vendas/:id` |
| `atualizarPagamento(id, dados)` | `PATCH /vendas/:id/pagamento` |
| `excluirVenda(id)` | `DELETE /vendas/:id` |
| `obterTotais(filtros)` | `GET /vendas/totais` |
| `relatorioMensal({ ano })` | `GET /vendas/relatorio-mensal` |

**A edição não atômica foi movida intacta**, com comentário explícito no código: `vendaSabor.deleteMany` fora de transação e **sempre**, antes do `venda.update` (**K2 e K3**). Os testes que reproduzem os dois comportamentos continuam verdes. Também continuam: valor e quantidade vindos do chamador (K7, K8), nenhuma validação de estoque (K9), resolução ambígua pelo primeiro candidato (K4), `"!!!"` resolvendo o primeiro cliente (K5) e a borda 23:59:59,5 (K16, em `lib/periodos.js`).

O `import { parse } from "dotenv"`, que não era usado no controller, saiu junto.

## 10. Clientes (`clientesService.js`)

- CRUD: `listarClientes`, `buscarCliente` (10 vendas mais recentes + contagem), `criarCliente`, `atualizarCliente`, `excluirCliente` (bloqueado se houver vendas). A duplicidade continua ignorando só maiúsculas (K20).
- Indicadores para o futuro Agente de Vendas: `obterEstatisticasCliente`, `obterSaboresDoCliente` e `obterRankingSabores` (cliente × sabor, agrupado por **nome**, K19).

## 11. Sabores/receitas (`saboresService.js`)

- CRUD: `listarSabores`, `buscarSabor`, `criarSabor`, `atualizarSabor`, `excluirSabor`. Um sabor com vendas é só desativado, e o service devolve `{ desativado: true, sabor }` para o controller montar a mesma resposta.
- Receita: `obterReceita` e `salvarReceita` (rendimento + substituição dos itens numa transação).
- Nenhuma receita real foi cadastrada. Schema intacto.

## 12. Auth

Extraída só a regra do login: `authService.autenticar({ email, senha })` → `{ token, usuario }`, ou `ErroDominio 401` com a mesma mensagem para e-mail inexistente e para senha errada. JWT (`{ id, email }`, 7 dias), bcrypt e mensagens continuam iguais. Login sem e-mail continua em **500** (K23).

**Não alterados:** `middlewares/auth.js` (só trocou para o Prisma compartilhado), `middlewares/apiKeyAuth.js`, a ordem dos middlewares e as rotas. `authController.registro` continua no arquivo, intocado: é código morto, sem rota desde `e0f7b64`, e é o único trecho de controller que ainda acessa o Prisma.

## 13. Estratégia de erros

Mínima, em `src/lib/erros.js`:

```js
export class ErroDominio extends Error { constructor(status, corpo) { … } }   // status + corpo exatos da API
export const erro = (status, mensagem, extras) => new ErroDominio(status, { error: mensagem, ...extras });
export function responderErroDominio(res, error) { … }   // só os controllers usam
```

- **Situações previstas** (400, 401, 404, 422) → `ErroDominio` com o status e o corpo que a API já devolvia, inclusive corpos compostos: `faltantes` no 422, `sugestao` e `naoEncontrados/encontrados` nos 404 do `/vendas/auto`.
- **Qualquer outro erro** (Prisma, `TypeError`, sabor inexistente) propaga como antes, e cada controller mantém **o seu** 500 original, com a mesma mensagem, a mesma concatenação de `error.message` quando existia e o mesmo `console.error`.
- Os services não sabem de HTTP. Um chamador sem HTTP, como um agente, pode ler `erro.status` e `erro.corpo` (por exemplo, `corpo.faltantes`).
- A 422 da edição de produção era um `Error` com `statusCode`, tratado por um `if` no controller. Hoje é o mesmo `ErroDominio` da criação.

Não há hierarquia de exceções, middleware de erro novo nem mudança no handler global do `server.js`.

## 14. Testes durante a refatoração

### 14.1 Por bloco (gate `npm test` = 202/202 em 11/11 arquivos, 0 falhas, 0 pendentes)

| Passo | Domínio | Arquivos | Resultado do gate | Tempo da suíte |
|---|---|---|---|---|
| 0 | Prisma compartilhado | `lib/prisma.js`, 8 controllers, `middlewares/auth.js`, `services/resolverNomes.js` | ✅ 202/202 | 24,8 s |
| A | Produção + matéria-prima | `producaoService`, `materiaPrimaService`, `lib/erros`, `lib/periodos`, 2 controllers | ⛔ 1ª execução: **140/146, exit 1** (queda nativa, §14.2) → investigação → ✅ 202/202 | 20–33 s |
| B | Custos | `custosService`, `custosController` | ✅ 202/202 | 22,3 s |
| C | Estoque | `estoqueService`, `estoqueController` | ✅ 202/202 | 27,7 s |
| D | Vendas | `vendasService`, `vendasController` | ✅ 202/202 (após 1 queda nativa refeita pelo gate) | 29,5 s |
| E | Clientes | `clientesService`, `clientesController` | ✅ 202/202 (após 1 queda nativa refeita pelo gate) | 29,5 s |
| F | Sabores/receitas | `saboresService`, `saboresController` | ✅ 202/202 | 23,1 s |
| G | Auth | `authService`, `authController` | ✅ 202/202 | 28,8 s |

**Nenhum teste falhou por asserção em nenhum momento.** Todo resultado diferente de 202 veio da queda do processo de teste descrita abaixo. A baseline (202/11) **não foi alterada**.

### 14.2 Queda nativa intermitente do processo de teste (0xC0000409)

**Sintoma:** o processo do Vitest que executa os testes (não o servidor) morre com `exit code 3221226505` (0xC0000409, *fail-fast* nativo do Windows) no meio da suíte. O relatório fica incompleto (por exemplo, 140/146 e 60/67), e o Vitest sai com código ≠ 0. O **gate barrou todas as ocorrências**: nenhuma virou falso sucesso.

**É diferente da intermitência da 0.3** (resultados perdidos com o Vitest saindo com 0). Aquela continua resolvida por `isolate: false` + um único worker.

**Investigação:**

| Experimento | Execuções | Quedas |
|---|---|---|
| Após o Bloco A, Vitest direto | 6 | 1 |
| Sem `$disconnect()` por arquivo (`setup/porArquivo.js`) | 12 | 3 |
| Sem o addon nativo `bcrypt` no processo de teste (`helpers/fixtures.js` usa um hash pré-calculado) | 12 | 1 |
| Gates dos blocos B–G | 6 | 2 |
| **A/B intercalado, mesma infraestrutura de teste: `src/` da 0.3 (A) × `src/` da 0.4 (B)** | 12 A + 12 B | **A: 1** (rodada 7, 94/101) · **B: 0** |
| Validação final (§14.3) | 4 | 1 (refeita pelo gate) |

**Conclusão: a queda não foi introduzida pela refatoração.** No experimento A/B, feito com um worktree em `62d8fc8` (o `src/` da 0.3) e a mesma infraestrutura de teste, schema e `node_modules`, a queda aconteceu com o código **anterior** à extração. As rodadas foram alternadas A, B, A, B… para não enviesar por horário ou carga da máquina, e rodaram o Vitest direto, sem gate nem retry. Todas as 23 execuções que terminaram deram 202/202, nas duas versões.

A causa-raiz **não foi comprovada**. 0xC0000409 é um encerramento *fail-fast* nativo, típico de addon nativo; o processo de teste carrega o query engine do Prisma. A taxa observada varia de 0 a 25% por lote, sem diferença atribuível ao código sob teste. Na 0.3, as 17 execuções após `isolate: false` não tiveram queda, o que é compatível com uma taxa baixa e intermitente.

Uma observação sobre o histórico: os comentários em `executarSuite.js` e `verificarBaseline.js` já afirmavam que a queda era "anterior à refatoração" antes de haver evidência, porque o experimento A/B da primeira sessão de trabalho foi interrompido depois de 1 rodada. A afirmação só passou a ser sustentada pelo experimento completo acima, feito em 30/09.

**Mitigações mantidas** (infraestrutura de teste; nenhum teste ou asserção mudou):
1. `helpers/fixtures.js`: hash bcrypt (custo 4) **pré-calculado** da senha fictícia. O processo de teste não carrega mais o addon nativo `bcrypt`; o servidor continua verificando a senha com `bcrypt.compare`, e os testes de login continuam exercitando isso.
2. `setup/porArquivo.js`: sem `$disconnect()` a cada arquivo. Com um processo único, a conexão dura até o fim da execução. Isso não eliminou a queda, mas também não prejudicou.
3. `scripts/testes/executarSuite.js`: **se, e somente se**, a saída do Vitest contiver a assinatura exata `Worker exited unexpectedly with exit code 3221226505`, a suíte **inteira** é refeita do zero, no máximo 3 vezes. Falha de teste nunca é repetida, e qualquer outra saída ≠ 0 é definitiva. O gate continua exigindo uma execução **completa** 202/202. A mensagem final informa quantas quedas houve.
   - `ehQuedaNativa` tem teste em `verificarBaseline.test.js`, que distingue o código exato de 134, de falhas de asserção e de um código com dígito a mais.
   - O caminho de repetição foi exercitado por quedas **reais** nos gates dos blocos D e E. A simulação com `process.exit(3221226505)` **não** o exercitou, porque o Vitest intercepta `process.exit` e reporta outra mensagem. Nesse caso o gate falhou (exit 1), o que é o comportamento seguro.

**Por que isso não enfraquece o gate:** a repetição não aceita resultado parcial nem ignora testes. Ela só descarta uma execução que **não terminou** e exige outra completa. O cenário `exit 0 + menos de 202` continua reprovado.

### 14.3 Validação final (30/09, com o código final)

| Validação | Resultado |
|---|---|
| `npm test` (gate) ×4 | 202/202 em 11/11, 0 falhas, 0 pendentes nas 4. Execuções 1, 2 e 4 limpas (21–28 s); na 3, uma queda nativa na 1ª tentativa, e a repetição completa deu 202/202 |
| Experimento A/B (Vitest direto) | 23 execuções completas, todas 202/202 (12 da 0.4, 11 da 0.3) |
| Gate com a baseline adulterada para 203 | Vitest `202 passed` e saída 0, **gate reprovado** ("esperado 203"), `npm test` exit 1. Baseline restaurada (`git status` limpo) |
| `npm run test:guardas` (ferramentas 0.1/0.2 + gate) | 33/33 |
| `node --check` | 67/67 arquivos `.js` de `src/`, `scripts/`, `prisma/` e `tests/` |
| `prisma validate` | schema válido |
| `npm run build` (`prisma generate`) | OK, sem conexão com banco (checksum idêntico depois) |
| Banco dev (`doces_maloca_dev`, 11 tabelas) e banco restaurado da 0.2 | `CHECKSUM TABLE` **idêntico** ao retrato tirado na 0.3, depois de todas as execuções desta etapa |
| Produção | Nenhuma conexão: `DATABASE_URL` e `DATABASE_URL_TEST` apontam para `127.0.0.1:3307`, sem variáveis `RAILWAY_*`, e as guardas da 0.1 seguem ativas na suíte e no roteiro diferencial |
| Dados reais | Nenhum dump, `.coleta-tcc` ou tabela `restore_*` lido (o `CHECKSUM` do restore só devolve números). Nada disso aparece no diff nem nos arquivos não rastreados |
| Áreas proibidas | `git diff` vazio em `prisma/`, `frontend/`, `n8n/`, `package*.json`, `vitest.config.js` e `baseline.json`. Não existe `src/agents` |

## 15. KNOWN_BEHAVIOR preservados

Todos os 42 testes `KNOWN_BEHAVIOR` (23 grupos, §15.2 da 0.3) continuam verdes. Os mais sensíveis à extração estão marcados no código dos services:

| # | Comportamento | Onde está agora |
|---|---|---|
| K1 | Editar só a observação da produção apaga as saídas de insumo | `producaoService.atualizarProducao` (comentário) |
| K2/K3 | PUT de venda sem `sabores` apaga os itens; edição não atômica | `vendasService.atualizarVenda` (comentário) |
| K4/K5 | Resolução ambígua pelo primeiro candidato; `"!!!"` resolve o primeiro cliente | `resolverNomes.js` (intacto) → `criarVendaPorTexto` |
| K7/K8/K9 | Valor e quantidade do chamador; sem validação de estoque | `vendasService` (cabeçalho) |
| K10/K11/K21 | Conversões limitadas; ENTRADA em qualquer categoria; "falsy" ignorado na edição | `custosService` (cabeçalho) |
| K12/K13/K14 | Sem receita, sem consumo; "disponível 0.0"; sabor inexistente → 500 | `producaoService` |
| K15 | "Saldo baixo" < 200; tipo desconhecido ignorado | `materiaPrimaService` |
| K16/K17 | 23:59:59,5 fora do mês; filtros no fuso do processo | `lib/periodos.js` |
| K18 | Estoque sem data de corte | `estoqueService` |
| K19/K20 | Agrupamento por nome; duplicidade sem normalizar acentos | `clientesService`, `vendasService.obterTotais` |
| K23 | Login sem e-mail → 500 | `authService` |

## 16. Métricas antes/depois

| Métrica | Antes (`62d8fc8`) | Depois |
|---|---|---|
| `new PrismaClient()` em `src/` | 10 | **1** |
| Linhas nos 8 controllers | 2.030 | **534** (−74%) |
| Módulos de service | 1 (`resolverNomes`) | **9** (+ 3 em `lib/`) |
| Linhas em `services/` + `lib/` | 56 | 1.614 |
| Funções de domínio exportadas e reutilizáveis sem HTTP | 2 | **48** |
| Funções puras (sem banco) | 0 | 2 (`calcularSaldo`, `converterParaBase`) + `intervaloDoMes` |
| Controllers com regra relevante | 8 | **0** (só resta o `registro` do auth, código morto sem rota) |
| Controllers que acessam o Prisma | 8 | 1 (`authController`, só no `registro` sem rota) |
| Cópias da regra de saldo de insumo | 2 | 1 |
| Cópias da expressão de intervalo do mês | 9 | 1 |
| Endpoints alterados estruturalmente | — | **41 de 42** (só `GET /auth/verificar` e as rotas ficaram intocados) |
| **Endpoints com comportamento alterado** | — | **0** |
| Diff em `src/` | — | +112 / −1.611 em arquivos existentes, mais 12 arquivos novos |

**Funções reutilizáveis (48):**
- `producaoService`: `calcularNecessidades`, `verificarFaltantes`, `listarProducao`, `criarProducao`, `atualizarProducao`, `excluirProducao`, `obterResumoProducao`
- `materiaPrimaService`: `calcularSaldo`, `obterSaldoMateriaPrima`, `listarMateriasPrimas`, `criarMateriaPrima`, `atualizarMateriaPrima`, `desativarMateriaPrima`, `resumoMateriasPrimas`
- `custosService`: `converterParaBase`, `listarCustos`, `criarCusto`, `atualizarCusto`, `excluirCusto`, `resumoCustos`
- `estoqueService`: `obterEstoqueAcabado` (+ reexportações de saldo)
- `vendasService`: `criarVendaPorTexto`, `criarVenda`, `listarVendas`, `buscarVenda`, `atualizarVenda`, `atualizarPagamento`, `excluirVenda`, `obterTotais`, `relatorioMensal`
- `clientesService`: `listarClientes`, `buscarCliente`, `criarCliente`, `atualizarCliente`, `excluirCliente`, `obterEstatisticasCliente`, `obterSaboresDoCliente`, `obterRankingSabores`
- `saboresService`: `listarSabores`, `buscarSabor`, `criarSabor`, `atualizarSabor`, `excluirSabor`, `obterReceita`, `salvarReceita`
- `authService`: `autenticar`
- `resolverNomes`: `resolverCliente`, `resolverSabores`

A redução de LOC não foi um objetivo. Ela vem de a regra ter saído dos controllers, e o código total ficou praticamente igual.

## 17. Validação manual

### 17.1 Revisão de código

Cada handler original (`git show 62d8fc8:backend/src/controllers/*.js`) foi comparado linha a linha com o par controller + service novo. Pontos verificados:
- mesmas queries Prisma, `include`, `orderBy` e `take`;
- mesmas coerções (`parseInt`, `parseFloat`, `new Date(ano, mes - 1, 1)` com strings);
- mesmo status e corpo de cada resposta, inclusive a concatenação `": " + error.message` nos 500 que já a tinham;
- mesmos `console.log`/`console.error`, que continuam aparecendo só onde apareciam;
- mesma ordem de chaves nos objetos agregados (`porSabor`, `saldoPorSabor`, `porCliente`, `porDia`), que também é contrato do JSON;
- mesmas transações, com as mesmas operações dentro e fora delas (em especial a edição de venda, que continua **fora**).

Os defaults `= {}` na desestruturação dos services não mudam nada via HTTP: com Express 4.22 + body-parser 1.20, o `express.json()` sempre define `req.body = req.body || {}`.

### 17.2 Comparação diferencial 0.3 × 0.4 (ambiente local, banco de teste)

Em vez de clicar na interface, o **mesmo roteiro de 42 requisições** foi executado contra o `src/server.js` da 0.3 (worktree em `62d8fc8`) e contra o da 0.4. Cada versão rodou com o banco `doces_maloca_test` recriado do zero (wrapper protegido da 0.1), dados fictícios idênticos, TZ=UTC e segredos fictícios. Depois as **respostas** (status + corpo) e o **estado final das 11 tabelas** foram comparados. Só `createdAt/updatedAt`, JWT e carimbos de "agora" foram normalizados.

| Fluxo pedido | Passos do roteiro | Resultado |
|---|---|---|
| Criar custo | 3 kg → 3000 g; 1500 g; `cx` sem conversão (K10); editar para 2 kg; excluir | **idêntico** |
| Criar produção | 50 cocadas + sabor sem receita; insuficiente (422); sabor inexistente (500, K14) | **idêntico** |
| Editar produção | → 80 com nova data; insuficiente (422 + rollback); só observação (K1: saídas apagadas); excluir | **idêntico** |
| Registrar venda | manual; `/vendas/auto` por texto (201) e duplicata idempotente (200) | **idêntico** |
| Editar venda | itens e desconto; cliente inexistente (500, venda fica **sem itens**, K3) | **idêntico** |
| Marcar pagamento | com data; de novo com `"true"` (preserva a data); sem campo (400); inexistente (404) | **idêntico** |
| Consultar estoque | `/estoque`, resumo de MP (4×), totais, relatório mensal, resumo de produção e de custos | **idêntico** |
| Outros | estatísticas, sabores do cliente, ranking, receita, login ok/401 e **`GET /sabores/:id`** (o endpoint sem teste de caracterização) ok/404 | **idêntico** |
| Banco ao final | 11 tabelas, linha a linha | **idêntico** |

Resultado: **42/42 respostas e 11/11 tabelas idênticas.** O script ficou fora do repositório (scratchpad da sessão), porque é uma ferramenta de verificação desta etapa e não faz parte da suíte.

## 18. Riscos restantes

| Risco | Situação |
|---|---|
| Queda nativa 0xC0000409 do processo de teste | Não é causada pela refatoração (A/B, §14.2), mas continua sem causa-raiz. O gate a trata com segurança (nunca vira falso sucesso), e o retry só aceita uma execução completa. Custo: execuções ocasionalmente mais longas. Se a frequência subir, investigar o engine do Prisma no Windows ou rodar a suíte em Linux/CI |
| `GET /api/sabores/:id` sem teste de caracterização | Refatorado. Equivalência verificada por revisão linha a linha e pela comparação diferencial (§17) |
| Concorrência (check-then-act do saldo na criação de produção; idempotência do `/vendas/auto` sob corrida) | Inalterada, e não coberta pela suíte (0.3 §17). O Prisma compartilhado muda o pool de conexões do servidor (1 pool em vez de 10), o que não altera a semântica das transações |
| `responderErroDominio` mora em `lib/erros.js`, junto com `ErroDominio` | É um adaptador HTTP usado só pelos controllers, e os services não o importam. Pode ir para uma pasta `http/` quando existir uma segunda interface |
| Services devolvem objetos Prisma (Decimal, Date) no formato da API | Proposital, para manter o contrato. As tools dos agentes vão precisar de DTOs próprios (Etapa 1.3) |
| `lib/periodos.js` e agregações por data dependem do fuso do processo | Inalterado (K17). Decisão da Etapa 0.5 |
| Todos os `KNOWN_BEHAVIOR` | Continuam no sistema de propósito. São os próximos a corrigir, de forma consciente |

## 19. Arquivos alterados/criados

**Novos (12):**
- `backend/src/lib/prisma.js`, `erros.js`, `periodos.js`
- `backend/src/services/producaoService.js`, `materiaPrimaService.js`, `custosService.js`, `estoqueService.js`, `vendasService.js`, `clientesService.js`, `saboresService.js`, `authService.js`
- `docs/tcc/etapa-0-4-extracao-servicos.md` (este)

**Alterados (código de produção):**
- `backend/src/controllers/` (os 8): agora são camada HTTP fina
- `backend/src/middlewares/auth.js` e `backend/src/services/resolverNomes.js`: só trocaram para o Prisma compartilhado

**Alterados (infraestrutura de teste, §14.2):**
- `backend/scripts/testes/executarSuite.js`: repete a suíte inteira só na queda nativa 0xC0000409
- `backend/scripts/testes/verificarBaseline.js`: `ehQuedaNativa`
- `backend/scripts/testes/verificarBaseline.test.js`: teste do detector (32 → 33 testes de guardas)
- `backend/tests/caracterizacao/helpers/fixtures.js`: hash bcrypt pré-calculado
- `backend/tests/caracterizacao/setup/porArquivo.js`: sem `$disconnect()` por arquivo

**Não alterados:** `prisma/schema.prisma`, `routes/`, `server.js`, `middlewares/apiKeyAuth.js`, `middlewares/validations.js`, `package.json`, `package-lock.json`, `vitest.config.js`, `tests/caracterizacao/baseline.json`, os 11 arquivos `*.test.js`, `frontend/` e `n8n/`. Não existe `src/agents`.

## 20. Preparação para a próxima etapa

- **Etapa 0.5 (fuso):** toda a lógica de "mês" passa por `lib/periodos.intervaloDoMes`, e "hoje/semana" está só em `obterResumoProducao`. A mudança de fuso fica concentrada nesses pontos, com os testes de borda (K16/K17) atualizados junto.
- **Correção dos KNOWN_BEHAVIOR:** cada um está localizado num único service e tem teste. A correção vira uma mudança pequena, com o teste `KNOWN_BEHAVIOR` substituído pelo comportamento novo no mesmo commit. Prioridades para o SMA: K2/K3 (venda atômica), K1, K4/K5 (candidatos + score), K7/K8 (valor e quantidade derivados).
- **Etapa 1.3 (tools):** as tools de leitura do Agente de Estoque podem ser escritas diretamente sobre `obterEstoqueAcabado`, `resumoMateriasPrimas`, `obterSaldoMateriaPrima`, `calcularNecessidades` e `verificarFaltantes`, que já permitem simular "dá para produzir N?" sem gravar nada. As do Agente de Vendas podem usar `obterTotais`, `obterRankingSabores`, `obterEstatisticasCliente` e `listarVendas`.
- **Testes nível A:** com as funções exportadas, dá para acrescentar testes unitários diretos, como `calcularSaldo` e `converterParaBase`, que são puras. A suíte de integração continua como rede de proteção.
