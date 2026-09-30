// HTTP das matérias-primas. A regra está em services/materiaPrimaService.js.
import { responderErroDominio } from "../lib/erros.js";
import * as materiaPrimaService from "../services/materiaPrimaService.js";

export const listarMateriasPrimas = async (req, res) => {
  try {
    res.json(await materiaPrimaService.listarMateriasPrimas(req.query));
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar matérias-primas" });
  }
};

export const criarMateriaPrima = async (req, res) => {
  try {
    res.status(201).json(await materiaPrimaService.criarMateriaPrima(req.body));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res
      .status(500)
      .json({ error: "Erro ao criar matéria-prima: " + error.message });
  }
};

export const atualizarMateriaPrima = async (req, res) => {
  try {
    res.json(await materiaPrimaService.atualizarMateriaPrima(req.params.id, req.body));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao atualizar matéria-prima" });
  }
};

export const deletarMateriaPrima = async (req, res) => {
  try {
    await materiaPrimaService.desativarMateriaPrima(req.params.id);
    res.json({ message: "Matéria-prima desativada com sucesso" });
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao desativar matéria-prima" });
  }
};

export const resumoMateriasPrimas = async (req, res) => {
  try {
    res.json(await materiaPrimaService.resumoMateriasPrimas());
  } catch (error) {
    res
      .status(500)
      .json({ error: "Erro ao gerar resumo de matérias-primas" });
  }
};
