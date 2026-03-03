import express from "express";
import * as producaoController from "../controllers/producaoController.js";

const router = express.Router();

router.get("/resumo", producaoController.resumoProducao);
router.get("/", producaoController.listarProducao);
router.post("/", producaoController.criarProducao);
router.put("/:id", producaoController.atualizarProducao);
router.delete("/:id", producaoController.deletarProducao);

export default router;
