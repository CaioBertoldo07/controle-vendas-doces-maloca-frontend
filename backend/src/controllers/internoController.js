// HTTP das rotinas internas (Etapa 6). A autorização (flag + segredo) está em
// routes/interno.js; a regra (idempotência, lease, debounce) em agents/rotinas.
import { runtimePadrao } from "../agents/index.js";
import { NOMES_PERMITIDOS, executarRotina, processarSinais } from "../agents/rotinas/index.js";
import { responderErroDominio } from "../lib/erros.js";

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** POST /api/interno/agentes/rotinas/:nome { dataReferencia? } */
export async function dispararRotina(req, res) {
  try {
    const { nome } = req.params;
    if (!NOMES_PERMITIDOS.includes(nome)) return res.status(404).json({ error: "Rotina não encontrada" });
    const dataReferencia = req.body?.dataReferencia;
    if (dataReferencia !== undefined && !DIA_ISO.test(String(dataReferencia))) return res.status(400).json({ error: "dataReferencia deve estar no formato AAAA-MM-DD" });
    if (nome === "eventos") return res.json(await processarSinais({ runtime: runtimePadrao, dataReferencia }));
    const r = await executarRotina(nome, { runtime: runtimePadrao, gatilho: "AGENDADO", dataReferencia });
    if (!r.executada && r.motivo === "EM_EXECUCAO") return res.status(409).json(r);
    return res.json(r);
  } catch (error) {
    if (responderErroDominio(res, error)) return undefined;
    console.error("Erro na rotina interna:", error?.message);
    return res.status(500).json({ error: "Erro interno na rotina" });
  }
}
