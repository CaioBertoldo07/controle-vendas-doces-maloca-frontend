import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import clientesRoutes from "./routes/clientes.js";
import vendasRoutes from "./routes/vendas.js";
import saboresRoutes from "./routes/sabores.js";
import custosRoutes from "./routes/custos.js";
import producaoRoutes from "./routes/producao.js";
import materiasPrimasRoutes from "./routes/materiasPrimas.js";
import estoqueRoutes from "./routes/estoque.js";
import agentesRoutes from "./routes/agentes.js";
import healthRoutes from "./routes/health.js";
import internoRoutes from "./routes/interno.js";
import { verificarAuth } from "./middlewares/auth.js";
import { replacerJsonTemporal } from "./lib/periodos.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Datas de negócio saem com o horário de Manaus e o deslocamento real
// ("2026-03-31T23:30:00.000-04:00"), não com um "Z" falso (Etapa 0.5).
app.set("json replacer", replacerJsonTemporal);

// Middlewares
app.use(
  cors({
    // origin: ["http://localhost:5173", "https://doces-maloca.vercel.app"],
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());

// Rotas públicas
app.use("/api/auth", authRoutes);
app.use("/api/health", healthRoutes); // Etapa 6: sem segredo nem dado de negócio

// Rotas internas (Etapa 6): agendador externo, segredo próprio; inexistentes sem AGENT_SCHEDULER_ENABLED=true
app.use("/api/interno", internoRoutes);

// Rotas protegidas
app.use("/api/clientes", verificarAuth, clientesRoutes);
app.use("/api/vendas", verificarAuth, vendasRoutes);
app.use("/api/sabores", verificarAuth, saboresRoutes);
app.use("/api/custos", verificarAuth, custosRoutes);
app.use("/api/producao", verificarAuth, producaoRoutes);
app.use("/api/materias-primas", verificarAuth, materiasPrimasRoutes);
app.use("/api/estoque", verificarAuth, estoqueRoutes);
app.use("/api/agentes", verificarAuth, agentesRoutes); // camada SMA (Etapa 1)

// Rota de teste
app.get("/", (req, res) => {
  res.json({
    message: "🍬 API Doces da Maloca",
    status: "online",
    version: "3.0.0",
  });
});

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error("Erro:", err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📡 CORS habilitado para http://localhost:5173`);
});
