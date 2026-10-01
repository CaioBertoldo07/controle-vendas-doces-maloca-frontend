// HTTP da camada SMA (Etapa 1). Rotas montadas com verificarAuth (gestor).
// Nada de stack trace, prompt ou segredo nas respostas: erros internos saem
// genéricos; o detalhe fica na auditoria (ExecucaoAgente.erro).
import * as servicoAcoes from "../agents/acoes/servicoAcoes.js";
import * as consultas from "../agents/consultas.js";
import { runtimePadrao } from "../agents/index.js";
import { ErroDominio, responderErroDominio } from "../lib/erros.js";

const responder = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("Erro na camada de agentes:", error?.message);
    res.status(500).json({ error: "Erro interno na camada de agentes" });
  }
};

export const listarAgentes = responder(async (req, res) => {
  res.json(runtimePadrao.registro.listar());
});

export const executarAgente = responder(async (req, res) => {
  const { tipo, dados } = req.body ?? {};
  if (typeof tipo !== "string" || !tipo.trim() || tipo.length > 50) {
    throw new ErroDominio(400, { error: "Informe o tipo da execução (texto de até 50 caracteres)" });
  }
  if (dados !== undefined && (typeof dados !== "object" || dados === null || Array.isArray(dados))) {
    throw new ErroDominio(400, { error: "dados deve ser um objeto" });
  }
  const r = await runtimePadrao.executarAgente(req.params.nome, { tipo, dados: dados ?? {} }, { gatilho: "HTTP" });
  res.json(r);
});

export const listarExecucoes = responder(async (req, res) => {
  res.json(await consultas.listarExecucoes(req.query));
});

export const buscarExecucao = responder(async (req, res) => {
  res.json(await consultas.buscarExecucao(req.params.id));
});

export const listarRecomendacoes = responder(async (req, res) => {
  res.json(await consultas.listarRecomendacoes(req.query));
});

export const listarAcoes = responder(async (req, res) => {
  res.json(await servicoAcoes.listarAcoes(req.query));
});

/** Aprovação do gestor → executor determinístico (fluxo explícito). */
export const aprovarAcao = responder(async (req, res) => {
  res.json(await servicoAcoes.aprovarEExecutar(req.params.id));
});

export const rejeitarAcao = responder(async (req, res) => {
  res.json(await servicoAcoes.rejeitarAcao(req.params.id, req.body?.motivo));
});
