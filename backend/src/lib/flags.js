// Feature flags (Etapa 6): variáveis de ambiente lidas a cada uso (sem cache,
// sem serviço externo). Desligar uma flag e reiniciar o processo é o rollback
// lógico de cada capacidade nova, sem mexer em banco nem em código.
//
//   SMA_ENABLED              camada SMA (/api/agentes)
//   ASSISTENTE_ENABLED       conversa com o Atendimento (/chat)
//   AGENT_SCHEDULER_ENABLED  endpoint interno das rotinas analíticas
//   SMA_EVENTOS_ENABLED      sinais de VENDA_/PRODUCAO_REGISTRADA
//
// FAIL-CLOSED: todas são capacidades novas e ficam DESLIGADAS quando a
// variável não existe. Só o texto "true" (sem diferenciar maiúsculas) liga;
// qualquer outro valor ("1", "yes", vazio, erro de digitação) mantém desligada.
// Variável esquecida em produção → funcionalidade nova desligada, nunca exposta.
import { erro } from "./erros.js";

const ligada = (valor) => String(valor ?? "").trim().toLowerCase() === "true";

export const flags = (env = process.env) => ({
  smaHabilitado: ligada(env.SMA_ENABLED),
  assistenteHabilitado: ligada(env.ASSISTENTE_ENABLED),
  rotinasHabilitadas: ligada(env.AGENT_SCHEDULER_ENABLED),
  eventosHabilitados: ligada(env.SMA_EVENTOS_ENABLED),
});

/** Middleware: 503 com mensagem amigável quando a flag está desligada. */
export const exigirFlag = (nome, mensagem) => (req, res, next) => {
  if (flags()[nome]) return next();
  const e = erro(503, mensagem);
  return res.status(e.status).json(e.corpo);
};
