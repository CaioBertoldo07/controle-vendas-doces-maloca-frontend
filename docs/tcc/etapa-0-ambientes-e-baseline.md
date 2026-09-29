# Etapa 0.1 — Ambientes separados e baseline (e preparação da 0.2)

**Data:** 29/09/2026
**Base:** `docs/tcc/auditoria-tecnica-inicial.md` (risco R1, bloqueador)
**Escopo:** separar produção, desenvolvimento e teste; proteger scripts perigosos; preparar a coleta somente leitura da Etapa 0.2.
**Fora do escopo (não feito):** testes de caracterização, extração de serviços, agentes, correção de bugs, mudanças de regra de negócio, frontend, n8n, schema do domínio.

---

## 1. Problema encontrado

O projeto só tinha um banco identificável: o de produção (MySQL usado pelo serviço `doce-maloca-backend` no Railway). Não havia `.env` local, `.env.example`, banco de desenvolvimento ou banco de teste. Três pontos podiam alterar o schema ou os dados de produção sem intenção explícita.

| Onde | Comando | Quando rodava de fato |
|---|---|---|
| `backend/package.json` → `build` | `prisma generate && prisma db push --accept-data-loss` | **A cada deploy no Railway.** O builder é o Railpack, que executa o script `build` do `package.json`, e as variáveis do serviço (inclusive `DATABASE_URL`) ficam disponíveis no build. |
| `backend/package.json` → `start` | `npx prisma generate && npx prisma db push --accept-data-loss && node src/server.js` | **Não roda em produção hoje.** O serviço no Railway tem start command customizado `node src/server.js`. Rodaria em qualquer `npm start` local ou se o comando customizado fosse removido. |
| `backend/prisma/seed.js` | `deleteMany()` em vendas, itens, sabores, clientes e usuários; recria admin `123456` | Sempre que alguém rodasse `node prisma/seed.js` com a `DATABASE_URL` de produção |
| `backend/scripts/marcarVendasAntigasPagas.js` | `UPDATE vendas SET pago = true ...` em massa | Sempre que executado (foi escrito para rodar uma única vez em produção) |

Configuração do Railway confirmada por consulta **somente leitura** (sem ler variáveis/segredos):

```text
Projeto: doce-maloca-backend  →  1 serviço: doce-maloca-backend
Root directory: /backend   Builder: RAILPACK   Start command: node src/server.js
Variáveis definidas: 3
```

O projeto Railway do backend **não contém um serviço MySQL**. O banco de produção está em outro projeto ou provedor, referenciado pela `DATABASE_URL` do serviço. Isso importa para a estratégia de backup (§8).

## 2. Riscos anteriores

| Risco | Consequência |
|---|---|
| `db push --accept-data-loss` no build | Qualquer mudança no `schema.prisma` que remova ou renomeie coluna/tabela, ou mude um tipo, era aplicada **automaticamente em produção no deploy, descartando dados sem confirmação**. As novas tabelas do SMA iriam para produção no primeiro push. |
| Mesmo comando no `start` | Um `npm start` local com a URL de produção faria o mesmo. |
| Seed destrutivo sem proteção | Apagaria vendas, clientes, sabores e usuários de produção e criaria um admin com senha `123456`. |
| Backfill sem proteção | Marcaria como pagas vendas legitimamente pendentes. |
| Sem banco local | Todo desenvolvimento e teste precisaria de um banco real, e o único disponível era o de produção. |
| Sem `.env.example` | As variáveis necessárias não estavam documentadas. |

## 3. Arquitetura dos três ambientes

```text
                 ┌───────────────────────────────────────────────┐
PRODUÇÃO         │ Railway: serviço doce-maloca-backend          │
                 │ start: node src/server.js   build: prisma generate
                 │ DATABASE_URL = MySQL de produção (fora do repo)│
                 │ Schema só muda por AÇÃO EXPLÍCITA + backup (§8)│
                 └───────────────────────────────────────────────┘

                 ┌───────────────── máquina do desenvolvedor ────────────────┐
                 │ docker compose (backend/docker-compose.yml)               │
                 │ MySQL 8.4 em 127.0.0.1:3307                               │
DESENVOLVIMENTO  │   doces_maloca_dev   ← DATABASE_URL       (APP_ENV=development)
TESTE            │   doces_maloca_test  ← DATABASE_URL_TEST  (descartável, sufixo _test)
                 └───────────────────────────────────────────────────────────┘

COLETA 0.2       DATABASE_URL_COLETA (definida só no terminal, na hora) → sessão READ ONLY
```

| | Produção | Desenvolvimento | Teste |
|---|---|---|---|
| Banco | MySQL do Railway (ou onde a `DATABASE_URL` do serviço apontar) | `doces_maloca_dev` no Docker local | `doces_maloca_test` no Docker local |
| Variável | `DATABASE_URL` (painel do Railway) | `DATABASE_URL` em `backend/.env` | `DATABASE_URL_TEST` em `backend/.env` |
| Declaração | Railway injeta `RAILWAY_*` (opcional: `APP_ENV=production`) | `APP_ENV=development` | definida pelo wrapper (`APP_ENV=test`) |
| Alteração de schema | Manual, após backup | `npm run db:dev:push` | `npm run db:test:reset` (apaga e recria) |
| Seed/backfill | **Bloqueados** | Permitidos | — |

Decisão: um único servidor MySQL local com **dois bancos** (dev e test). Isso separa os dados, não exige um segundo container e mantém o `docker compose up -d` simples. O banco de teste é "impossível de confundir" porque: (1) precisa terminar em `_test`; (2) precisa ser diferente do banco de dev; (3) precisa ser local; (4) nunca pode ser host do Railway.

## 4. Alterações realizadas

### 4.1 Scripts do `backend/package.json`

| Script | Antes | Depois |
|---|---|---|
| `build` | `prisma generate && prisma db push --accept-data-loss` | `prisma generate` |
| `start` | `npx prisma generate && npx prisma db push --accept-data-loss && node src/server.js` | `node src/server.js` (igual ao start command do Railway) |
| `dev` | `nodemon src/server.js` | `node scripts/ambiente/verificarAmbiente.js desenvolvimento && nodemon src/server.js` |
| `postinstall` | `prisma generate` | sem mudança |
| `backfill:pagamentos` | sem mudança | sem mudança (a proteção está no script) |
| `ambiente:verificar` | — | verifica se o ambiente de dev é seguro |
| `db:dev:push` | — | `prisma db push` no banco de dev, via guarda (**sem** `--accept-data-loss`) |
| `db:dev:seed` | — | `node prisma/seed.js` (a guarda está no seed) |
| `db:test:reset` | — | `prisma db push --force-reset --skip-generate` no banco de **teste**, via guarda |
| `test:guardas` | — | `node --test` nas guardas e no validador read-only |
| `tcc:coleta` | — | coleta read-only da Etapa 0.2 |

O `prisma generate` continua rodando onde é necessário: no `postinstall` (toda instalação, inclusive no Railway), no `build` (deploy) e automaticamente no `db:dev:push`.

> **Correção (Etapa 0.2):** o banco de produção tem a tabela `_prisma_migrations` com 3 migrations aplicadas em 02/12/2025 (`init`, `add_usuarios`, `add_sabores_e_valor`). Ou seja, `prisma migrate` foi usado no início do projeto e depois abandonado em favor de `db push`. Qualquer adoção futura de migrations precisa reconciliar essa tabela. Ver `docs/tcc/etapa-0-2-analise-dos-dados.md`.

**Por que não migrations agora:** o projeto não usa `prisma migrate` desde dez/2025. A pasta `prisma/migrations/*` está no `.gitignore` e o schema de produção foi construído só por `db push`. Adotar migrations exige primeiro criar uma migration *baseline* a partir de produção (`prisma migrate diff` + `prisma migrate resolve --applied`) e decidir o versionamento da pasta. Isso fica como decisão para quando a Etapa 1 for criar as tabelas do SMA. Até lá, qualquer mudança de schema em produção segue o procedimento manual da §8.

### 4.2 Proteções

- `backend/scripts/ambiente/guardas.js`: regras de ambiente (funções puras + `garantirAcessoAoBanco`).
- `backend/scripts/ambiente/verificarAmbiente.js`: checagem via CLI (usada no `npm run dev`).
- `backend/scripts/ambiente/prisma.js`: executa o Prisma CLI só contra dev/test, passando pela guarda.
- `backend/prisma/seed.js`: +1 import e +1 chamada `garantirAcessoAoBanco("desenvolvimento")` antes do `PrismaClient`. Nada mais foi alterado.
- `backend/scripts/marcarVendasAntigasPagas.js`: idem (+ nota no cabeçalho).

### 4.3 Ambiente local

- `backend/docker-compose.yml`: MySQL 8.4, porta `127.0.0.1:3307`, volume nomeado, healthcheck.
- `backend/docker/mysql/init/01-banco-de-teste.sql`: cria `doces_maloca_test` e dá permissão ao usuário local.
- `backend/.env.example`: todas as variáveis, só com placeholders e valores do Docker local.
- `.gitignore` (raiz): `!.env.example`. Antes, `.env*` fazia o Git ignorar o próprio modelo.
- `backend/.gitignore`: `.coleta-tcc/` (saída da coleta).

### 4.4 Coleta da Etapa 0.2

- `backend/scripts/tcc/somenteLeitura.js`: validador de SQL somente leitura.
- `backend/scripts/tcc/consultasColeta.js`: catálogo de 20 consultas constantes.
- `backend/scripts/tcc/coletarDadosReadOnly.js`: executor com as barreiras descritas na §10.
- Testes: `guardas.test.js` e `somenteLeitura.test.js` (`node:test`, sem dependência nova).

**Nenhuma dependência foi instalada.** Nenhum controller, rota, middleware, service, schema, frontend ou workflow n8n foi alterado.

## 5. Como subir o banco local

Pré-requisito: Docker Desktop rodando.

```bash
cd backend
docker compose up -d --wait     # sobe o MySQL e espera ficar saudável
docker compose ps               # doces-maloca-mysql ... (healthy) 127.0.0.1:3307->3306
```

Outros comandos:

```bash
docker compose stop             # para, mantendo dados
docker compose down             # remove o container, mantendo o volume (dados)
docker compose down -v          # remove container E volume: APAGA os bancos locais
```

O banco de teste é criado pelo script de init **só na primeira inicialização do volume**. Se o volume já existia antes desse arquivo, recrie com `docker compose down -v && docker compose up -d --wait`.

## 6. Como configurar o `.env`

```bash
cd backend
cp .env.example .env            # no PowerShell: Copy-Item .env.example .env
```

Os valores padrão já funcionam com o Docker local. Troque `JWT_SECRET` e `N8N_API_KEY` por strings próprias. **Nunca** coloque a URL de produção em `backend/.env`: as ferramentas recusariam, mas o próprio servidor (`node src/server.js`) não tem guarda (§9).

| Variável | Obrigatória | Uso |
|---|---|---|
| `APP_ENV` | sim (dev) | `development` libera as ferramentas locais |
| `DATABASE_URL` | sim | banco de dev (Prisma + servidor) |
| `DATABASE_URL_TEST` | para testes | banco de teste (`*_test`) |
| `JWT_SECRET` | sim | assinatura do JWT (`authController.js`, `middlewares/auth.js`) |
| `N8N_API_KEY` | para `/vendas/auto` | `middlewares/apiKeyAuth.js` |
| `PORT` | não (padrão 3000) | porta HTTP |
| `ALLOW_NON_LOCAL_DEV_DATABASE` | não | libera banco de dev remoto (nunca Railway) |
| `DATABASE_URL_COLETA` | só na Etapa 0.2 | alvo da coleta read-only; deixar vazio no arquivo |

## 7. Como executar o backend em desenvolvimento

```bash
cd backend
npm install                     # se ainda não instalou
docker compose up -d --wait
npm run db:dev:push             # cria/atualiza as tabelas no doces_maloca_dev
npm run db:dev:seed             # opcional: dados fictícios (APAGA o banco de dev)
npm run dev                     # verifica o ambiente e sobe com nodemon
```

O seed cria o login `admin@docesmaloca.com` / `123456` (apenas no dev). O frontend continua usando `VITE_API_URL` ou `http://localhost:3000/api` por padrão.

## 8. Como preparar o banco de teste

```bash
cd backend
npm run db:test:reset           # apaga e recria o schema em doces_maloca_test
```

Contrato para a futura suíte (Etapa 0.3):
- O setup global dos testes deve chamar `garantirAcessoAoBanco("teste")` e usar `DATABASE_URL_TEST` como `DATABASE_URL` do processo de teste.
- Cada execução pode começar com `npm run db:test:reset`, porque o banco é descartável.
- O antigo `backend/tests/api.test.js` (smoke test HTTP obsoleto) **não foi alterado** e não faz parte dessa estratégia.

### Backup de produção (instruções; nada foi executado)

**Antes de qualquer mudança de schema em produção:**

1. **Localize o banco.** Veja no painel do Railway a variável `DATABASE_URL` do serviço `doce-maloca-backend`. O MySQL não está nesse projeto; identifique o projeto ou provedor dele.
2. **Se for um serviço MySQL do Railway (com volume):** na aba *Backups* do serviço MySQL, crie um backup manual e, se possível, ative o agendamento (*Daily* guarda 6 dias, *Weekly* 27, *Monthly* 89). Observações da documentação do Railway: backup manual limitado a 50% do tamanho do volume; restauração só no mesmo projeto e ambiente; apagar o volume apaga os backups. Por isso, faça também o dump lógico do passo 3.
3. **Dump lógico (portável, independente do Railway).** Não exige cliente MySQL instalado:

   ```bash
   # use a URL pública (proxy) do MySQL; a senha vai por variável, não na linha de comando
   docker run --rm -e MYSQL_PWD='<senha>' mysql:8.4 \
     mysqldump -h <host-proxy> -P <porta> -u <usuario> \
     --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF \
     <banco> > backup-producao-AAAAMMDD.sql
   ```

   Guarde o arquivo **fora do repositório** (contém dados do negócio).
4. **Teste o backup** restaurando-o no MySQL local, num banco à parte:

   ```bash
   docker exec -i doces-maloca-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS doces_maloca_restore"'
   docker exec -i doces-maloca-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" doces_maloca_restore' < backup-producao-AAAAMMDD.sql
   ```

5. **Só então** aplique a mudança de schema em produção, de forma consciente e sem `--accept-data-loss`: `npx prisma db push` com a URL de produção **apenas naquele terminal**. Se o Prisma avisar sobre perda de dados, **pare e reavalie**.

## 9. Proteção contra produção

Regra: **negar por padrão**. Seed, backfill, `db:dev:push`, `db:test:reset` e `npm run dev` só rodam quando **todas** as condições abaixo valem. Caso contrário, encerram com código 1 e listam os motivos, **antes** de abrir qualquer conexão.

| Condição | Desenvolvimento | Teste |
|---|---|---|
| URL válida `mysql://` | `DATABASE_URL` | `DATABASE_URL_TEST` |
| Ambiente declarado | `APP_ENV=development` | wrapper define `APP_ENV=test` |
| Nenhum indício de produção | `APP_ENV`/`NODE_ENV`≠`production`; sem `RAILWAY_*` no ambiente; host não é `*.rlwy.net`, `*.railway.app` nem `*.railway.internal` | idem |
| Host local | `localhost`, `127.0.0.1`, `::1`, `host.docker.internal` (ou `ALLOW_NON_LOCAL_DEV_DATABASE=true`, que **nunca** libera o Railway) | idem |
| Nome do banco | — | termina em `_test` |
| Isolamento | — | diferente de `DATABASE_URL` (host+porta+banco) |

`ALLOW_NON_LOCAL_DEV_DATABASE` faz o papel sugerido para `ALLOW_DESTRUCTIVE_DB_OPERATIONS`, com semântica mais estreita: libera **apenas** um banco de desenvolvimento remoto que não seja do Railway.

Exemplo de bloqueio (saída real):

```text
⛔ Operação bloqueada [seed (apaga dados)]: ambiente de desenvolvimento não é seguro.
   - host do banco é do Railway (fake.proxy.rlwy.net)
   - o banco não é local (fake.proxy.rlwy.net); defina ALLOW_NON_LOCAL_DEV_DATABASE=true se for um banco de desenvolvimento remoto
```

**Limites conhecidos:**
- `node src/server.js` / `npm start` **não** têm guarda, de propósito: é o comando de produção. Rodar o servidor local com a URL de produção continua possível, mas não altera o schema. Use sempre `npm run dev` localmente.
- O backfill de pagamentos agora só roda em banco local. Se um dia precisar rodar em produção, isso exige alterar o script conscientemente e fazer backup antes.
- Recomendação (não aplicada; exige ação no painel): definir `APP_ENV=production` nas variáveis do serviço no Railway, como defesa adicional.

## 10. Como executar a coleta read-only da Etapa 0.2

**Barreiras de segurança do script**

1. Lê **somente** `DATABASE_URL_COLETA`. Nunca usa `DATABASE_URL`. Sem a variável, recusa.
2. **Simulação por padrão:** sem `--executar`, não conecta; mostra o alvo e as consultas.
3. **Validador de SQL:** as 20 consultas são constantes e precisam passar em `validarSomenteLeitura` (só `SELECT`/`WITH`, uma instrução, sem comentários, sem `INTO`/`FOR UPDATE`/`LOCK`/`SLEEP`/DDL/DML). Se uma falhar, nada é executado.
4. **Sessão MySQL `READ ONLY`:** uma única conexão (`connection_limit=1`), `SET SESSION TRANSACTION READ ONLY` confirmado via `@@transaction_read_only`, e `MAX_EXECUTION_TIME` de 30 s por consulta.
5. A saída vai para `backend/.coleta-tcc/` (ignorado pelo Git): `coleta-<data>.md` e `.json`. Não há nomes de clientes nem dados de usuários, só contagens, séries e nomes de sabores e insumos.

**Opções, da mais segura para a menos segura**

| Opção | Contato com produção | Como |
|---|---|---|
| **A (recomendada)** | só o dump (§8) | Restaurar o backup em `doces_maloca_restore` local e coletar ali |
| B | leitura direta, com usuário restrito | Criar em produção um usuário só com `GRANT SELECT` (ação consciente no banco) e usá-lo na URL |
| C | leitura direta, usuário principal | As barreiras 1–4 ainda valem, mas as credenciais têm poder de escrita |

```bash
cd backend
# Opção A (após restaurar o backup localmente):
export DATABASE_URL_COLETA="mysql://root:root_local@127.0.0.1:3307/doces_maloca_restore"
#   PowerShell: $env:DATABASE_URL_COLETA = "mysql://..."
npm run tcc:coleta                  # simulação: confira o alvo
npm run tcc:coleta -- --executar    # executa
unset DATABASE_URL_COLETA           # PowerShell: Remove-Item Env:DATABASE_URL_COLETA
```

**O que a coleta responde**

| Decisão | Indicadores |
|---|---|
| Volume disponível | `vendas_resumo`, `vendas_por_mes`, `producao_resumo`, `producao_por_mes`, `custos_por_mes`, `periodo_*`, `meses_com_*` |
| Qualidade dos dados | `vendas_consistencia`, `custos_resumo.materia_prima_sem_vinculo`, `custos_unidade_sem_conversao`, `sabores_ativos_sem_receita`, `materias_primas_com_saldo_negativo` |
| Data de corte do estoque acabado | `vendas_antes_da_primeira_producao`, `percentual_unidades_vendidas_antes_da_primeira_producao`, por sabor: `saldo_historico` × `saldo_desde_primeira_producao` |
| Necessidade de inventário inicial | sabores com saldo negativo mesmo **depois** da primeira produção |
| Pagamentos | `pagamentos_resumo` (pagas com `dataPagamento = data` = padrão do backfill), `pendentes_por_idade`, `pagamentos_desde_funcionalidade` |
| Alcance do Agente de Inteligência | nº de meses com venda, dias com venda, clientes ativos em 90 dias, cobertura de receitas |

## 11. Arquivos alterados

| Arquivo | Tipo | Mudança |
|---|---|---|
| `backend/package.json` | alterado | scripts (§4.1) |
| `backend/prisma/seed.js` | alterado | +guarda (4 linhas) |
| `backend/scripts/marcarVendasAntigasPagas.js` | alterado | +guarda (7 linhas, incluindo comentário) |
| `.gitignore` | alterado | `!.env.example` |
| `backend/.gitignore` | alterado | `.coleta-tcc/` |
| `backend/.env.example` | novo | modelo de variáveis |
| `backend/docker-compose.yml` | novo | MySQL local |
| `backend/docker/mysql/init/01-banco-de-teste.sql` | novo | banco de teste |
| `backend/scripts/ambiente/guardas.js` | novo | regras de proteção |
| `backend/scripts/ambiente/guardas.test.js` | novo | 13 testes |
| `backend/scripts/ambiente/prisma.js` | novo | wrapper do Prisma CLI |
| `backend/scripts/ambiente/verificarAmbiente.js` | novo | checagem via CLI |
| `backend/scripts/tcc/somenteLeitura.js` | novo | validador de SQL |
| `backend/scripts/tcc/somenteLeitura.test.js` | novo | 7 testes |
| `backend/scripts/tcc/consultasColeta.js` | novo | 20 consultas |
| `backend/scripts/tcc/coletarDadosReadOnly.js` | novo | executor da coleta |
| `docs/tcc/etapa-0-ambientes-e-baseline.md` | novo | este documento |

Arquivos locais criados durante a validação e **ignorados pelo Git**: `backend/.env` (cópia do modelo), `backend/.coleta-tcc/*` (coletas do banco dev fictício). Também foram criados o container `doces-maloca-mysql` e o volume `doces-maloca-local_mysql_dados`.

## 12. Comandos de validação executados

```bash
npm run test:guardas                                   # testes das guardas + validador
# cenários de bloqueio (URLs fictícias, sem conexão):
npm run ambiente:verificar                             # sem .env
APP_ENV=development DATABASE_URL=mysql://...@fake.proxy.rlwy.net/... node prisma/seed.js
APP_ENV=production  DATABASE_URL=mysql://...@127.0.0.1:3307/... node scripts/marcarVendasAntigasPagas.js
RAILWAY_ENVIRONMENT_NAME=production ... npm run db:dev:push
DATABASE_URL_TEST=<mesmo banco do dev> npm run db:test:reset
APP_ENV=development DATABASE_URL=mysql://...@mysql.railway.internal/... npm run dev
npm run tcc:coleta                                     # sem DATABASE_URL_COLETA
# fluxo feliz (Docker local):
docker compose up -d --wait
npm run ambiente:verificar && npm run db:dev:push && npm run db:test:reset && npm run db:dev:seed
node src/server.js  +  curl / , POST /api/auth/login, GET /api/vendas/totais, GET /api/estoque
DATABASE_URL_COLETA=<dev local> npm run tcc:coleta [-- --executar]
# prova do READ ONLY: INSERT numa sessão READ ONLY → erro MySQL 1792
# baseline:
npx prisma validate ; node --check (todo o backend) ; grep accept-data-loss package.json
RAILWAY_ENVIRONMENT_NAME=production DATABASE_URL=<host inexistente> npm run build
git status ; git check-ignore ; varredura de segredos nos arquivos novos/alterados
```

## 13. Resultado das validações

| Validação | Resultado |
|---|---|
| `npm run test:guardas` | ✅ 20/20 testes passando |
| Seed com host do Railway | ✅ bloqueado, exit 1 |
| Backfill com `APP_ENV=production` | ✅ bloqueado, exit 1 |
| `db:dev:push` dentro do Railway (simulado) | ✅ bloqueado |
| `db:test:reset` apontando para o banco de dev | ✅ bloqueado (sem `_test` e mesmo banco) |
| `npm run dev` com host do Railway | ✅ bloqueado, exit 1; o nodemon não sobe |
| Coleta sem `DATABASE_URL_COLETA` | ✅ recusada |
| `docker compose up -d --wait` | ✅ `doces-maloca-mysql` healthy em `127.0.0.1:3307` |
| `db:dev:push` / `db:test:reset` | ✅ 11 tabelas em `doces_maloca_dev` e em `doces_maloca_test`; o reset atingiu só `doces_maloca_test` |
| Seed no dev | ✅ 20 vendas no dev; 0 no test (isolamento confirmado) |
| Backend local | ✅ `/` online, login OK, `/api/vendas/totais` e `/api/estoque` respondendo com dados do dev |
| Coleta read-only (dev) | ✅ 20 consultas, relatório `.md` + `.json`. Lógica de corte conferida: produzido 100, vendido 111, 91 antes da produção → saldo desde a produção = 80 |
| Sessão READ ONLY | ✅ `INSERT` rejeitado pelo MySQL (1792); contagem inalterada (41 → 41) |
| `prisma validate` | ✅ válido |
| `node --check` (backend inteiro + scripts novos) | ✅ |
| `--accept-data-loss` no `package.json` | ✅ ausente |
| `npm run build` com banco inacessível | ✅ só `prisma generate`, exit 0 (não toca no banco) |
| `backend/.env`, `.coleta-tcc/`, `.env.local` ignorados | ✅ |
| `backend/.env.example` versionável | ✅ |
| Segredos nos arquivos novos/alterados | ✅ nenhum (só senhas placeholder do Docker local, comentadas) |
| Frontend | não alterado; build não reexecutado |
| Produção | ✅ nenhuma conexão ao banco de produção. No Railway foram feitas apenas leituras de configuração (projeto, serviço, build/start) e consulta à documentação |

### Critérios de aceite

- [x] build não altera banco
- [x] start não usa `--accept-data-loss`
- [x] banco local configurável de forma independente
- [x] banco de teste com configuração independente
- [x] seed destrutivo protegido
- [x] `.env.example` existe e não contém segredos
- [x] produção não é usada automaticamente
- [x] coleta read-only preparada
- [x] nenhum código de negócio alterado
- [x] documentação criada
- [x] nenhum segredo commitado (nada foi commitado)
- [x] nenhuma ação no banco de produção

### Pendências e observações

1. **Primeiro deploy após o commit:** o build do Railway deixa de sincronizar o schema. Isso é o desejado. O schema de produção já deve estar sincronizado (a última mudança, `pago`/`dataPagamento`, foi publicada em 14/08/2026). Confira nos logs do deploy que o build só executou `prisma generate`.
2. **Localizar o MySQL de produção** (não está no projeto `doce-maloca-backend` do Railway) para aplicar a §8.
3. **Opcional:** definir `APP_ENV=production` no serviço do Railway.
4. **Backfill:** confirmar se já foi executado em produção. Agora ele está bloqueado fora do dev.
5. **Seed desatualizado** (não limpa produção/custos/matéria-prima; falharia por FK num banco com produções). Não foi corrigido, por estar fora do escopo. Relevante para a Etapa 0.3 (fixtures de teste).
6. **Adoção de `prisma migrate`**: decidir antes da Etapa 1 (baseline a partir de produção; revisar o `.gitignore` de `prisma/migrations`).
7. **Etapa 0.2:** executar a coleta pela opção A e registrar as decisões (data de corte, inventário inicial, alcance do Agente de Inteligência).
