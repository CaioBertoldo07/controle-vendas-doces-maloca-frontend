# 📚 Documentação da API - Doces da Maloca

Base URL: `http://localhost:3000/api`

---

## 👥 CLIENTES

### Listar todos os clientes
```
GET /clientes
```

**Resposta:**
```json
[
  {
    "id": 1,
    "nome": "Maria Silva",
    "_count": { "vendas": 5 }
  }
]
```

### Buscar cliente específico
```
GET /clientes/:id
```

### Criar novo cliente
```
POST /clientes
Content-Type: application/json

{
  "nome": "João Santos"
}
```

### Atualizar cliente
```
PUT /clientes/:id
Content-Type: application/json

{
  "nome": "João Santos Silva"
}
```

### Deletar cliente
```
DELETE /clientes/:id
```

### Estatísticas do cliente
```
GET /clientes/:id/estatisticas
```

---

## 💰 VENDAS

### Listar vendas
```
GET /vendas?mes=12&ano=2025&clienteId=1&limit=50
```

**Query Params:**
- `mes` - Mês (1-12)
- `ano` - Ano
- `clienteId` - ID do cliente
- `dataInicio` - Data inicial (YYYY-MM-DD)
- `dataFim` - Data final (YYYY-MM-DD)
- `limit` - Limite de resultados

### Criar venda
```
POST /vendas
Content-Type: application/json

{
  "clienteId": 1,
  "quantidade": 10,
  "data": "2025-12-02" (opcional)
}
```

### Atualizar venda
```
PUT /vendas/:id
Content-Type: application/json

{
  "quantidade": 15
}
```

### Deletar venda
```
DELETE /vendas/:id
```

### Obter totais
```
GET /vendas/totais?mes=12&ano=2025
```

**Resposta:**
```json
{
  "totalGeral": 150,
  "totalVendas": 10,
  "porCliente": {
    "Maria Silva": 50,
    "João Santos": 100
  },
  "porDia": {
    "01/12/2025": 30,
    "02/12/2025": 40
  },
  "media": 15
}
```

### Relatório mensal
```
GET /vendas/relatorio-mensal?ano=2025
```

**Resposta:**
```json
{
  "ano": 2025,
  "meses": [
    {
      "mes": 1,
      "nomeMes": "janeiro",
      "totalVendas": 20,
      "totalQuantidade": 200
    }
  ]
}
```

---

## ❌ Códigos de Erro

- `400` - Requisição inválida (validação falhou)
- `404` - Recurso não encontrado
- `500` - Erro interno do servidor
```

---

## 6️⃣ Melhorias no `.gitignore`

### Arquivo `backend/.gitignore`
```
node_modules/
.env
*.log
.DS_Store
prisma/migrations/*
!prisma/migrations/.gitkeep
dist/
build/