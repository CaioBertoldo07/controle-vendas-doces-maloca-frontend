// HTTP dos clientes. A regra está em services/clientesService.js.
import { responderErroDominio } from "../lib/erros.js";
import * as clientesService from "../services/clientesService.js";

export const listarClientes = async (req, res) => {
  try {
    res.json(await clientesService.listarClientes());
  } catch (error) {
    console.error("Erro ao listar clientes:", error);
    res.status(500).json({ error: "Erro ao buscar clientes" });
  }
};

export const buscarCliente = async (req, res) => {
  try {
    res.json(await clientesService.buscarCliente(req.params.id));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("Erro ao buscar cliente:", error);
    res.status(500).json({ error: "Erro ao buscar cliente" });
  }
};

export const criarCliente = async (req, res) => {
  try {
    const cliente = await clientesService.criarCliente(req.body);
    console.log(`✅ Cliente criado: id=${cliente.id}`); // sem dados pessoais no log (Etapa 7)
    res.status(201).json(cliente);
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao criar cliente:", error);
    res.status(500).json({ error: "Erro ao criar cliente: " + error.message });
  }
};

export const atualizarCliente = async (req, res) => {
  try {
    const cliente = await clientesService.atualizarCliente(req.params.id, req.body);
    console.log(`✅ Cliente atualizado: id=${cliente.id}`); // sem dados pessoais no log (Etapa 7)
    res.json(cliente);
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao atualizar cliente:", error);
    res
      .status(500)
      .json({ error: "Erro ao atualizar cliente: " + error.message });
  }
};

export const deletarCliente = async (req, res) => {
  try {
    const { id } = req.params;
    await clientesService.excluirCliente(id);
    console.log("✅ Cliente deletado:", id);
    res.json({ message: "Cliente deletado com sucesso" });
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao deletar cliente:", error);
    res
      .status(500)
      .json({ error: "Erro ao deletar cliente: " + error.message });
  }
};

export const estatisticasCliente = async (req, res) => {
  try {
    res.json(await clientesService.obterEstatisticasCliente(req.params.id));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao buscar estatísticas:", error);
    res
      .status(500)
      .json({ error: "Erro ao buscar estatísticas: " + error.message });
  }
};

export const saboresPorCliente = async (req, res) => {
  try {
    res.json(await clientesService.obterSaboresDoCliente(req.params.id));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao buscar sabores por cliente:", error);
    res.status(500).json({ error: "Erro ao buscar sabores: " + error.message });
  }
};

export const rankingSaboresGeral = async (req, res) => {
  try {
    res.json(await clientesService.obterRankingSabores());
  } catch (error) {
    console.error("❌ Erro ao buscar ranking de sabores:", error);
    res.status(500).json({ error: "Erro ao buscar ranking: " + error.message });
  }
};
