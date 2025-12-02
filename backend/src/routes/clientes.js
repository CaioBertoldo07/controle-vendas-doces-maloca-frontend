import express from "express";
import * as clientesController from "../controllers/clientesController.js";
import { validateCliente } from "../middlewares/validations.js";

const router = express.Router();

// GET /api/clientes - Listar todos os clientes
router.get("/", clientesController.listarClientes);

// GET /api/clientes/ranking-sabores - Ranking geral de sabores por cliente
router.get("/ranking-sabores", clientesController.rankingSaboresGeral);

// GET /api/clientes/:id - Buscar cliente específico
router.get("/:id", clientesController.buscarCliente);

// GET /api/clientes/:id/sabores - Sabores por cliente
router.get("/:id/sabores", clientesController.saboresPorCliente);

// GET /api/clientes/:id/estatisticas - Estatísticas do cliente
router.get("/:id/estatisticas", clientesController.estatisticasCliente);

// POST /api/clientes - Criar novo cliente
router.post("/", validateCliente, clientesController.criarCliente);

// PUT /api/clientes/:id - Atualizar cliente
router.put("/:id", validateCliente, clientesController.atualizarCliente);

// DELETE /api/clientes/:id - Deletar cliente
router.delete("/:id", clientesController.deletarCliente);

export default router;
