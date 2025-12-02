import express from "express";
import * as vendasController from "../controllers/vendasController.js";
import { validateVenda } from "../middlewares/validations.js";

const router = express.Router();

// GET /api/vendas/totais - Obter totais e estatísticas
router.get("/totais", vendasController.obterTotais);

// GET /api/vendas/relatorio-mensal - Relatório mensal
router.get("/relatorio-mensal", vendasController.relatorioMensal);

// GET /api/vendas - Listar vendas com filtros
router.get("/", vendasController.listarVendas);

// GET /api/vendas/:id - Buscar venda específica
router.get("/:id", vendasController.buscarVenda);

// POST /api/vendas - Criar nova venda
router.post("/", validateVenda, vendasController.criarVenda);

// PUT /api/vendas/:id - Atualizar venda
router.put("/:id", validateVenda, vendasController.atualizarVenda);

// DELETE /api/vendas/:id - Deletar venda
router.delete("/:id", vendasController.deletarVenda);

export default router;
