import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
});

// Interceptor para adicionar token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  console.log("📤 Request:", config.method.toUpperCase(), config.url);
  return config;
});

// Interceptor para tratar erros de autenticação
api.interceptors.response.use(
  (response) => {
    console.log("📥 Response:", response.config.url, response.status);
    return response;
  },
  (error) => {
    console.error(
      "❌ Erro na resposta:",
      error.response?.status,
      error.response?.data
    );

    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      // Só redireciona se não estiver na página de login
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (email, senha) => {
    console.log("🔐 API: Fazendo login");
    return api.post("/auth/login", { email, senha });
  },
  registro: (nome, email, senha) => {
    console.log("✨ API: Criando conta");
    return api.post("/auth/registro", { nome, email, senha });
  },
  verificar: () => {
    console.log("🔍 API: Verificando token");
    return api.get("/auth/verificar");
  },
};

export const clientesAPI = {
  listar: () => api.get("/clientes"),
  buscar: (id) => api.get(`/clientes/${id}`),
  criar: (nome) => api.post("/clientes", { nome }),
  atualizar: (id, nome) => api.put(`/clientes/${id}`, { nome }),
  deletar: (id) => api.delete(`/clientes/${id}`),
  estatisticas: (id) => api.get(`/clientes/${id}/estatisticas`),
  sabores: (id) => api.get(`/clientes/${id}/sabores`),
  rankingSabores: () => api.get("/clientes/ranking-sabores"),
};

export const saboresAPI = {
  listar: () => api.get("/sabores"),
};

export const vendasAPI = {
  criar: (venda) => api.post("/vendas", venda),
  listar: (params) => api.get("/vendas", { params }),
  buscar: (id) => api.get(`/vendas/${id}`),
  atualizar: (id, dados) => api.put(`/vendas/${id}`, dados),
  deletar: (id) => api.delete(`/vendas/${id}`),
  totais: (params) => api.get("/vendas/totais", { params }),
  relatorioMensal: (ano) =>
    api.get("/vendas/relatorio-mensal", { params: { ano } }),
};

export default api;
