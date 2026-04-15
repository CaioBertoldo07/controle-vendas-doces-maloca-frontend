# Prompt para Claude Code — Estoque, Matéria-Prima, MRP e PWA

Você está trabalhando no repositório `controle-vendas-doces-maloca-frontend`, com `backend` em Node.js + Express + Prisma + MySQL e `frontend` em React + Vite.

Quero que você implemente, de ponta a ponta, as seguintes mudanças no sistema, preservando o que já funciona hoje:

## Objetivo

Adicionar controle real de estoque e matéria-prima ao sistema, com consumo automático por produção, saldo de estoque de produto acabado baseado em produção menos vendas, e mover a ação de instalar o app para uma opção discreta em vez de um banner central intrusivo.

## Contexto atual do repositório

Estado atual já verificado:

- O backend hoje possui os modelos `Custo`, `Producao`, `ProducaoSabor`, `Venda`, `VendaSabor`, `Sabor`, `Cliente`, `Usuario` em `backend/prisma/schema.prisma`.
- Não existe modelo de `MatériaPrima`, receita/BOM/ficha técnica, movimentação de estoque ou saldo persistido de insumos.
- O estoque de produto acabado hoje é apenas um resumo derivado em `backend/src/controllers/producaoController.js`, sem entidade própria e sem baixa de matéria-prima.
- O cadastro de custos usa texto livre para nome do item em `backend/src/controllers/custosController.js` e `frontend/src/components/Custos.jsx`.
- O cadastro de produção registra somente quantidade produzida por sabor em `backend/src/controllers/producaoController.js` e `frontend/src/components/Producao.jsx`.
- O cadastro de vendas registra e baixa apenas vendas, sem validação de estoque disponível.
- O frontend usa abas em `frontend/src/pages/Dashboard.jsx`.
- O botão de instalar o app hoje aparece como um card fixo/flutuante em `frontend/src/components/PWABanner.jsx` e `frontend/src/components/PWABanner.css`, renderizado globalmente em `frontend/src/App.jsx`.

## Requisitos funcionais

Implementar tudo abaixo:

1. Criar uma aba `Estoque` para mostrar estoque de produto acabado.
2. O estoque de produto acabado deve ser calculado como `produção acumulada - vendas acumuladas`, por sabor e também no total.
3. Criar uma aba `Matéria-Prima` para mostrar os insumos com saldo atual.
4. Implementar MRP/ficha técnica para consumir matéria-prima quando houver produção.
5. Quando cadastrar custo de matéria-prima, essa entrada deve somar automaticamente no estoque de matéria-prima.
6. Quando cadastrar produção, o sistema deve consumir automaticamente a matéria-prima necessária.
7. Exemplo obrigatório de regra de produção: `1kg de coco + 1kg de açúcar + 395g de leite condensado = 22 cocadas`.
8. O botão de instalar o app não deve mais aparecer como banner no meio do sistema; ele deve virar uma opção discreta de interface.

## Requisitos de modelagem e arquitetura

Não faça gambiarra baseada apenas em textos livres. Para o MRP funcionar de forma confiável, implemente uma modelagem explícita.

### 1. Cadastro de matéria-prima

Crie entidade própria para matéria-prima, com pelo menos:

- `id`
- `nome`
- `unidadeBase`
- `ativo`
- timestamps se fizer sentido no padrão do projeto

Sugestão de unidades base:

- peso: `g`
- volume: `ml`
- contagem: `un`

Se o usuário informar compra em `kg` ou `L`, converta para a unidade base antes de salvar a movimentação. Isso é obrigatório para evitar erro em receitas como `1kg` e `395g`.

### 2. Receita / ficha técnica por sabor

Cada sabor precisa permitir configurar receita com rendimento base. Exemplo:

- sabor `Tradicional`
- rendimentoBase: `22` cocadas
- ingredientes:
  - coco: `1000 g`
  - açúcar: `1000 g`
  - leite condensado: `395 g`

Com isso, se o usuário registrar produção de `44` cocadas, o consumo deve ser o dobro da receita base.

Modele isso com tabelas explícitas, algo como:

- receita por sabor
- itens da receita com `materiaPrimaId`, `quantidadeBase`, `unidadeBase`

Se preferir simplificar o schema, pode vincular os itens de receita diretamente ao `Sabor`, desde que exista:

- rendimento base por sabor
- lista de insumos por sabor
- quantidade por insumo

### 3. Movimentação de matéria-prima

Implemente controle por movimentação, não apenas por campo de saldo solto. Preciso de rastreabilidade.

Crie uma tabela de movimentações de matéria-prima com pelo menos:

- `id`
- `materiaPrimaId`
- `tipo` (`ENTRADA`, `SAIDA`, `AJUSTE`)
- `origem` (`CUSTO`, `PRODUCAO`, `MANUAL` se necessário)
- `quantidade`
- `data`
- referências opcionais para `custoId` e `producaoId`
- `observacao`

O saldo da aba `Matéria-Prima` deve vir da soma dessas movimentações.

### 4. Estoque de produto acabado

Para produto acabado, o saldo pode ser calculado de forma derivada a partir de produção e vendas, sem necessidade de nova tabela, desde que:

- exista endpoint próprio para consulta de estoque
- a regra esteja centralizada no backend
- a UI mostre saldo por sabor e total

## Regras de negócio obrigatórias

1. Ao criar custo com categoria `Matéria Prima`, o sistema deve:
   - exigir ou permitir mapear esse custo a uma matéria-prima cadastrada
   - gerar movimentação de entrada no estoque de matéria-prima

2. Ao editar ou excluir um custo de matéria-prima, o estoque deve permanecer consistente.
   - pode recalcular por movimentação vinculada
   - ou apagar/recriar a movimentação correspondente

3. Ao criar produção, o sistema deve:
   - validar os sabores informados
   - calcular a necessidade de matéria-prima com base na receita de cada sabor
   - verificar saldo suficiente de insumos antes de salvar
   - bloquear a operação se faltar insumo, retornando mensagem clara com os faltantes
   - gerar saídas no estoque de matéria-prima dentro da mesma transação

4. Ao editar ou excluir uma produção, o estoque de matéria-prima deve continuar consistente.
   - reverta ou refaça as movimentações associadas à produção

5. O estoque da aba `Estoque` deve mostrar claramente:
   - produzido por sabor
   - vendido por sabor
   - saldo por sabor
   - saldo total

6. Se for viável sem complicar demais, valide também venda contra estoque disponível de produto acabado.
   - se isso exigir muito retrabalho, pelo menos mantenha o saldo correto e documente a limitação

## Mudanças esperadas no backend

Implemente o necessário no backend, incluindo:

- atualização do `backend/prisma/schema.prisma`
- migration Prisma
- novos controllers/routes/services para matéria-prima, receita e estoque, se necessário
- ajustes em `backend/src/controllers/custosController.js`
- ajustes em `backend/src/controllers/producaoController.js`
- possível ajuste em `backend/src/controllers/vendasController.js`
- registro das novas rotas em `backend/src/server.js`

Endpoints esperados, ou equivalentes bem nomeados:

- `GET /api/materias-primas`
- `POST /api/materias-primas`
- `PUT /api/materias-primas/:id`
- `GET /api/materias-primas/resumo` ou equivalente
- `GET /api/estoque`
- `GET /api/estoque/materias-primas` se preferir separar
- endpoints para salvar/editar receita por sabor

Se você achar melhor, pode reaproveitar a aba `Sabores` para editar a receita/ficha técnica de cada sabor.

## Mudanças esperadas no frontend

Implemente o necessário no frontend, incluindo:

- adicionar aba `Estoque`
- adicionar aba `Matéria-Prima`
- adaptar `Custos.jsx` para, quando a categoria for `Matéria Prima`, permitir selecionar ou cadastrar a matéria-prima associada
- adaptar `Producao.jsx` para exibir erro amigável se faltar insumo
- adicionar consumo previsto no modal de produção, se ficar simples e bom de usar
- adaptar `GerenciarSabores.jsx` para configurar receita/rendimento por sabor, ou criar componente próprio para isso
- criar chamadas na API em `frontend/src/services/api.js`

Na UX:

- a aba `Estoque` deve ser operacional, não apenas decorativa
- a aba `Matéria-Prima` deve mostrar saldo, unidade, e idealmente alertas de saldo baixo ou negativo
- preserve a linguagem visual já existente do sistema

## Mudança obrigatória no PWA

O banner de instalação atual não deve mais aparecer como card fixo no meio do sistema.

Troque isso por uma opção discreta. Sugestão preferencial:

- exibir `Instalar app` como botão secundário pequeno no cabeçalho, perto do usuário/tema/logout, apenas quando `isInstallable && !isInstalled`

Requisitos do novo comportamento:

- não usar card flutuante centralizado
- não atrapalhar navegação nem leitura do conteúdo
- manter funcionamento do `beforeinstallprompt`
- manter barras de `offline` e `nova versão disponível`, se já estiverem funcionando bem

## Plano de execução

Execute nesta ordem:

1. Analisar o schema atual e criar a nova modelagem de matéria-prima, receita e movimentação.
2. Criar migration Prisma e ajustar serviços/controladores do backend.
3. Garantir transações em custo e produção para não deixar estoque inconsistente.
4. Criar endpoints para consultar estoque de produto acabado e matéria-prima.
5. Adaptar o frontend para as novas abas e novos formulários.
6. Mover a ação de instalação do app para uma opção discreta no cabeçalho ou equivalente.
7. Validar os fluxos completos.

## Critérios de aceite

Só considere concluído se tudo abaixo estiver atendido:

1. Existe uma aba `Estoque` mostrando saldo de produto acabado por sabor e no total.
2. Existe uma aba `Matéria-Prima` mostrando saldo atual por insumo.
3. Cadastrar um custo de matéria-prima aumenta o saldo do insumo correspondente.
4. Cadastrar uma produção consome automaticamente os insumos da receita.
5. Se faltar insumo, a produção é bloqueada com mensagem clara.
6. A receita com `1kg coco + 1kg açúcar + 395g leite condensado = 22 cocadas` funciona corretamente com conversão de unidade.
7. Edição e exclusão de custo e produção não deixam o estoque inconsistente.
8. O botão de instalar app virou opção discreta e não aparece mais como banner central intrusivo.
9. O projeto continua compilando e as funcionalidades existentes principais continuam funcionando.

## Validação que quero que você rode

Depois de implementar:

1. Rode as migrations do Prisma.
2. Suba backend e frontend localmente.
3. Teste manualmente o seguinte cenário:
   - cadastrar matérias-primas `coco`, `açúcar`, `leite condensado`
   - registrar entradas equivalentes a `1000g`, `1000g` e `395g`
   - configurar receita de um sabor para rendimento de `22` cocadas
   - registrar produção de `22`
   - confirmar que os três insumos zeram ou reduzem corretamente
   - confirmar que a aba `Estoque` mostra aumento de produto acabado
   - registrar venda e confirmar redução no saldo de estoque acabado
4. Rodar build do frontend.
5. Corrigir eventuais erros de lint ou runtime introduzidos pelas mudanças.

## Restrições importantes

- Não faça refatoração ampla fora do escopo.
- Preserve o estilo atual do projeto.
- Mantenha a solução simples, mas correta.
- Prefira corrigir na raiz do problema, não com remendos em tela.
- Use transações Prisma nas operações que mexem com estoque.
- Se precisar criar componentes novos no frontend, mantenha-os pequenos e objetivos.
- Se houver ambiguidade de naming, use português consistente com o restante do sistema.

## Entrega esperada

Ao final, além do código, me entregue um resumo curto com:

- o que foi alterado
- quais arquivos principais mudaram
- quais decisões de modelagem foram tomadas
- quais limitações ou próximos passos ainda ficaram em aberto
