import express from "express";
import * as controller from "../controllers/materiasPrimasController.js";

const router = express.Router();

// /resumo deve vir antes de /:id para não colidir
router.get("/resumo", controller.resumoMateriasPrimas);
router.get("/", controller.listarMateriasPrimas);
router.post("/", controller.criarMateriaPrima);
router.put("/:id", controller.atualizarMateriaPrima);
router.delete("/:id", controller.deletarMateriaPrima);

export default router;
