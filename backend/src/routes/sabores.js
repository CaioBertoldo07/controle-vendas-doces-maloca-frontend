import express from "express";
import * as saboresController from "../controllers/saboresController.js";

const router = express.Router();

router.get("/", saboresController.listarSabores);
router.get("/:id", saboresController.buscarSabor);
router.post("/", saboresController.criarSabor);
router.put("/:id", saboresController.atualizarSabor);
router.delete("/:id", saboresController.deletarSabor);

export default router;
