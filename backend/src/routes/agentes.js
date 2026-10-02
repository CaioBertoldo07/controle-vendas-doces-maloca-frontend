import express from "express";
import * as agentesController from "../controllers/agentesController.js";
import { exigirFlag } from "../lib/flags.js";

// Montado em server.js atrás de verificarAuth: todas exigem o login do gestor.
const router = express.Router();

// Etapa 6: flags de rollback lógico (desligar + reiniciar; nada no banco muda)
router.use(exigirFlag("smaHabilitado", "A camada de agentes está desabilitada neste ambiente."));
const assistente = exigirFlag("assistenteHabilitado", "O assistente está desabilitado neste ambiente. Os demais recursos do sistema continuam funcionando.");

router.get("/", agentesController.listarAgentes);
router.post("/chat", assistente, agentesController.conversar);
router.get("/chat/:conversaId", assistente, agentesController.buscarConversa);
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
