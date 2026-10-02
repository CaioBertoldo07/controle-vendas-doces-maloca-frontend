// HTTP das vendas. A regra está em services/vendasService.js.
import { responderErroDominio } from "../lib/erros.js";
import * as vendasService from "../services/vendasService.js";
import { sinalizarSeHabilitado } from "../agents/rotinas/index.js";

export const criarVendaAuto = async (req, res) => {
  try {
    const resultado = await vendasService.criarVendaPorTexto(req.body);

    if (resultado.duplicata) {
      return res.status(200).json({
        message: "Venda já registrada anteriormente (idempotente)",
        venda: resultado.venda,
        duplicata: true,
      });
    }

    const { venda, cliente, saboresResolvidos } = resultado;
    await sinalizarSeHabilitado("VENDA_REGISTRADA"); // Etapa 6: só marca que a análise é necessária
    console.log(
      `✅ [AUTO] Venda registrada via n8n: ${venda.id} - ${cliente.nome}`,
    );

    return res.status(201).json({
      message: "Venda registrada com sucesso",
      venda,
      resolucao: {
        clienteEncontrado: cliente.nome,
        saboresResolvidos: saboresResolvidos.length,
      },
    });
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ [AUTO] Erro ao criar venda:", error);
    return res
      .status(500)
      .json({ error: "Erro ao registrar venda: " + error.message });
  }
};

export const criarVenda = async (req, res) => {
  try {
    const venda = await vendasService.criarVenda(req.body);
    await sinalizarSeHabilitado("VENDA_REGISTRADA"); // Etapa 6: só marca que a análise é necessária
    console.log("✅ Venda criada:", venda);
    res.status(201).json(venda);
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("❌ Erro ao criar venda:", error);
    res
      .status(500)
      .json({ error: "Erro ao registrar venda: " + error.message });
  }
};

export const listarVendas = async (req, res) => {
  try {
    res.json(await vendasService.listarVendas(req.query));
  } catch (error) {
    console.error("Erro ao listar vendas:", error);
    res.status(500).json({ error: "Erro ao buscar vendas" });
  }
};

export const buscarVenda = async (req, res) => {
  try {
    res.json(await vendasService.buscarVenda(req.params.id));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("Erro ao buscar venda:", error);
    res.status(500).json({ error: "Erro ao buscar venda" });
  }
};

export const atualizarVenda = async (req, res) => {
  try {
    res.json(await vendasService.atualizarVenda(req.params.id, req.body));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("Erro ao atualizar venda:", error);
    res.status(500).json({ error: "Erro ao atualizar venda" });
  }
};

// PATCH /api/vendas/:id/pagamento - marca a venda como paga ou volta para pendente
export const atualizarPagamento = async (req, res) => {
  try {
    res.json(await vendasService.atualizarPagamento(req.params.id, req.body));
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("Erro ao atualizar pagamento:", error);
    res.status(500).json({ error: "Erro ao atualizar pagamento da venda" });
  }
};

export const deletarVenda = async (req, res) => {
  try {
    await vendasService.excluirVenda(req.params.id);
    res.json({ message: "Venda deletada com sucesso" });
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("Erro ao deletar venda:", error);
    res.status(500).json({ error: "Erro ao deletar venda" });
  }
};

export const obterTotais = async (req, res) => {
  try {
    res.json(await vendasService.obterTotais(req.query));
  } catch (error) {
    console.error("Erro ao calcular totais:", error);
    res.status(500).json({ error: "Erro ao calcular totais" });
  }
};

export const relatorioMensal = async (req, res) => {
  try {
    res.json(await vendasService.relatorioMensal(req.query));
  } catch (error) {
    console.error("Erro ao gerar relatório mensal:", error);
    res.status(500).json({ error: "Erro ao gerar relatório mensal" });
  }
};
