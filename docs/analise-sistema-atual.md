# Análise do Sistema Atual — Doces da Maloca

**Documento gerado para fins acadêmicos — Trabalho de Conclusão de Curso**
**Data de elaboração:** maio de 2026
**Repositório analisado:** `controle-vendas-doces-maloca-frontend`

---

## 1. Objetivo da Análise

Este documento tem como finalidade realizar um mapeamento técnico e funcional do sistema de gestão atualmente em uso pela microempresa Doces da Maloca. A análise busca compreender como o sistema está estruturado, quais módulos e funcionalidades estão implementados, quais processos operacionais são suportados pelo sistema e quais ainda dependem de intervenção humana.

O resultado desta análise serve como fundamento para a proposta de uma camada de automação inteligente baseada em Sistemas Multiagentes (SMA), conforme desenvolvido no TCC intitulado *"Desenvolvimento e avaliação de uma Plataforma Inteligente de Gestão para pequenos negócios baseada em sistemas multiagentes"*. A análise não propõe alterações no sistema atual, tampouco avalia aspectos de desempenho em produção. Toda a análise é derivada diretamente do código-fonte disponível no repositório.

---

## 2. Visão Geral do Sistema

O sistema de gestão Doces da Maloca é uma aplicação web destinada ao controle operacional de uma microempresa de confeitaria artesanal. Seu propósito principal é centralizar o registro e acompanhamento das atividades essenciais do negócio: vendas, produção de doces, controle de estoque, gestão de matérias-primas, custos e análise de dados de clientes.

O sistema foi desenvolvido como uma aplicação full-stack — com frontend React servido via CDN (Vercel) e backend Node.js que persiste dados em banco relacional MySQL. Adicionalmente, há uma camada de automação parcial implementada com a ferramenta n8n, integrando mensagens de WhatsApp ao registro de vendas por meio de processamento de linguagem natural.

O sistema é utilizado de forma centralizada por um único usuário autenticado (gestor), que interage com a interface para registrar e consultar todas as informações operacionais. Não há suporte multiusuário com perfis distintos ou controle de acesso por função (role-based access control).

---

## 3. Arquitetura Técnica Atual

### 3.1 Organização Geral do Projeto

O repositório está organizado como um monorepo com três diretórios principais:

```
controle-vendas-doces-maloca-frontend/
├── backend/          # API REST (Node.js + Express + Prisma)
├── frontend/         # Interface web (React + Vite)
└── n8n/              # Workflow de automação (JSON do n8n)
```

### 3.2 Camada de Backend

- **Linguagem:** JavaScript (Node.js)
- **Framework:** Express.js 4.x
- **ORM:** Prisma 5.x
- **Banco de dados:** MySQL
- **Autenticação:** JSON Web Token (JWT) com expiração de 7 dias; senhas armazenadas com hash bcrypt (10 rounds)
- **Porta padrão:** 3000

A estrutura interna do backend está organizada da seguinte forma:

```
backend/src/
├── controllers/     # Lógica de negócio por domínio
├── routes/          # Definição dos endpoints
├── middlewares/     # Autenticação JWT e autenticação por chave de API
├── services/        # Utilitários (resolução fuzzy de nomes)
└── server.js        # Ponto de entrada da aplicação
```

O banco de dados é gerenciado via `prisma db push`, o que significa que não há um sistema formal de migrations versionadas — as alterações de schema são aplicadas diretamente, com risco de perda de dados em produção (`--accept-data-loss` está presente no script de inicialização).

### 3.3 Camada de Frontend

- **Linguagem:** JavaScript (JSX)
- **Framework:** React 19
- **Bundler:** Vite 7.x
- **Roteamento:** React Router v7
- **Cliente HTTP:** Axios 1.x
- **Deploy:** Vercel (com suporte a Progressive Web App)

A estrutura interna do frontend está organizada da seguinte forma:

```
frontend/src/
├── pages/           # Páginas principais (Login, Dashboard)
├── components/      # 13 componentes de funcionalidade
├── context/         # Gerenciamento de estado global (auth, tema)
├── hooks/           # Hooks customizados (PWA)
├── services/        # Instância Axios e funções de API
└── assets/          # Recursos estáticos
```

O frontend é uma Single Page Application (SPA) com tema visual alternável (modo escuro/claro), persistido via `localStorage`. Há suporte a instalação como PWA por meio de Service Worker registrado no `public/sw.js`.

### 3.4 Camada de Automação (n8n)

Há um arquivo JSON de workflow do n8n (`n8n/doces-maloca-vendas.json`) que descreve uma pipeline de automação parcial:

1. Recebimento de mensagem via webhook (integração com WhatsApp Business API)
2. Filtragem de mensagens que contêm a palavra "venda"
3. Envio do texto para a API da OpenAI (modelo `gpt-4o-mini`) com prompt de extração de dados estruturados (nome do cliente, sabores, quantidades, valor)
4. Parse do JSON retornado pela IA
5. Envio dos dados para o endpoint `POST /api/vendas/auto` do backend com chave de API

Esta automação ainda requer configuração manual de variáveis (chave OpenAI, URL do backend) e depende de infraestrutura externa para funcionamento. O cliente deve estar previamente cadastrado no sistema para que a venda seja registrada com sucesso — o sistema não cria clientes automaticamente.

### 3.5 Comunicação Entre Camadas

- Frontend comunica-se com o backend via HTTP REST (JSON), utilizando a instância Axios configurada em `frontend/src/services/api.js`
- O token JWT é armazenado no `localStorage` do navegador e enviado no cabeçalho `Authorization: Bearer <token>` em todas as requisições autenticadas
- Interceptadores Axios tratam o status HTTP 401 realizando logout automático e redirecionamento para a página de login

---

## 4. Modelo de Dados

### 4.1 Entidades Principais

O schema do banco de dados, definido no arquivo `backend/prisma/schema.prisma`, é composto pelas seguintes entidades:

| Entidade | Descrição |
|---|---|
| `Usuario` | Usuário autenticado do sistema (gestor) |
| `Cliente` | Clientes que realizam compras |
| `Sabor` | Produtos (sabores de doce) comercializados |
| `Venda` | Registro de uma transação de venda |
| `VendaSabor` | Tabela de associação: sabores por venda (N:N) |
| `Producao` | Registro de uma sessão de produção de doces |
| `ProducaoSabor` | Tabela de associação: sabores por produção (N:N) |
| `MateriaPrima` | Insumos utilizados na fabricação |
| `ReceitaItem` | Quantidade de matéria-prima necessária por sabor (receita) |
| `MovimentacaoMateriaPrima` | Rastreamento de entradas, saídas e ajustes de insumos |
| `Custo` | Registro de despesas operacionais |

### 4.2 Atributos Relevantes por Entidade

**Usuario**
- `id`, `nome`, `email` (único), `senha` (hash bcrypt), `criadoEm`
- Sistema suporta apenas um usuário por email; não há hierarquia de papéis

**Cliente**
- `id`, `nome`, relação 1:N com `Venda`
- Validação case-insensitive de nome no controller (evita duplicatas com capitalização distinta)

**Sabor**
- `id`, `nome` (único), `precoUnitario` (Decimal 10,2), `ativo` (Boolean), `rendimentoBase` (Int, opcional)
- `ativo` implementa soft delete — sabores com vendas associadas não são deletados, apenas desativados

**Venda**
- `id`, `quantidade`, `valor` (Decimal 10,2), `desconto` (Decimal 10,2), `data`, `idempotencyKey` (único, opcional), `clienteId`
- `idempotencyKey` é utilizado pelo workflow n8n para evitar registro duplicado de vendas em caso de reenvio do webhook
- Índices definidos em `clienteId` e `data`

**VendaSabor**
- `id`, `vendaId`, `saborId`, `quantidade`
- Representa a composição de sabores de uma venda específica

**Producao / ProducaoSabor**
- Registra sessões de fabricação com data, observação e lista de sabores produzidos com suas quantidades
- A criação de produção gera automaticamente movimentações de saída de matéria-prima

**MateriaPrima**
- `id`, `nome` (único), `unidadeBase` (ex: "g", "ml", "un"), `ativo`, `criadoEm`
- Soft delete preserva o histórico de movimentações

**ReceitaItem**
- `id`, `saborId`, `materiaPrimaId`, `quantidadeBase` (Decimal 10,3)
- Representa a proporção de insumo por lote base do sabor (ex: 100g de açúcar para 50 doces)
- O campo `rendimentoBase` no `Sabor` define o tamanho do lote base

**MovimentacaoMateriaPrima**
- `id`, `materiaPrimaId`, `tipo` ("ENTRADA", "SAIDA", "AJUSTE"), `origem` ("CUSTO", "PRODUCAO"), `quantidade` (Decimal 10,3), `data`, `custoId` (FK opcional), `producaoId` (FK opcional), `observacao`
- O saldo de cada matéria-prima é calculado em tempo real somando todas as movimentações (sem coluna de saldo persistida)

**Custo**
- `id`, `nome`, `categoria` ("Matéria Prima", "Embalagem", "Equipamento", "Outros"), `quantidade`, `unidade`, `valorTotal`, `data`, `observacao`, `materiaPrimaId` (FK opcional)
- Quando associado a uma matéria-prima, cria automaticamente uma `MovimentacaoMateriaPrima` do tipo ENTRADA

### 4.3 Relações entre Entidades

```
Usuario (1) → (N) [sem relação direta com os demais domínios]
Cliente (1) → (N) Venda
Venda (1) → (N) VendaSabor → (N) Sabor
Producao (1) → (N) ProducaoSabor → (N) Sabor
Sabor (1) → (N) ReceitaItem → (N) MateriaPrima
MateriaPrima (1) → (N) MovimentacaoMateriaPrima
Custo (N) → (1) MateriaPrima [opcional]
MovimentacaoMateriaPrima → Custo [opcional]
MovimentacaoMateriaPrima → Producao [opcional]
```

### 4.4 Observações sobre o Modelo

- O saldo de matéria-prima não é persistido em coluna dedicada; é sempre recalculado via agregação das movimentações. Isso garante consistência histórica, mas pode representar uma limitação de desempenho com grande volume de dados.
- Não há entidade `Pedido` ou `OrdemDeProducao` — a produção é registrada diretamente sem etapa de planejamento intermediária.
- Não há entidade de `Fornecedor` — os custos de matéria-prima não estão vinculados a fornecedores.
- O campo `idempotencyKey` na entidade `Venda` é específico para o canal de automação (n8n/WhatsApp) e permanece nulo para vendas registradas manualmente.

---

## 5. Funcionalidades Existentes

### 5.1 Autenticação e Controle de Acesso

- Registro de usuário com e-mail e senha (hash bcrypt)
- Login com geração de token JWT (validade: 7 dias)
- Verificação automática de token ao recarregar a aplicação
- Proteção de rotas: todas as rotas da API (exceto `/auth/login` e `/auth/registro`) exigem token válido
- Logout com remoção do token do `localStorage`
- Não há suporte a múltiplos perfis de acesso (apenas um tipo de usuário)

### 5.2 Gestão de Clientes

- Cadastro, edição e exclusão de clientes
- Validação: exclusão bloqueada se o cliente possui vendas associadas
- Normalização de nomes para evitar duplicatas por capitalização
- Consulta de estatísticas individuais: total comprado, média por venda, vendas por mês
- Consulta de sabores preferidos por cliente (quantidade e percentual)
- Ranking geral: lista de clientes com sabor favorito e total consumido

### 5.3 Gestão de Sabores (Produtos)

- Cadastro, edição e desativação de sabores
- Preço unitário configurável por sabor
- Soft delete: sabores com vendas associadas são desativados, não excluídos
- Configuração de receita: definição do rendimento base (ex: 50 unidades por lote) e dos ingredientes com suas proporções

### 5.4 Registro de Vendas

- Registro manual de venda: seleção de cliente, data, sabores e quantidades
- Cálculo automático de valor bruto a partir de quantidade × preço unitário
- Campo de desconto com recálculo do valor líquido
- Opção de edição manual do valor final
- Módulo de "Venda Direta": registra vendas avulsas com preço customizável por sabor
- Registro de venda via integração n8n (WhatsApp → IA → API), com suporte a idempotência
- Edição e exclusão de vendas existentes
- Exportação de relatório em CSV

### 5.5 Controle de Produção

- Registro de sessões de produção com data, observação e sabores produzidos
- Verificação automática de disponibilidade de matéria-prima antes de confirmar a produção (baseada nas receitas cadastradas)
- Geração automática de movimentações de saída de matéria-prima ao registrar produção
- Cálculo proporcional de insumos: a quantidade necessária é calculada com base no rendimento base da receita
- Listagem com filtro por mês e ano
- Resumo mensal agregado por sabor

### 5.6 Controle de Estoque de Doces

- Exibição do saldo por sabor: quantidade produzida menos quantidade vendida
- Alertas visuais para saldo zerado ou negativo
- Totais acumulados: total produzido, total vendido, saldo geral
- Barra visual de percentual de venda por sabor
- O cálculo é feito em tempo real por agregação (sem campo persistido)

### 5.7 Controle de Matérias-Primas

- Cadastro, edição e desativação de insumos com unidade base
- Visualização do saldo atual calculado a partir das movimentações
- Alertas: saldo baixo (abaixo de 200 unidades da unidade base) e saldo negativo
- Conversão automática de unidades na exibição (ex: 1500g → "1,5 kg")
- Soft delete preserva o histórico de movimentações

### 5.8 Controle de Custos

- Registro de despesas por categoria: Matéria Prima, Embalagem, Equipamento, Outros
- Vinculação opcional com matéria-prima para gerar entrada de estoque automaticamente
- Conversão de unidades ao registrar entrada (kg → g, L → ml)
- Resumo de gastos totais e por categoria
- Filtros por mês, ano e categoria

### 5.9 Relatórios e Análise

- Dashboard principal com totais mensais e anuais, média por venda e top 5 clientes do mês
- Seletor de mês e ano no dashboard
- Gráfico de barras interativo com vendas mensais dos últimos 12 meses
- Relatório de vendas com filtros por período, cliente e tipo (direta/atacado)
- Análise de preferência de sabores por cliente (ranking e percentual)
- Totais agregados: total por cliente, por dia, média por venda

### 5.10 Progressive Web App (PWA)

- Manifest configurado com nome, ícones e modo standalone
- Service Worker para detecção de atualizações e comportamento offline
- Banner de instalação e notificação de nova versão disponível
- Detecção de estado de conexão (online/offline)

---

## 6. Fluxos Operacionais Atuais

### 6.1 Fluxo: Registro de Venda Manual

**Entrada de dados:**
O usuário acessa a aba "Registrar Venda", seleciona o cliente em um dropdown, informa a data, escolhe os sabores e suas quantidades em um grid de cards, e define o valor (calculado automaticamente ou editado manualmente).

**Processamento:**
O frontend calcula o valor bruto (soma de quantidade × preço unitário por sabor) e o valor líquido (bruto − desconto). Ao confirmar, envia `POST /api/vendas` com o objeto `{ clienteId, sabores: [{saborId, quantidade}], valor, desconto, data }`. O backend cria a `Venda` e os registros de `VendaSabor` em uma única transação.

**Saída esperada:**
Registro persistido no banco; toast de confirmação no frontend; formulário reiniciado.

**Dependências manuais:**
Seleção manual de todos os campos. O cliente deve estar previamente cadastrado. Os sabores disponíveis dependem de cadastros anteriores.

**Possíveis riscos:**
Não há validação de preço mínimo ou verificação de estoque disponível de doces antes de registrar a venda. Uma venda pode ser registrada mesmo que não haja unidades produzidas do sabor selecionado.

---

### 6.2 Fluxo: Registro de Venda via WhatsApp (n8n)

**Entrada de dados:**
Mensagem de texto enviada via WhatsApp no formato livre (ex: "Venda: João, 20 tradicional + 10 maracujá, R$ 150"). O webhook do n8n recebe a mensagem.

**Processamento:**
1. O n8n verifica se a mensagem contém a palavra "venda"
2. Envia o texto para a API da OpenAI (gpt-4o-mini) com prompt de extração estruturada
3. Parse do JSON retornado pela IA
4. Envio para `POST /api/vendas/auto` com o JSON extraído e uma `idempotencyKey` gerada pelo n8n
5. O backend resolve o nome do cliente por correspondência normalizada (fuzzy match); idem para os nomes dos sabores
6. Verifica se a `idempotencyKey` já foi processada (evita duplicidade)
7. Cria `Venda` e `VendaSabor` em transação

**Saída esperada:**
Venda registrada no banco. O n8n retorna resposta HTTP "OK" ao webhook do WhatsApp.

**Dependências manuais:**
Cliente deve estar cadastrado previamente. A resolução de nomes é aproximada — nomes muito diferentes do cadastro podem não ser encontrados e a venda será rejeitada sem notificação ao remetente.

**Possíveis riscos:**
- Falha silenciosa: o remetente não recebe confirmação ou erro
- Ambiguidade na extração: a IA pode interpretar incorretamente valores, quantidades ou nomes
- Dependência de serviço externo (OpenAI): indisponibilidade interrompe o fluxo
- Ausência de feedback ao usuário do WhatsApp sobre sucesso ou falha

---

### 6.3 Fluxo: Registro de Produção

**Entrada de dados:**
O usuário acessa a aba "Produção", abre o modal de nova produção, informa a data, uma observação opcional e as quantidades de cada sabor a produzir.

**Processamento:**
1. `POST /api/producao` é enviado com `{ data, observacao, sabores: [{saborId, quantidade}] }`
2. O backend, para cada sabor, busca a receita (`ReceitaItem`) e calcula a quantidade necessária de cada insumo: `qtd_necessaria = quantidadeBase_receita × (quantidade_solicitada / rendimentoBase)`
3. Verifica o saldo atual de cada matéria-prima somando todas as movimentações anteriores
4. Se algum insumo for insuficiente, retorna HTTP 422 com lista de faltantes
5. Se todos os insumos estiverem disponíveis, cria `Producao`, `ProducaoSabor` e uma `MovimentacaoMateriaPrima` do tipo SAIDA para cada insumo consumido

**Saída esperada:**
Produção registrada; saldos de matéria-prima atualizados; saldo de estoque de doces incrementado.

**Dependências manuais:**
A receita de cada sabor deve estar corretamente configurada. A decisão de quando e quanto produzir é inteiramente manual. O sistema não sugere quantidades nem alerta sobre demanda esperada.

**Possíveis riscos:**
Se a receita não estiver cadastrada para um sabor, a verificação de insumos não é realizada e a produção pode ser registrada sem baixa de matéria-prima, gerando inconsistência no saldo.

---

### 6.4 Fluxo: Registro de Custo e Entrada de Insumo

**Entrada de dados:**
O usuário acessa a aba "Custos", preenche o formulário com nome do gasto, categoria, quantidade, unidade, valor total e data. Opcionalmente vincula o custo a uma matéria-prima.

**Processamento:**
1. `POST /api/custos` é enviado com os dados
2. O custo é salvo no banco
3. Se `materiaPrimaId` for informado, o backend converte a unidade (kg → g, L → ml) e cria uma `MovimentacaoMateriaPrima` do tipo ENTRADA com `origem: "CUSTO"`

**Saída esperada:**
Custo registrado; saldo da matéria-prima incrementado se vinculada.

**Dependências manuais:**
Todo o preenchimento é manual. A vinculação com matéria-prima é opcional e depende do usuário reconhecer que aquele custo corresponde a uma compra de insumo.

**Possíveis riscos:**
A ausência de vinculação resulta em saldo de matéria-prima desatualizado, podendo levar a erros na verificação de disponibilidade para produção.

---

### 6.5 Fluxo: Consulta de Relatórios e Análises

**Entrada de dados:**
Seleção de filtros no frontend (período, cliente, sabor).

**Processamento:**
O frontend envia requisições GET com parâmetros de filtro. O backend executa queries com `GROUP BY` e agregações no banco MySQL via Prisma.

**Saída esperada:**
Tabelas, gráficos e totais exibidos na interface.

**Dependências manuais:**
O usuário deve interpretar os dados exibidos e tomar decisões com base neles. Não há alertas automáticos, recomendações ou análise preditiva.

---

### 6.6 Fluxo: Gerenciamento de Sabores e Receitas

**Entrada de dados:**
O usuário cadastra um sabor com nome e preço. Separadamente, acessa a configuração de receita para definir `rendimentoBase` e os ingredientes com suas quantidades base.

**Processamento:**
`PUT /api/sabores/:id/receita` apaga os itens de receita anteriores e persiste os novos.

**Saída esperada:**
Receita salva; utilizada nos cálculos de produção subsequentes.

**Dependências manuais:**
Configuração de receita é totalmente manual. Alterações na receita afetam apenas produções futuras.

---

## 7. Dependências Manuais Identificadas

A seguir, são listadas as etapas e decisões operacionais que, conforme identificado no código, dependem inteiramente de ação humana:

1. **Cadastro de clientes:** Novos clientes devem ser cadastrados manualmente pelo gestor antes de serem utilizados em vendas, inclusive no canal WhatsApp.

2. **Cadastro e precificação de sabores:** A criação de novos sabores, a definição de preços e a configuração de receitas dependem de entrada manual pelo gestor.

3. **Cadastro de matérias-primas:** Os insumos utilizados na produção precisam ser cadastrados manualmente, incluindo a unidade de medida.

4. **Decisão de quando produzir:** O sistema não gera ordens de produção automáticas. O gestor decide quando registrar uma produção e em que quantidade, com base em sua própria avaliação do estoque e da demanda.

5. **Registro de compras de insumos:** A entrada de matéria-prima no estoque ocorre apenas quando o gestor registra um custo vinculado a uma matéria-prima. A vinculação é opcional e manual.

6. **Reajuste de preços:** Alterações nos preços dos sabores são feitas manualmente e não retroagem para vendas anteriores.

7. **Interpretação de relatórios:** Todos os relatórios e análises são apresentados como dados brutos ou gráficos. Cabe ao gestor interpretar as informações e tomar decisões estratégicas.

8. **Exportação de dados:** A geração de relatório CSV é manual, iniciada pelo gestor mediante clique em botão.

9. **Ajustes de saldo de insumos:** Não há funcionalidade de ajuste direto de movimentação (tipo "AJUSTE" está definido no schema mas não é utilizado pela interface). Inconsistências no saldo precisam ser corrigidas por workarounds manuais (ex: registrar um custo artificial).

10. **Monitoramento de estoque:** Alertas visuais de saldo baixo ou negativo estão presentes na interface, mas o gestor precisa acessar a tela ativamente para visualizá-los. Não há notificações proativas.

---

## 8. Limitações do Sistema Atual

### 8.1 Limitações Funcionais

- **Ausência de alertas proativos:** O sistema não notifica o gestor sobre situações críticas (ex: saldo de insumo zerado, estoque de doces negativo, período sem vendas). A detecção depende de acesso ativo às telas correspondentes.

- **Ausência de análise preditiva:** Não há funcionalidade de previsão de demanda, sugestão de quantidade a produzir ou indicadores de tendência.

- **Sem sugestões ou recomendações:** O sistema não orienta o gestor sobre quais sabores têm maior giro, qual a margem de contribuição por produto, ou quando seria necessário reabastecer insumos.

- **Venda sem verificação de estoque disponível:** É possível registrar uma venda de um sabor mesmo que não haja unidades produzidas disponíveis, pois o sistema não valida o saldo de estoque de doces no momento do registro da venda.

- **Sem controle de fornecedores:** Não há entidade para fornecedores, impedindo rastreabilidade de compras ou comparação de preços entre fornecedores.

- **Sem módulo financeiro:** Não há cálculo de margem de lucro, DRE (Demonstração de Resultado), ou fluxo de caixa. Os custos são registrados, mas não comparados automaticamente com as receitas.

- **Retorno ausente no canal WhatsApp:** O workflow n8n não envia confirmação ou mensagem de erro para o usuário do WhatsApp após o processamento da venda.

- **Usuário único:** O sistema não suporta múltiplos operadores com permissões distintas. Qualquer pessoa com acesso pode realizar qualquer operação.

### 8.2 Limitações Operacionais

- **Dependência de cadastro prévio:** O fluxo de automação via WhatsApp falha silenciosamente se o cliente ou sabor mencionado não estiver previamente cadastrado no banco.

- **Ausência de agenda ou planejamento de produção:** Não há interface para planejar produções futuras, calcular necessidade de compra de insumos com antecedência ou organizar um calendário de fabricação.

- **Ajuste manual de saldos:** A correção de inconsistências no saldo de matéria-prima não possui interface dedicada, exigindo workarounds manuais.

- **Sem histórico de auditoria:** Não há registro de quais ações foram realizadas, por quem, e em que horário (audit log). Isso dificulta a rastreabilidade de erros operacionais.

### 8.3 Limitações Técnicas

- **Ausência de rate limiting:** A API não possui controle de taxa de requisições, tornando-a vulnerável a sobrecarga por uso excessivo ou abuso.

- **Gestão de schema sem migrations formais:** O uso de `prisma db push --accept-data-loss` em produção implica risco de perda de dados em alterações de schema. Não há histórico de migrations versionadas.

- **Saldo calculado por agregação:** O saldo de matéria-prima é calculado somando todas as movimentações toda vez que é consultado. Com o crescimento do volume de dados, isso pode representar degradação de desempenho sem índices ou caches adequados.

- **Ausência de testes automatizados:** O diretório `backend/tests/` existe no repositório, mas não foram identificados arquivos de teste ativos. Não há evidência de cobertura de testes unitários ou de integração.

- **Dependência de serviços externos na automação:** O workflow n8n depende da disponibilidade da API da OpenAI. Indisponibilidade do serviço externo interrompe completamente o canal de automação.

- **Variáveis de ambiente não documentadas:** O repositório não inclui um arquivo `.env.example` documentando as variáveis necessárias para configuração do ambiente de produção.

- **Ausência de logging estruturado:** O backend utiliza `console.log` para registrar eventos, sem framework de logging com níveis, formato padronizado ou integração com ferramentas de observabilidade.

---

## 9. Oportunidades de Automação com Sistemas Multiagentes

Com base nos fluxos operacionais e limitações identificadas, são descritas a seguir as oportunidades de automação que podem ser exploradas por agentes de software especializados. Esta seção tem caráter propositivo e prospectivo — os agentes descritos não estão implementados no sistema atual.

### 9.1 Agente de Atendimento

**Onde poderia atuar:**
No canal de comunicação com clientes (WhatsApp, chat), respondendo dúvidas, confirmando pedidos e fornecendo informações sobre disponibilidade de sabores.

**Dados que precisaria consultar:**
- Endpoint `GET /api/sabores` — sabores disponíveis e preços
- Endpoint `GET /api/estoque` — saldo disponível por sabor
- Endpoint `GET /api/clientes/:id/sabores` — preferências do cliente

**Ações que poderia disparar:**
- Registro de interesse ou pedido (iniciando fluxo de venda)
- Alertar o gestor sobre consultas não respondidas ou demandas fora do catálogo

**Limitações atuais que dificultam a implementação:**
- Sem módulo de comunicação bidirecional no sistema atual
- Sem histórico de interações com clientes além das vendas registradas
- Sem endpoint para registrar intenção de compra sem confirmar venda

---

### 9.2 Agente de Vendas

**Onde poderia atuar:**
No processamento e validação de pedidos recebidos por qualquer canal, substituindo o fluxo manual de preenchimento de formulários.

**Dados que precisaria consultar:**
- `GET /api/clientes` — verificar existência do cliente
- `GET /api/sabores` — verificar disponibilidade e preço
- `GET /api/estoque` — verificar saldo antes de confirmar

**Ações que poderia disparar:**
- `POST /api/vendas` — registrar venda confirmada
- `POST /api/clientes` — criar cliente automaticamente se não existir (atualmente rejeitado pelo sistema)
- Notificar o gestor sobre pedidos que excedam o estoque disponível

**Limitações atuais que dificultam a implementação:**
- O endpoint `/api/vendas/auto` não cria clientes automaticamente — seria necessário criar esse fluxo
- Não há validação de saldo de doces disponível no momento do registro da venda
- Sem mecanismo de confirmação/cancelamento de pedido antes do registro definitivo

---

### 9.3 Agente de Estoque

**Onde poderia atuar:**
No monitoramento contínuo dos saldos de matérias-primas e de doces produzidos, gerando alertas e sugestões de reposição.

**Dados que precisaria consultar:**
- `GET /api/materias-primas/resumo` — saldos atuais e alertas de nível baixo ou negativo
- `GET /api/estoque` — saldo por sabor (produzido − vendido)
- `GET /api/producao/resumo` — histórico de produção por período
- `GET /api/vendas` — histórico de vendas por período

**Ações que poderia disparar:**
- Emitir alertas (notificação push, e-mail, mensagem) quando saldo de insumo cair abaixo de limiar configurável
- Sugerir quantidade a produzir com base na média histórica de vendas
- Sugerir reposição de insumos com antecedência, com base no histórico de consumo

**Limitações atuais que dificultam a implementação:**
- Limiar de alerta é fixo (200 unidades da unidade base), sem configuração por insumo
- Não há canal de notificação proativa no sistema atual
- Não há dados históricos de prazo de reposição ou fornecedores para calcular lead time

---

### 9.4 Agente de Análise de Dados

**Onde poderia atuar:**
Na consolidação periódica de indicadores operacionais e financeiros, gerando relatórios e recomendações para o gestor.

**Dados que precisaria consultar:**
- `GET /api/vendas/relatorio-mensal` — evolução de vendas mensais
- `GET /api/vendas/totais` — totais por cliente e por dia
- `GET /api/clientes/ranking-sabores` — preferências de sabores por cliente
- `GET /api/custos/resumo` — gastos por categoria
- `GET /api/producao/resumo` — volume produzido

**Indicadores que poderia calcular:**
- Margem bruta estimada por sabor (receita de vendas − custo de insumos)
- Taxa de giro por sabor (quantidade vendida / quantidade produzida)
- Ticket médio por cliente e evolução temporal
- Comparativo de receita versus custo por período
- Identificação de sabores com baixa rotatividade

**Limitações atuais que dificultam a implementação:**
- Não há endpoint que cruze receita de vendas com custo de insumos por sabor
- Custos operacionais (embalagem, equipamento) não estão associados a sabores específicos, dificultando cálculo de margem por produto
- Não há entidade de meta ou orçamento para comparação com resultados reais

---

## 10. Síntese da Análise

O sistema de gestão atual do Doces da Maloca representa uma base funcional bem estruturada para as operações essenciais de uma microempresa de confeitaria. O modelo de dados é normalizado e cobre os domínios principais do negócio: vendas, clientes, produtos, produção, insumos, custos e estoque. A separação entre backend REST e frontend SPA favorece a manutenibilidade e a possibilidade de extensão da API para novos consumidores, incluindo agentes automatizados.

A presença do workflow n8n demonstra que a equipe desenvolvedora já identificou a necessidade de automação no processo de registro de vendas e realizou uma implementação parcial nesse sentido. Contudo, essa automação é frágil — depende de serviço externo, não oferece feedback ao usuário e falha silenciosamente em casos não cobertos. Isso evidencia que a automação via agentes ainda está em estágio embrionário e limitado a um único canal e fluxo específico.

As limitações identificadas — ausência de alertas proativos, ausência de análise preditiva, dependência de entrada manual em etapas críticas e ausência de canal de comunicação retornável — demonstram que há espaço significativo para a integração de uma camada multiagente. Essa camada poderia operar sobre a API REST existente, sem necessidade de refatoração profunda do backend, monitorando dados em tempo real, gerando alertas, processando pedidos e consolidando indicadores de forma autônoma.

A proposta do TCC — desenvolver e avaliar uma plataforma inteligente de gestão baseada em Sistemas Multiagentes — encontra, portanto, uma justificativa técnica e operacional clara no diagnóstico do sistema atual: o sistema existe, funciona, possui dados estruturados, mas ainda depende intensamente de intervenção humana para tarefas que poderiam ser automatizadas ou assistidas por agentes especializados.

---

## 11. Evidências Analisadas no Repositório

A seguir, são listados os principais arquivos, pastas e artefatos consultados durante a elaboração desta análise:

**Schema e banco de dados:**
- `backend/prisma/schema.prisma` — definição completa das entidades e relações

**Configuração do backend:**
- `backend/package.json` — dependências e scripts
- `backend/src/server.js` — configuração do servidor Express e registro de rotas

**Middlewares:**
- `backend/src/middlewares/auth.js` — autenticação JWT
- `backend/src/middlewares/apiKeyAuth.js` — autenticação por chave de API (n8n)
- `backend/src/middlewares/validations.js` — validações de entrada

**Controllers (lógica de negócio):**
- `backend/src/controllers/authController.js`
- `backend/src/controllers/clientesController.js`
- `backend/src/controllers/vendasController.js`
- `backend/src/controllers/saboresController.js`
- `backend/src/controllers/producaoController.js`
- `backend/src/controllers/custosController.js`
- `backend/src/controllers/materiasPrimasController.js`
- `backend/src/controllers/estoqueController.js`

**Serviços:**
- `backend/src/services/resolverNomes.js` — resolução fuzzy de nomes de clientes e sabores

**Rotas:**
- `backend/src/routes/` — arquivos de definição de endpoints por domínio

**Frontend — Configuração e serviços:**
- `frontend/package.json`
- `frontend/vite.config.js`
- `frontend/src/services/api.js` — instância Axios e funções de API
- `frontend/src/App.jsx` — roteamento principal e proteção de rotas

**Frontend — Contextos:**
- `frontend/src/context/AuthContext.jsx`
- `frontend/src/context/ThemeContext.jsx`

**Frontend — Hooks:**
- `frontend/src/hooks/usePWA.js`

**Frontend — Páginas:**
- `frontend/src/pages/Login.jsx`
- `frontend/src/pages/Dashboard.jsx`

**Frontend — Componentes:**
- `frontend/src/components/Dashboard.jsx`
- `frontend/src/components/RegistrarVenda.jsx`
- `frontend/src/components/VendaDireta.jsx`
- `frontend/src/components/Relatorios.jsx`
- `frontend/src/components/GerenciarClientes.jsx`
- `frontend/src/components/GerenciarSabores.jsx`
- `frontend/src/components/AnaliseSabores.jsx`
- `frontend/src/components/Producao.jsx`
- `frontend/src/components/Custos.jsx`
- `frontend/src/components/MateriaPrima.jsx`
- `frontend/src/components/Estoque.jsx`
- `frontend/src/components/PWABanner.jsx`
- `frontend/src/components/ThemeToggle.jsx`

**PWA:**
- `frontend/public/manifest.json`
- `frontend/public/sw.js`

**Automação:**
- `n8n/doces-maloca-vendas.json` — definição do workflow de integração WhatsApp

**Documentação e planejamento:**
- `README.md`
- `planejamento.md`
- `prompt-claude-code-estoque-mrp.md`

---

*Documento elaborado com base exclusivamente no código-fonte disponível no repositório. Informações não identificadas no código foram omitidas ou indicadas como "não identificadas no código". Este documento não substitui validação com o gestor do negócio para confirmação de regras de negócio implícitas.*
