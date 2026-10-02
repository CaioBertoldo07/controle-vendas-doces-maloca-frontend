import express from "express";
import * as agentesController from "../controllers/agentesController.js";

// Montado em server.js atrás de verificarAuth: todas exigem o login do gestor.
const router = express.Router();

router.get("/", agentesController.listarAgentes);
router.get("/execucoes", agentesController.listarExecucoes);
router.get("/execucoes/:id", agentesController.buscarExecucao);
router.get("/recomendacoes", agentesController.listarRecomendacoes);
router.post("/recomendacoes/:id/resolver", agentesController.resolverRecomendacao);
router.post("/recomendacoes/:id/ignorar", agentesController.ignorarRecomendacao);
router.get("/acoes", agentesController.listarAcoes);
router.post("/acoes/:id/aprovar", agentesController.aprovarAcao);
router.post("/acoes/:id/rejeitar", agentesController.rejeitarAcao);
router.post("/:nome/executar", agentesController.executarAgente);

export default router;
