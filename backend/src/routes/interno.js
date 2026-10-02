// Rotas internas (Etapa 6): chamadas por um agendador EXTERNO, nunca pelo
// navegador. Fora do JWT do gestor; protegidas por um segredo próprio de
// automação (SMA_ROTINAS_TOKEN, cabeçalho x-rotinas-token), comparado em tempo
// constante. Sem AGENT_SCHEDULER_ENABLED=true as rotas nem existem (404).
//
//   POST /api/interno/agentes/rotinas/:nome   nome ∈ estoque | vendas | eventos
import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import * as internoController from "../controllers/internoController.js";
import { flags } from "../lib/flags.js";

export const TAMANHO_MINIMO_SEGREDO = 32;

const resumo = (v) => createHash("sha256").update(String(v ?? "")).digest(); // mesmo tamanho → timingSafeEqual

/** Middleware: flag → segredo configurado → segredo correto. Nunca registra nem ecoa o segredo. */
export function exigirSegredoRotinas(req, res, next) {
  if (!flags().rotinasHabilitadas) return res.status(404).json({ error: "Rota não encontrada" });
  const esperado = process.env.SMA_ROTINAS_TOKEN ?? "";
  if (esperado.length < TAMANHO_MINIMO_SEGREDO) return res.status(503).json({ error: "Rotinas sem segredo de automação configurado" }); // falha fechada
  const recebido = req.get("x-rotinas-token") ?? "";
  if (!timingSafeEqual(resumo(recebido), resumo(esperado))) return res.status(401).json({ error: "Não autorizado" });
  return next();
}

const router = express.Router();
router.post("/agentes/rotinas/:nome", exigirSegredoRotinas, internoController.dispararRotina);

export default router;
