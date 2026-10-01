# Etapa 1 — Infraestrutura multiagente

**Data:** 01/10/2026
**Base:** auditoria técnica (§10–§12, §16.2, §17), Etapas 0.2 a 0.6
**Branch de trabalho:** `feat/etapa-1-infraestrutura-multiagente`, a partir de `82fe862` (commit da 0.6). Revisada e **aprovada com ressalvas** em 01/10/2026 (ação presa em EXECUTANDO, migrations não aplicadas em produção, sem provedor LLM real, queda nativa do Vitest no Windows). Sem push e sem deploy.

---

## 1. Objetivo

Construir o **runtime** que os agentes do TCC vão usar, sem implementar ainda a inteligência de nenhum deles. A etapa entrega:
- persistência auditável (execuções, tools chamadas, mensagens, recomendações, ações propostas);
- registro de agentes e um runtime de execução;
- comunicação explícita entre agentes;
- tools determinísticas sobre os services;
- escrita só por ação proposta e aprovada;
- adaptador de LLM desacoplado com provedor fake;
- esqueleto do Coordenador e quatro agentes stub;
- rotas autenticadas.

## 2. Arquitetura SMA

```text
Frontend (futuro)
   ↓  HTTPS + JWT do gestor
/api/agentes/*            (routes/agentes.js → controllers/agentesController.js)
   ↓
Runtime SMA               (src/agents/runtime: registro, execução, auditoria)
   ↓
                       ┌──────────────┐
  Gestor ─▶ Atendimento ─▶│ Coordenador  │
           (entrada)   └──────┬───────┘
                              │  mensagens (MensagemAgente)
             ┌────────────────┼────────────────┐
             ↓                ↓                ↓
          Estoque          Vendas        Inteligência
             │                │                │
             └────────────────┼────────────────┘
                              ↓   contexto.usarTool / contexto.raciocinar (LLM)
                      Tools determinísticas (src/agents/tools, Zod)
                              ↓                       ↘ proporAcao → AcaoProposta PENDENTE
                     Services existentes (src/services)        ↓ gestor aprova
                              ↓                         Executor determinístico (src/agents/acoes)
                           Prisma                              ↓
                              ↓                         Services existentes
                            MySQL
```

| Regra | Como é garantida |
|---|---|
| Números vêm de código determinístico | Toda leitura passa por tools sobre os services testados; o LLM só redige (teste: a resposta "1000 g" vem do resultado da tool) |
| LLM sem acesso ao banco | O provedor recebe só **definições** de tools (JSON). Quem executa é o runtime (`cicloTools.js`). Verificação estática: `src/agents/llm` e `src/agents/agentes` não importam Prisma nem services |
| Agente sem escrita direta | O agente só recebe o `contexto`, que é imutável e não contém Prisma nem services. A única tool de escrita é `proporAcao`, que grava uma ação `PENDENTE` |
| Execução só após aprovação | Executor em `src/agents/acoes/servicoAcoes.js`, acionado só pela rota do gestor e **fora do catálogo de tools** |
| Auditoria | `ExecucaoAgente`, `ChamadaTool`, `MensagemAgente`, `Recomendacao`, `AcaoProposta` |

A camada consome os services **no mesmo processo**, sem chamadas HTTP ao próprio backend, como previsto na 0.4.

## 3. Decisão de migrations

**Situação encontrada:**
- `prisma/migrations/*` estava no `.gitignore`, e nenhuma migration jamais foi versionada.
- A produção tem `_prisma_migrations` com 3 registros de 02/12/2025 (`20251202132330_init`, `20251202140336_add_usuarios`, `20251202210828_add_sabores_e_valor`), cujo SQL não existe mais.
- Desde então, o schema evoluiu só por `db push`.

**Verificação da produção sem tocá-la:** comparei a estrutura (`mysqldump --no-data`, só DDL e nenhuma linha) da cópia local restaurada na 0.2 com o banco dev, que foi criado por `db push` do `schema.prisma` atual. A estrutura é **equivalente**: mesmas 11 tabelas, colunas, tipos, nulidade, defaults, índices e chaves. As diferenças não têm efeito:
- a tabela `_prisma_migrations`;
- a declaração explícita de `CHARACTER SET` (o padrão já é o mesmo);
- a ordem das colunas de `vendas`, que o Prisma ignora.

**Decisão:**
1. `prisma/migrations/` passa a ser **versionada** (`.gitignore` ajustado).
2. **`0_baseline`** = `prisma migrate diff --from-empty --to-schema-datamodel`: o schema de domínio atual, com as 11 tabelas, em UTF-8 sem BOM.
3. **`20261001120000_camada_sma`** = `migrate diff` entre o schema anterior e o novo. É **puramente aditiva**: 5 `CREATE TABLE` e chaves estrangeiras só entre as tabelas novas, sem nenhum `DROP` ou `ALTER` em tabela de domínio.
4. As migrations são geradas por `migrate diff`, entre dois schemas, e aplicadas com `migrate deploy`/`migrate reset`. Nenhum dos dois exige shadow database; o usuário local `maloca` não tem `CREATE DATABASE` global.
5. **Suíte de testes:** o reset do banco de teste passou de `db push --force-reset` para `migrate reset --force --skip-seed --skip-generate`. **Toda execução da suíte aplica as migrations do zero.**
6. Scripts: `db:dev:push` foi substituído por `db:dev:migrate` (`migrate deploy`), entrou `db:dev:status`, e `db:test:reset` passou a usar `migrate reset`. Tudo pelo wrapper protegido da 0.1. O `build` continua só `prisma generate`.

**Procedimento para produção** (documentado, **não executado**):

```text
backup → prisma migrate resolve --applied 0_baseline → prisma migrate deploy
```

Os 3 registros antigos **podem permanecer**: no cenário C (§20), depois do `resolve` e do `deploy`, o `migrate status` responde "Database schema is up to date!". O deploy da camada SMA será uma decisão posterior.

## 4. Schema da camada SMA

Cinco tabelas aditivas. Datas são **instantes técnicos UTC** (como `criadoEm`), não datas de negócio da política da 0.5. Payloads e metadados usam o tipo `Json` nativo do MySQL, sem texto serializado à mão.

| Modelo (tabela) | Campos principais | Observações |
|---|---|---|
| `ExecucaoAgente` (`execucoes_agente`) | agente, tipoExecucao, gatilho (`HTTP`/`MENSAGEM`/`INTERNO`), status (`EM_ANDAMENTO`/`SUCESSO`/`FALHA`), iniciadaEm, finalizadaEm, duracaoMs, entrada/saida/metadados (Json), erro, execucaoPaiId | Árvore de delegação pela autorrelação (`SET NULL`) |
| `ChamadaTool` (`chamadas_tool`) | execucaoId, tool, origem (`AGENTE`/`LLM`), entrada/saida (Json), ok, erro, duracaoMs | Responde "quais tools foram chamadas" sem ler JSON aninhado. **Acrescentada** à lista sugerida, porque é auditoria explícita |
| `MensagemAgente` (`mensagens_agente`) | execucaoId (origem), execucaoDestinoId, agenteOrigem, agenteDestino, tipo, conteudo/resposta (Json), status (`ENVIADA`/`RESPONDIDA`/`FALHA`) | Prova a cooperação |
| `Recomendacao` (`recomendacoes`) | agente, execucaoId, tipo, titulo, descricao, prioridade (`BAIXA`/`MEDIA`/`ALTA`), status (`ABERTA`/`RESOLVIDA`/`DESCARTADA`), dados (Json), criadaEm, resolvidaEm | Saída do agente; não altera dados do negócio |
| `AcaoProposta` (`acoes_propostas`) | tipo, payload (Json), descricao, status, criadaPorAgente, execucaoId, criadaEm, aprovadaEm, rejeitadaEm, motivoRejeicao, executadaEm, resultado (Json), erro | Status: `PENDENTE`, `APROVADA`, `REJEITADA`, `EXECUTANDO`, `EXECUTADA`, `FALHA` |

**`ParametroAgente` não foi criado.** Ainda não há parâmetro real para guardar: o estoque mínimo por insumo depende da Etapa 2 e da reconciliação física da 0.2. Os limites atuais (tempo, profundidade, passos do LLM) ficam em código, como opções do runtime. A tabela entra quando o primeiro parâmetro editável pelo gestor existir.

## 5. Runtime

Em `src/agents/runtime/runtime.js`, `criarRuntime({ registro, catalogo, provedorLLM, limiteMs = 30 s, profundidadeMaxima = 4 })` devolve `executarAgente(nome, entrada, { gatilho, execucaoPaiId, profundidade })`:

```text
agente existe? (senão 404, sem registro)
→ ExecucaoAgente EM_ANDAMENTO (entrada, gatilho, tipo, pai, metadados)
→ agente.executar(contexto)  com limite de tempo
→ SUCESSO (saída, finalizadaEm, duração)   |   FALHA (erro, finalizadaEm, duração)
                                              + ErroExecucaoAgente (HTTP 500 { error, execucaoId })
```

- **Nunca fica `EM_ANDAMENTO`:** qualquer erro, inclusive síncrono ou por tempo esgotado, fecha a execução como `FALHA`.
- **Erro guardado sem stack:** só a mensagem do `ErroDominio` ou a primeira linha do erro, com até 500 caracteres.
- **JSON de auditoria seguro (`paraRegistro`):**
  - converte `Decimal` e `BigInt`;
  - acima de 8.000 caracteres guarda só uma prévia marcada `_truncado`. O agente continua recebendo a saída completa.
- **Contexto do agente**, imutável:
  - `agente`, `execucaoId`, `entrada`, `profundidade`;
  - `toolsPermitidas()`, `usarTool()`, `enviarMensagem()`, `registrarRecomendacao()`, `raciocinar()`.

  Não há Prisma nem services: o teste lista as chaves do contexto e exige `Object.isFrozen`.

## 6. Registry

Em `src/agents/runtime/registro.js`, `criarRegistro()`:
- **registrar:** valida o contrato (`nome` em minúsculas, `descricao`, `tools` como lista de nomes, `executar`) e **recusa duplicados**;
- **obter:** um nome inexistente devolve `ErroDominio 404`;
- **existe, listar:** a listagem não expõe a função `executar`.

O registro padrão tem `coordenador`, `estoque`, `vendas`, `inteligencia` e `atendimento`.

## 7. Comunicação

`contexto.enviarMensagem({ para, tipo, dados })` é **síncrona e in-process**:
1. valida o destino (inexistente → erro, **sem** gravar mensagem), o tipo e a profundidade (máximo 4);
2. grava `MensagemAgente` `ENVIADA`;
3. executa o destino como execução **filha** (`gatilho MENSAGEM`, `execucaoPaiId`);
4. marca a mensagem `RESPONDIDA` (com resposta e `execucaoDestinoId`) ou `FALHA`, e propaga o erro.

O histórico prova a cooperação. O teste reconstrói a árvore `atendimento → coordenador → estoque/vendas/inteligencia` só pelas tabelas, e um agente que manda mensagem a si mesmo para no limite de profundidade.

## 8. Persistência e consultas

`src/agents/consultas.js`:
- `listarExecucoes` (filtros por agente e status; campos leves);
- `buscarExecucao` (com chamadas de tool, mensagens enviadas e recebidas, filhas, ações e recomendações);
- `listarRecomendacoes`.

Nos testes, `helpers/db.js` limpa também as tabelas SMA antes de cada teste.

## 9. Tools

Em `src/agents/tools/`, cada tool é **um adaptador fino sobre services**: nunca controllers e nunca Prisma, o que é verificado estaticamente.

**Validação: Zod 4.6.5** (dependência nova, sem dependências transitivas). Justificativa:
- um único schema serve para validar a entrada **e** para gerar o JSON Schema exigido pelos provedores de LLM (`z.toJSONSchema`, nativo na v4);
- todas as entradas são `.strict()` (o LLM não manda campos arbitrários) e vão para o provedor com `additionalProperties: false`.

**Resultado padronizado.** Erros previstos **não lançam**: voltam como dado, para que o LLM possa corrigir a chamada.

```text
{ ok: true, dados } | { ok: false, erro: { codigo, mensagem, detalhes? } }
codigo: ENTRADA_INVALIDA | NAO_ENCONTRADO | AMBIGUO | CONFLITO | REGRA_NEGOCIO |
        TOOL_INEXISTENTE | TOOL_NAO_PERMITIDA | ERRO_INTERNO
```

Um erro interno sai com mensagem genérica; o detalhe fica só em `ChamadaTool.erro`.

**Saída para agentes, diferente da API** (a ressalva da 0.4):
- números em vez de `Decimal` ou string monetária;
- datas de negócio em ISO com `-04:00`;
- só os campos úteis (por exemplo, o resumo de produção sem a lista bruta de registros).

| Tool | Service | Entrada |
|---|---|---|
| `consultarVendasPeriodo` | `vendasService.resumoVendasPeriodo` (novo; reaproveita `agregarTotais`) | `dataInicio`, `dataFim` (AAAA-MM-DD, início ≤ fim), `clienteId?` |
| `consultarRankingSabores` | `clientesService.obterRankingSabores` | `limite` 1–50 |
| `consultarRecebiveis` | `vendasService.obterRecebiveis` (novo) | `limite` 1–100 |
| `consultarEstoqueAcabado` | `estoqueService.obterEstoqueAcabado` | — |
| `consultarSaldoMateriasPrimas` | `estoqueService.resumoMateriasPrimas` | — |
| `consultarResumoProducao` | `producaoService.obterResumoProducao` | `mes` e `ano` juntos, ou nenhum |
| `calcularNecessidadesProducao` | `saboresService.obterReceita` + `producaoService.calcularNecessidades`/`verificarFaltantes` | `sabores` [{ saborId, quantidade > 0 }] 1–20. **Simula sem gravar** e informa os sabores sem receita (K12) |
| `consultarEstatisticasCliente` | `clientesService.obterEstatisticasCliente` | `clienteId` |
| `proporAcao` | `servicoAcoes.proporAcao` | `tipo` (allowlist), `descricao`, `payload` |

**Alteração em service** (`vendasService.js`):
- A agregação de `obterTotais` virou a função pura `agregarTotais`; **`/vendas/totais` não mudou**, e os 265 testes continuam verdes.
- Foram criadas duas consultas novas, só para as tools: `resumoVendasPeriodo` e `obterRecebiveis`.

**Não implementado** (Etapa 2+): média móvel, clientes atrasados, tendência, recomendações automáticas.

## 10. Ações propostas

A única escrita disponível ao agente é `proporAcao`, que cria uma `AcaoProposta` **`PENDENTE`** e não executa nada.

**Allowlist** (`src/agents/acoes/contratos.js`), sempre com ids, nunca nomes:

| Tipo | Payload (Zod, estrito) | Verificação ao propor (só leitura) |
|---|---|---|
| `REGISTRAR_VENDA` | `clienteId`, `sabores` [{ saborId, quantidade > 0 }] 1–30, `valor` > 0, `desconto?` ≥ 0, `data?` (civil, sem fuso), `pago?` | Cliente existe; sabores existem e **estão ativos** |
| `REGISTRAR_PRODUCAO` | `sabores`, `data?`, `observacao?` (≤ 255) | Sabores existem e estão ativos |
| `MARCAR_VENDA_PAGA` | `vendaId`, `dataPagamento?` | Venda existe e **não está paga** (409) |

Escolhas de contrato:
- **Ids, nunca nomes:** o cliente fica inequivocamente identificado. Resolver nome e desambiguar (0.6) acontece antes, com o gestor.
- **Itens com quantidade > 0** no contrato do agente: é mais estrito que o `KNOWN_BEHAVIOR` da API, que segue igual.
- **`valor`** vem do que o gestor informou (K7): o agente não calcula preço.

## 11. Executor

Em `src/agents/acoes/servicoAcoes.js`:

```text
PENDENTE ──aprovar──▶ APROVADA ──executar──▶ EXECUTANDO ──▶ EXECUTADA
   │                                              └───────▶ FALHA
   └──rejeitar──▶ REJEITADA (nunca executa)
```

- **Transições atômicas:** cada uma é um `updateMany … where status = <esperado>`. Se a contagem for 0, a resposta é 409 (ou 404 se não existir). Duas aprovações ou execuções simultâneas **nunca** passam as duas. O teste dispara 3 execuções concorrentes: 1 passa, 2 recebem 409, e só 1 venda é criada.
- **Reserva antes do service:** a ação passa a `EXECUTANDO` antes de qualquer chamada. Depois, o payload é **revalidado** e o executor chama **o service já testado**: `criarVenda` (quantidade = soma dos itens), `criarProducao` (422 se faltar insumo) ou `atualizarPagamento`.
- **Resultado:** `EXECUTADA` com `resultado` (por exemplo, `{ vendaId }`), ou `FALHA` com `erro` e os detalhes do domínio (por exemplo, `faltantes`).
- **Estados finais:** `EXECUTADA`, `REJEITADA` e `FALHA`. Para tentar de novo, propõe-se outra ação.
- **Fluxo HTTP explícito:** `POST /acoes/:id/aprovar` aprova e executa em seguida, na mesma requisição do gestor. **Não existe tool de aprovação ou execução.**

## 12. Adaptador LLM

Em `src/agents/llm/provedor.js`, o contrato é neutro:

```text
provedor.gerar({ sistema, mensagens, tools }) →
    { tipo: "texto", texto }  |  { tipo: "tools", chamadas: [{ id, nome, entrada }] }
mensagens: { papel: usuario | assistente | tool, ... }   tools: [{ nome, descricao, parametros }]
```

- **Ciclo de tool calling** (`cicloTools.js`): o provedor pede tools pelo nome, o runtime executa (allowlist, validação, `ChamadaTool` com origem `LLM`) e devolve o resultado como mensagem `tool`.
- **Limites:** passos (6), tempo por chamada (20 s) e validação da forma da resposta.
- **Troca de fornecedor:** os agentes usam só `contexto.raciocinar(...)`. Trocar OpenAI, Claude ou mock é trocar o objeto `provedorLLM`.
- **Sem provedor real nesta etapa:** `obterProvedorConfigurado()` devolve `null`, e uma `PERGUNTA` falha de forma explícita ("Nenhum provedor de LLM configurado"). Não há segredo no repositório, chamada externa ou custo nos testes.

## 13. Mock LLM

`criarProvedorFake(roteiro)` simula:
- texto;
- tool call;
- várias tool calls num passo;
- passo calculado a partir da requisição;
- erro;
- atraso (timeout lógico).

Ele guarda as `requisicoes` recebidas para asserções. Os testes cobrem:
- o provedor recebe **só definições**, das tools permitidas ao agente;
- o número da resposta vem da tool;
- uma tool fora da allowlist volta como `TOOL_NAO_PERMITIDA`;
- uma entrada inválida volta como erro estruturado, e o LLM a corrige;
- `proporAcao` cria `PENDENTE` sem venda;
- erro, timeout, resposta malformada, limite de passos e ausência de provedor terminam todos em `FALHA` controlada.

## 14. Coordenador

O esqueleto é **determinístico** (`agentes/coordenador.js`):
- recebe uma **intenção estruturada** (`DIAGNOSTICO_GERAL`, `DIAGNOSTICO_ESTOQUE`, `DIAGNOSTICO_VENDAS`, `DIAGNOSTICO_INTELIGENCIA`);
- delega por `enviarMensagem` aos agentes da tabela de rotas;
- agrega `{ intencao, delegadoPara, respostas, falhas, completo }`.

Uma falha parcial é registrada (a mensagem fica `FALHA`) e informada sem derrubar a execução do Coordenador. Uma intenção desconhecida faz a execução falhar sem delegar. O roteamento por LLM fica para depois.

## 15. Agentes stub

| Agente | Tools permitidas | Tipos suportados |
|---|---|---|
| `estoque` | estoque acabado, saldo de MP, necessidades, resumo de produção, `proporAcao` | `PING`, `DIAGNOSTICO` (2 tools), `PERGUNTA` (LLM) |
| `vendas` | vendas por período, recebíveis, ranking, estatísticas de cliente, `proporAcao` | idem (diagnóstico: recebíveis e ranking) |
| `inteligencia` | resumo de produção, vendas por período, estoque acabado | idem (diagnóstico: resumo de produção) |
| `atendimento` | nenhuma | `PING`, `SOLICITAR_DIAGNOSTICO` → Coordenador (porta de entrada do gestor) |
| `coordenador` | nenhuma | intenções acima |

**Nenhuma regra de domínio:** os stubs só verificam se as tools funcionam. A lógica real começa na Etapa 2.

## 16. Endpoints

Todos montados com `verificarAuth`, o login atual do gestor:

| Método e rota | Função |
|---|---|
| `GET /api/agentes` | Lista os agentes e as tools permitidas |
| `POST /api/agentes/:nome/executar` | `{ tipo, dados? }` → `{ execucaoId, agente, status, saida }` (gatilho `HTTP`) |
| `GET /api/agentes/execucoes` | Lista (filtros `agente`, `status`, `limite`) |
| `GET /api/agentes/execucoes/:id` | Detalhe com tools chamadas, mensagens, filhas, ações e recomendações |
| `GET /api/agentes/recomendacoes` | Lista (`status`, `agente`) |
| `GET /api/agentes/acoes` | Lista (`status`) |
| `POST /api/agentes/acoes/:id/aprovar` | Aprova **e executa** (executor determinístico) → ação `EXECUTADA` ou `FALHA` |
| `POST /api/agentes/acoes/:id/rejeitar` | `{ motivo? }` → `REJEITADA` |

Não há chat nesta etapa.

## 17. Segurança

- Todas as rotas exigem JWT. Os testes cobrem as 8 rotas sem token (401) e um token inválido, que não gera execução.
- Os erros saem controlados:
  - 404 (agente, execução ou ação inexistente);
  - 400 (entrada);
  - 409 (transição inválida);
  - 500 genérico `{ error, execucaoId }`.
- Há teste de **ausência de vazamento** (stack, SQL, `prisma`, connection string, segredo).
- Prompts internos não são expostos. O prompt de sistema dos stubs é mínimo e fica no código.
- Nenhum segredo novo. Sem provedor real, não há chave de LLM.
- A escrita no negócio continua possível só pelas rotas existentes ou pela aprovação de uma ação.

## 18. Testes

`tests/sma/`: **79 testes em 7 arquivos**, todos em nível A (funções reais e banco de teste) ou pela API real.

| Arquivo | Testes | Cobertura |
|---|---|---|
| `registroRuntime.test.js` | 16 | Registry (lista, busca, duplicado, inexistente, 4 contratos inválidos); runtime (sucesso persistido, falha controlada sem stack, timeout, inexistente sem registro, contexto sem Prisma e imutável, truncamento); recomendações; barramento |
| `tools.test.js` | 16 | Catálogo (só `proporAcao` escreve; JSON Schema estrito); cada tool contra o service; 4 entradas inválidas; NAO_ENCONTRADO; simulação sem gravar; allowlist e auditoria; erro interno sem vazamento; **arquitetura** (tools → services; agentes e LLM sem Prisma ou services) |
| `agentesHttp.test.js` | 15 | 8 rotas sem token; token inválido; listagem; execução e auditoria; Coordenador pela API; erros controlados sem vazamento; recomendações; aprovar, repetir (409), rejeitar e id inválido |
| `acoes.test.js` | 14 | `PENDENTE`; pela tool (agente e execução de origem); tipo fora da allowlist; 4 payloads inválidos; referências (404/409); execução de venda (quantidade derivada, data civil), produção sem insumo (`FALHA`), pagamento; rejeitada nunca executa; dupla execução sequencial e **concorrente**; id inválido |
| `llm.test.js` | 10 | Texto; tool call; várias tool calls com uma fora da allowlist; correção após erro; o LLM só propõe; erro; timeout; resposta malformada; limite de passos; sem provedor |
| `mensagens.test.js` | 4 | Persistência completa e vínculo das execuções; destino inexistente; destino que falha; limite de profundidade |
| `coordenador.test.js` | 4 | Delegação e agregação (3 mensagens, 3 filhas, 5 tools); falha parcial; intenção desconhecida; cadeia Atendimento → Coordenador → 3 agentes |

**Erros reais encontrados durante a escrita:**
- Um handler síncrono que lançava erro escapava do `Promise.allSettled` no barramento. Foi corrigido no código (`Promise.resolve().then(...)`).
- Dois erros eram meus, nos testes: um nome de agente curto demais e um teste de timeout mal escrito. Foram corrigidos antes da execução final.

## 19. Baseline antes e depois

| | Antes (0.6) | Depois (Etapa 1) |
|---|---|---|
| Testes / arquivos | 265 / 13 | **344 / 20** |
| Testes anteriores | — | **265/265 intactos**, nenhum alterado ou removido |
| `KNOWN_BEHAVIOR` | 34 | 34 (nenhum tocado) |

O `baseline.json` foi atualizado com motivo e histórico (202 → 232 → 265 → 344).

**Validação final:**

| Validação | Resultado |
|---|---|
| `npm test` com `TZ=UTC` ×3 | 344/344 em 20/20, 0 falhas, 0 pendentes nas 3 (49 s, 73 s, 39 s); na 2ª, uma queda nativa 0xC0000409 foi refeita pelo mecanismo aprovado na 0.4 |
| `npm test` com `TZ=America/Manaus` ×3 | 344/344 em 20/20, 0 falhas, 0 pendentes nas 3 (40 s, 46 s, 68 s); na 3ª, uma queda nativa refeita pelo mesmo mecanismo |
| `npm run test:guardas` | 33/33 |
| `node --check` | 99/99 arquivos (`src`, `scripts`, `prisma`, `tests`, `vitest.config.js`) |
| `prisma validate` | schema válido |
| `npm run build` (`prisma generate`, sem banco) | OK |
| Banco dev (11 tabelas de domínio) e banco restaurado da 0.2 | `CHECKSUM TABLE` idêntico ao retrato da 0.3 (as tabelas SMA são novas, os dados de domínio não mudaram); `db:dev:status` "up to date" |
| Produção | nenhuma conexão: URLs locais, sem `RAILWAY_*`, sem deploy |
| Dados reais | não lidos; na cópia restaurada só a **estrutura** (DDL) e os nomes das 3 migrations já documentados na 0.2 |

## 20. Testes de migration

Todos rodaram pelo wrapper protegido, em bancos **locais**:

| Cenário | Banco | Passos | Resultado |
|---|---|---|---|
| A. Banco novo vazio | `doces_maloca_migracao_test` (descartável) | `migrate deploy` | baseline + SMA aplicadas; 16 tabelas + `_prisma_migrations`; `migrate diff` banco × `schema.prisma`: **sem diferença** |
| A2. Idempotência | idem | `migrate deploy` de novo | "No pending migrations" |
| B. Schema atual sem histórico (como o dev) | descartável recriado | `db execute 0_baseline` → `resolve --applied 0_baseline` → `deploy` | só a SMA aplicada; sem diferença |
| C. **Simulação da produção** | descartável + `_prisma_migrations` com os 3 registros de dez/2025 (checksums fictícios) | `status` (aponta 3 migrations locais ausentes) → `resolve --applied 0_baseline` → `deploy` | SMA aplicada; **"Database schema is up to date!"**; os registros antigos podem ficar |
| D. Recriação e nova aplicação | descartável dropado e recriado | `migrate deploy` | idêntico ao A |
| E. Banco de teste existente | `doces_maloca_test` | `migrate reset` (agora a cada execução da suíte) | baseline + SMA em cerca de 6 s; as 344 execuções do gate passam por aqui |
| F. **Banco dev real** | `doces_maloca_dev` | `status` → `resolve --applied 0_baseline` → `db:dev:migrate` | SMA aplicada; "up to date"; **checksum das 11 tabelas de domínio idêntico** ao retrato da 0.3 |

O banco descartável `doces_maloca_migracao_test` (e a permissão temporária do usuário `maloca` nele) foi **removido** ao final. Nenhuma migration rodou contra a produção.

## 21. Riscos

| Risco | Situação |
|---|---|
| Ação travada em `EXECUTANDO` se o processo cair entre o service e a marcação final | Não reexecuta sozinha (seguro contra duplicata). Exige reconciliação manual, que fica para a Etapa 6 |
| `limiteMs` não cancela a operação | Ao estourar, a execução vira `FALHA`, mas a promessa do agente continua até terminar. Os agentes atuais só leem; um agente que escreve só pode propor |
| Mensagens síncronas in-process | Simples e auditáveis. Não sobrevivem a restart; volume e concorrência entre agentes serão revisitados com o cron (Etapa 1.5 da auditoria) |
| Sem provedor LLM real | Proposital nesta etapa. O adaptador real precisa traduzir o contrato neutro e ter testes com o fake + um smoke test manual |
| `replacerJsonTemporal` global | Uma chave `data` com ISO terminado em `Z` dentro do JSON de auditoria (por exemplo, `entrada` enviada pelo cliente) seria lida como horário civil na resposta. Só afeta a exibição da auditoria; os contratos de ação já recusam datas com fuso |
| Produção ainda sem as tabelas SMA | Exige o procedimento do §3 (backup, `resolve`, `deploy`) junto com um deploy coordenado futuro |
| Zod é dependência nova | 1 pacote, MIT, sem dependências; usado de forma consistente em tools e contratos |

## 22. Arquivos alterados

**Novos:**
- `backend/prisma/migrations/0_baseline/migration.sql`, `20261001120000_camada_sma/migration.sql`, `migration_lock.toml`
- `backend/src/agents/`:
  - `index.js`, `consultas.js`;
  - `runtime/{runtime,registro,util,barramento}.js`;
  - `tools/{definirTool,formato,vendas,estoqueProducao,acoes,index}.js`;
  - `acoes/{contratos,servicoAcoes}.js`;
  - `llm/{provedor,provedorFake,cicloTools}.js`;
  - `agentes/{stubs,coordenador}.js`
- `backend/src/controllers/agentesController.js`, `backend/src/routes/agentes.js`
- `backend/tests/sma/`: `helpers.js` e 7 arquivos de teste
- `docs/tcc/etapa-1-infraestrutura-multiagente.md`

**Alterados:**
- `backend/prisma/schema.prisma`: só **acréscimo** dos 5 modelos; 0 linhas removidas dos modelos de domínio.
- `backend/src/server.js`: monta `/api/agentes` com `verificarAuth`.
- `backend/src/services/vendasService.js`: `agregarTotais` (refatoração pura), `resumoVendasPeriodo`, `obterRecebiveis`.
- `backend/package.json` e `package-lock.json`: `zod` e scripts `db:*` de migrations.
- `backend/.gitignore`: versiona `prisma/migrations`.
- `backend/vitest.config.js`: inclui `tests/sma`.
- `backend/tests/caracterizacao/`: `setup/globalSetup.js` (reset por migrations), `helpers/db.js` (limpa as tabelas SMA), `baseline.json`.

**Não alterados:** frontend, n8n, controllers e rotas de domínio, os demais services, dados reais.

## 23. Preparação para a Etapa 2 (Agente de Estoque)

- O stub `estoque` vira o agente real **sem mudar a infraestrutura**: regras determinísticas de alerta escritas como funções testadas sobre as tools existentes (estoque acabado, saldo de MP, necessidades).
- `contexto.registrarRecomendacao` passa a gerar alertas, e `proporAcao` com `REGISTRAR_PRODUCAO` gera sugestões de produção para aprovação.
- O LLM só redige explicações a partir dos números das tools, via `contexto.raciocinar` com um provedor real que implementa o contrato do §12.
- Cooperação Estoque ↔ Inteligência (demanda média) por `enviarMensagem`, comprovável pelo histórico, que é a primeira cooperação demonstrável da auditoria (§17).
- Pendências que a Etapa 2 vai precisar:
  - parâmetros editáveis (estoque mínimo; aí sim `ParametroAgente` ou equivalente);
  - gatilhos por cron/evento (o barramento já existe; os services ainda não publicam);
  - a reconciliação física do estoque acabado (Opção C da 0.2) antes de alertas sobre o saldo de produto acabado.
