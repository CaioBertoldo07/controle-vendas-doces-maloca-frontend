import express from "express";
import * as custosController from "../controllers/custosController.js"

const router = express.Router();

router.get("/resumo", custosController.resumoCustos);
router.get("/", custosController.listarCustos);
router.post("/", custosController.criarCusto);
router.put("/:id", custosController.atualizarCusto);
router.delete("/:id", custosController.deletarCusto);

export default router;
