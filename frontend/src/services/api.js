import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  console.log("📤 Request:", config.method.toUpperCase(), config.url);
  return config;
});

api.interceptors.response.use(
  (response) => {
    console.log("📥 Response:", response.config.url, response.status);
    return response;
  },
  (error) => {
    console.error(
      "❌ Erro na resposta:",
      error.response?.status,
      error.response?.data,
    );
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export const authAPI = {
  login: (email, senha) => api.post("/auth/login", { email, senha }),
  registro: (nome, email, senha) =>
    api.post("/auth/registro", { nome, email, senha }),
  verificar: () => api.get("/auth/verificar"),
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
  listar: (todos = false) =>
    api.get("/sabores", { params: todos ? { todos: true } : {} }),
  buscar: (id) => api.get(`/sabores/${id}`),
  criar: (nome, precoUnitario) => api.post("/sabores", { nome, precoUnitario }),
  atualizar: (id, dados) => api.put(`/sabores/${id}`, dados),
  deletar: (id) => api.delete(`/sabores/${id}`),
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

export const custosAPI = {
  listar: (params) => api.get("/custos", { params }),
  criar: (dados) => api.post("/custos", dados),
  atualizar: (id, dados) => api.put(`/custos/${id}`, dados),
  deletar: (id) => api.delete(`/custos/${id}`),
  resumo: (params) => api.get("/custos/resumo", { params }),
};

export const producaoAPI = {
  listar: (params) => api.get("/producao", { params }),
  criar: (dados) => api.post("/producao", dados),
  atualizar: (id, dados) => api.put(`/producao/${id}`, dados),
  deleter: (id) => api.delete(`/producao/${id}`),
  resumo: (params) => api.get("/producao/resumo", { params }),
};

export default api;
