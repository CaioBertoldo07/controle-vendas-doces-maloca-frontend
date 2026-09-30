// HTTP dos sabores e receitas. A regra está em services/saboresService.js.
import { responderErroDominio } from "../lib/erros.js";
import * as saboresService from "../services/saboresService.js";

export const listarSabores = async (req, res) => {
  try {
    res.json(await saboresService.listarSabores(req.query));
  } catch (error) {
    console.error("Erro ao listar sabores:", error);
    res.status(500).json({ error: "Erro ao buscar sabores" });
  }
};

export const buscarSabor = async (req, res) => {
  try {
    res.json(await saboresService.buscarSabor(req.params.id));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao buscar sabor" });
  }
};

export const criarSabor = async (req, res) => {
  try {
    const sabor = await saboresService.criarSabor(req.body);
    console.log("✅ Sabor criado:", sabor);
    res.status(201).json(sabor);
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao criar sabor:", error);
    res.status(500).json({ error: "Erro ao criar sabor: " + error.message });
  }
};

export const atualizarSabor = async (req, res) => {
  try {
    const sabor = await saboresService.atualizarSabor(req.params.id, req.body);
    console.log("✅ Sabor atualizado:", sabor);
    res.json(sabor);
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao atualizar sabor:", error);
    res
      .status(500)
      .json({ error: "Erro ao atualizar sabor: " + error.message });
  }
};

export const deletarSabor = async (req, res) => {
  try {
    const resultado = await saboresService.excluirSabor(req.params.id);
    if (resultado.desativado) {
      return res.json({
        message: "Sabor desativado pois possui vendas vinculadas",
        sabor: resultado.sabor,
        desativado: true,
      });
    }
    res.json({ message: "Sabor deletado com sucesso" });
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao deletar sabor:", error);
    res.status(500).json({ error: "Erro ao deletar sabor: " + error.message });
  }
};

export const listarReceita = async (req, res) => {
  try {
    res.json(await saboresService.obterReceita(req.params.id));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao buscar receita" });
  }
};

export const salvarReceita = async (req, res) => {
  try {
    res.json(await saboresService.salvarReceita(req.params.id, req.body));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    res.status(500).json({ error: "Erro ao salvar receita: " + error.message });
  }
};
