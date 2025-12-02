// Script para testar todas as rotas da API
// Execute com: node tests/api.test.js

const BASE_URL = "http://localhost:3000/api";

const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

async function testEndpoint(method, url, body = null) {
  try {
    const options = {
      method,
      headers: { "Content-Type": "application/json" },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    const status = response.ok ? "PASSOU" : "FALHOU";
    const color = response.ok ? colors.green : colors.red;

    console.log(
      `${color}[${status}]${colors.reset} ${method} ${url} - Status: ${response.status}`
    );

    if (!response.ok) {
      console.log(`  Erro: ${JSON.stringify(data)}`);
    }

    return { ok: response.ok, data };
  } catch (error) {
    console.log(`${colors.red}[ERRO]${colors.reset} ${method} ${url}`);
    console.log(`  ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function runTests() {
  console.log(
    `\n${colors.yellow}🧪 Iniciando testes da API...${colors.reset}\n`
  );

  let clienteId;
  let vendaId;

  // ===== TESTE: RAIZ =====
  console.log(`\n${colors.yellow}📍 Testando raiz da API${colors.reset}`);
  await testEndpoint("GET", "http://localhost:3000/");

  // ===== TESTES: CLIENTES =====
  console.log(
    `\n${colors.yellow}👥 Testando endpoints de CLIENTES${colors.reset}`
  );

  // Criar cliente
  const novoCliente = await testEndpoint("POST", `${BASE_URL}/clientes`, {
    nome: "Cliente Teste",
  });
  if (novoCliente.ok) {
    clienteId = novoCliente.data.id;
  }

  // Listar clientes
  await testEndpoint("GET", `${BASE_URL}/clientes`);

  // Buscar cliente específico
  if (clienteId) {
    await testEndpoint("GET", `${BASE_URL}/clientes/${clienteId}`);
  }

  // Atualizar cliente
  if (clienteId) {
    await testEndpoint("PUT", `${BASE_URL}/clientes/${clienteId}`, {
      nome: "Cliente Teste Atualizado",
    });
  }

  // ===== TESTES: VENDAS =====
  console.log(
    `\n${colors.yellow}💰 Testando endpoints de VENDAS${colors.reset}`
  );

  // Criar venda
  if (clienteId) {
    const novaVenda = await testEndpoint("POST", `${BASE_URL}/vendas`, {
      clienteId,
      quantidade: 10,
    });
    if (novaVenda.ok) {
      vendaId = novaVenda.data.id;
    }
  }

  // Listar vendas
  await testEndpoint("GET", `${BASE_URL}/vendas`);

  // Buscar venda específica
  if (vendaId) {
    await testEndpoint("GET", `${BASE_URL}/vendas/${vendaId}`);
  }

  // Atualizar venda
  if (vendaId) {
    await testEndpoint("PUT", `${BASE_URL}/vendas/${vendaId}`, {
      quantidade: 15,
    });
  }

  // Obter totais
  await testEndpoint("GET", `${BASE_URL}/vendas/totais`);

  // Relatório mensal
  await testEndpoint("GET", `${BASE_URL}/vendas/relatorio-mensal?ano=2025`);

  // Estatísticas do cliente
  if (clienteId) {
    await testEndpoint("GET", `${BASE_URL}/clientes/${clienteId}/estatisticas`);
  }

  // ===== TESTES DE VALIDAÇÃO =====
  console.log(`\n${colors.yellow}🔒 Testando validações${colors.reset}`);

  // Cliente sem nome
  await testEndpoint("POST", `${BASE_URL}/clientes`, { nome: "" });

  // Venda sem quantidade
  if (clienteId) {
    await testEndpoint("POST", `${BASE_URL}/vendas`, { clienteId });
  }

  // Quantidade negativa
  if (clienteId) {
    await testEndpoint("POST", `${BASE_URL}/vendas`, {
      clienteId,
      quantidade: -5,
    });
  }

  // ===== LIMPEZA =====
  console.log(`\n${colors.yellow}🧹 Limpando dados de teste${colors.reset}`);

  // Deletar venda
  if (vendaId) {
    await testEndpoint("DELETE", `${BASE_URL}/vendas/${vendaId}`);
  }

  // Deletar cliente
  if (clienteId) {
    await testEndpoint("DELETE", `${BASE_URL}/clientes/${clienteId}`);
  }

  console.log(`\n${colors.green}✅ Testes concluídos!${colors.reset}\n`);
}

// Executar testes
runTests();
