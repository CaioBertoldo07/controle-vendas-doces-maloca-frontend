// HTTP do estoque de produto acabado. A regra está em services/estoqueService.js.
import * as estoqueService from "../services/estoqueService.js";

export const listarEstoque = async (req, res) => {
  try {
    res.json(await estoqueService.obterEstoqueAcabado());
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar estoque" });
  }
};
