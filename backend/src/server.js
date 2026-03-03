import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import clientesRoutes from "./routes/clientes.js";
import vendasRoutes from "./routes/vendas.js";
import saboresRoutes from "./routes/sabores.js";
import custosRoutes from "./routes/custos.js";
import producaoRoutes from "./routes/producao.js";
import { verificarAuth } from "./middlewares/auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(
  cors({
    origin: ["http://localhost:5173", "https://doces-maloca.vercel.app"],
    credentials: true,
  }),
);
app.use(express.json());

// Rotas públicas
app.use("/api/auth", authRoutes);

// Rotas protegidas
app.use("/api/clientes", verificarAuth, clientesRoutes);
app.use("/api/vendas", verificarAuth, vendasRoutes);
app.use("/api/sabores", verificarAuth, saboresRoutes);
app.use("/api/custos", verificarAuth, custosRoutes);
app.use("/api/producao", verificarAuth, producaoRoutes);

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
