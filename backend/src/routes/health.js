// Health check (Etapa 6), público e sem segredo: diz se o backend e o banco
// respondem e em que estado estão as capacidades do SMA. Nunca expõe
// credencial, URL de banco nem dados de negócio.
//
// 200 = backend e banco OK (o assistente pode estar indisponível sem que o
// sistema esteja "doente": sem provedor de LLM, o resto funciona).
// 503 = o banco não responde.
import express from "express";
import { provedorPadrao } from "../agents/index.js";
import { situacaoRotinas } from "../agents/rotinas/index.js";
import { flags } from "../lib/flags.js";
import { prisma } from "../lib/prisma.js";

function estadoAssistente(f) {
  if (!f.smaHabilitado || !f.assistenteHabilitado) return { habilitado: false, estado: "DESABILITADO", provedor: null };
  if (!provedorPadrao) return { habilitado: true, estado: "INDISPONIVEL", provedor: "NAO_CONFIGURADO" };
  if (provedorPadrao.configuracaoInvalida) return { habilitado: true, estado: "INDISPONIVEL", provedor: "CONFIGURACAO_INVALIDA" };
  return { habilitado: true, estado: "DISPONIVEL", provedor: provedorPadrao.nome, modelo: provedorPadrao.modelo ?? null };
}

const router = express.Router();

router.get("/", async (req, res) => {
  const f = flags();
  let banco = "OK";
  let rotinas = null;
  let acoesEmExecucao = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    [rotinas, acoesEmExecucao] = await Promise.all([situacaoRotinas(), prisma.acaoProposta.count({ where: { status: "EXECUTANDO" } })]);
  } catch {
    banco = "FALHA";
  }
  res.status(banco === "OK" ? 200 : 503).json({
    status: banco === "OK" ? "OK" : "FALHA",
    backend: "OK",
    banco,
    sma: { habilitado: f.smaHabilitado, acoesEmExecucao },
    assistente: estadoAssistente(f),
    rotinas: { habilitadas: f.rotinasHabilitadas, eventosHabilitados: f.eventosHabilitados, ...(rotinas ?? {}) },
  });
});

export default router;
