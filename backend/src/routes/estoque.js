import express from "express";
import {
  listarAjustes,
  listarEstoque,
  registrarAjuste,
} from "../controllers/estoqueController.js";

const router = express.Router();

router.get("/", listarEstoque);

// Ajustes de estoque por contagem física (somente criação: histórico auditável)
router.get("/ajustes", listarAjustes);
router.post("/ajustes", registrarAjuste);

export default router;
