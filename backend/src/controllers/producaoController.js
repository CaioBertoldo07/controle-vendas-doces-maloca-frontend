// HTTP da produção. A regra (MRP, saldo, transações) está em
// services/producaoService.js.
import { responderErroDominio } from "../lib/erros.js";
import * as producaoService from "../services/producaoService.js";
import { sinalizarSeHabilitado } from "../agents/rotinas/index.js";

export const listarProducao = async (req, res) => {
  try {
    res.json(await producaoService.listarProducao(req.query));
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar produção" });
  }
};

export const criarProducao = async (req, res) => {
  try {
    const producao = await producaoService.criarProducao(req.body);
    await sinalizarSeHabilitado("PRODUCAO_REGISTRADA"); // Etapa 6: só marca que a análise é necessária
    res.status(201).json(producao);
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res
      .status(500)
      .json({ error: "Erro ao registrar produção: " + error.message });
  }
};

export const atualizarProducao = async (req, res) => {
  try {
    res.json(await producaoService.atualizarProducao(req.params.id, req.body));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao atualizar produção" });
  }
};

export const deletarProducao = async (req, res) => {
  try {
    await producaoService.excluirProducao(req.params.id);
    res.json({ message: "Registro deletado com sucesso" });
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao deletar registro" });
  }
};

export const resumoProducao = async (req, res) => {
  try {
    res.json(await producaoService.obterResumoProducao(req.query));
  } catch (error) {
    console.error("Erro no resumo:", error);
    res.status(500).json({ error: "Erro ao gerar resumo" });
  }
};
