// HTTP dos custos. A regra (conversão, entrada de insumo, transações) está em
// services/custosService.js.
import { responderErroDominio } from "../lib/erros.js";
import * as custosService from "../services/custosService.js";

export const listarCustos = async (req, res) => {
  try {
    res.json(await custosService.listarCustos(req.query));
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar custos" });
  }
};

export const criarCusto = async (req, res) => {
  try {
    res.status(201).json(await custosService.criarCusto(req.body));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao criar custo: " + error.message });
  }
};

export const atualizarCusto = async (req, res) => {
  try {
    res.json(await custosService.atualizarCusto(req.params.id, req.body));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao atualizar custo" });
  }
};

export const deletarCusto = async (req, res) => {
  try {
    await custosService.excluirCusto(req.params.id);
    res.json({ message: "Custo deletado com sucesso" });
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao deletar custo" });
  }
};

export const resumoCustos = async (req, res) => {
  try {
    res.json(await custosService.resumoCustos(req.query));
  } catch (error) {
    res.status(500).json({ error: "Erro ao gerar resumo" });
  }
};
