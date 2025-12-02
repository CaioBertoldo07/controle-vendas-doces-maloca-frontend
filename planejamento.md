# 🍬 Sistema de Controle de Vendas — Doces da Maloca

Este documento apresenta todo o planejamento do sistema web que substituirá a planilha Excel utilizada atualmente no controle de vendas. Inclui visão geral, arquitetura, fluxo do sistema, modelagem do banco de dados, backend com Prisma + MySQL, frontend com React + Vite e a identidade visual da aplicação.

---

# 🧭 1. Visão Geral do Projeto

O objetivo é construir um sistema simples, intuitivo e eficiente para registrar e consultar vendas diárias do **Doces da Maloca**, eliminando o uso da planilha manual.

O sistema terá:

* Registro rápido de vendas.
* Relatórios automáticos por dia, cliente e mês.
* Dashboard com totais e gráficos.
* Banco de dados MySQL gerenciado via Prisma ORM.
* Interface moderna e elegante com tema dark.

---

# 🏗 2. Arquitetura do Sistema

A aplicação será dividida em três camadas principais:

```
/doce-maloca-system
  /backend   → Node.js + Express + Prisma + MySQL
  /frontend  → React + Vite + CSS
  /database  → MySQL (local ou hospedado)
```

### 🔌 Backend

* Node.js + Express
* Prisma ORM (conexão com MySQL)
* Rotas REST:

  * Registrar venda
  * Listar vendas
  * Listar clientes
  * Totais por mês e cliente

### 🖥 Frontend

* React + Vite
* Formulário para registrar venda
* Dashboard de relatórios e totais
* Tema dark

### 💾 Banco de Dados MySQL + Prisma

Tabelas:

* **clientes**
* **vendas**

---

# 🔄 3. Fluxo Completo do Sistema

### 1. Usuário acessa o sistema

Via navegador no celular ou computador.

### 2. Vai até "Registrar Venda"

* Seleciona o cliente
* Digita a quantidade
* Data é automática
* Envia

### 3. Backend recebe e salva

Usa Prisma para inserir a venda no MySQL.

### 4. Tela de relatórios

* Busca dados via API
* Mostra totais
* Lista de vendas
* Gráficos de barras ou pizza

---

# 🗂 4. Modelagem do Banco de Dados

### 📌 Tabela: `clientes`

| Campo | Tipo     | Descrição                |
| ----- | -------- | ------------------------ |
| id    | Int (PK) | Identificador do cliente |
| nome  | String   | Nome do cliente          |

### 📌 Tabela: `vendas`

| Campo      | Tipo     | Descrição              |
| ---------- | -------- | ---------------------- |
| id         | Int (PK) | Identificador da venda |
| clienteId  | Int (FK) | Relacionado ao cliente |
| quantidade | Int      | Quantidade vendida     |
| data       | DateTime | Data da venda          |

---

# 🧩 5. Estrutura do Backend (Node + Express + Prisma)

## 📁 Pastas

```
/backend
  /src
    /routes
    /controllers
    /services
    prisma/
    server.js
```

## 📄 Prisma Schema (exemplo)

```prisma
model Cliente {
  id    Int     @id @default(autoincrement())
  nome  String
  vendas Venda[]
}

model Venda {
  id         Int      @id @default(autoincrement())
  quantidade Int
  data       DateTime @default(now())
  clienteId  Int
  cliente    Cliente  @relation(fields: [clienteId], references: [id])
}
```

## 📌 Endpoints da API

* **POST** `/vendas`
* **GET** `/vendas?mes=12&ano=2025`
* **GET** `/clientes`
* **GET** `/totais`

---

# 🎨 6. Identidade Visual

O sistema deve seguir a estética da marca **Doces da Maloca**, que utiliza **laranja e preto** como identidade principal.

### 🎨 Paleta de Cores

| Cor            | Hex       | Uso                |
| -------------- | --------- | ------------------ |
| Laranja Maloca | `#FF7A00` | Botões e destaques |
| Preto Profundo | `#0D0D0D` | Fundo principal    |
| Preto Suave    | `#1A1A1A` | Cards e containers |
| Cinza Claro    | `#B3B3B3` | Inputs, bordas     |
| Branco         | `#FFFFFF` | Textos             |

### 🔠 Tipografia

* **Poppins** — Títulos e botões
* **Inter** — Textos e tabelas

### 🧩 Estilo da Interface

* Tema dark elegante
* Botões arredondados
* Tabelas com linhas discretas
* Cards com sombras suaves
* Dashboard moderno

---

# 🚀 7. Funcionalidades Detalhadas

## 🟧 Registrar Venda

Campos:

* Cliente (select)
* Quantidade
* Botão salvar

## 🟦 Relatórios

* Lista de vendas por data
* Filtro por mês e cliente
* Total geral
* Total por cliente
* Gráfico mensal
* Exportar CSV

## 🟪 Dashboard

* Card: Total do mês
* Card: Quantidade por cliente
* Card: Total diário

---

# 🛠 8. Setup do Projeto

## 📦 Backend

```
pm init -y
npm install express prisma @prisma/client cors
npx prisma init
```

## 📦 Frontend

```
npm create vite@latest frontend --template react
cd frontend
npm install
```

---

# 📌 9. Próximos Passos

1. Criar projeto backend com Express e Prisma
2. Criar schema do Prisma e rodar `prisma migrate`
3. Criar API de vendas e clientes
4. Criar frontend com telas de Registro e Relatórios
5. Implementar identidade visual dark
6. Testar fluxo completo

---

# 🗃 10. Fases do Desenvolvimento

## 🔹 Fase 1 — Planejamento

* Definição de requisitos
* Criação da identidade visual
* Modelagem do banco de dados
* Estruturação da arquitetura do projeto

## 🔹 Fase 2 — Configuração Inicial

* Criar projeto backend com Express
* Configurar Prisma + MySQL
* Criar tabelas e migrations
* Criar projeto frontend com React + Vite

## 🔹 Fase 3 — Implementação do Backend

* CRUD de clientes
* Endpoint de registro de vendas
* Endpoint de listagem filtrada
* Endpoint de totais e relatórios
* Testes das rotas

## 🔹 Fase 4 — Implementação do Frontend

* Tela de login (opcional)
* Tela de registrar venda
* Tela de relatórios
* Dashboard com cards e gráficos
* Conexão com backend (API)

## 🔹 Fase 5 — Estilização e Identidade Visual

* Aplicar tema dark
* Paleta laranja + preto
* Responsividade (mobile-first)
* Ajustes de UI/UX

## 🔹 Fase 6 — Testes e Ajustes

* Testar fluxo completo de vendas
* Testar filtros e totais
* Ajustes de usabilidade
* Ajustes de performance

## 🔹 Fase 7 — Deploy

* Deploy do backend (Railway, Render ou servidor próprio)
* Deploy do frontend (Vercel)
* Configuração de variáveis de ambiente
* Teste final de produção

## 🔹 Fase 8 — Expansões Futuras (opcional)

* Cadastro automático de rotas de entrega
* App mobile
* Módulo de produção (quantidade feita por dia)
* Integração com WhatsApp Business

---

# ✅ Conclusão

Este documento consolida todo o planejamento do sistema de registro e controle de vendas dos **Doces da Maloca**, trazendo clareza da arquitetura, interface, identidade visual e funcionamento geral.
