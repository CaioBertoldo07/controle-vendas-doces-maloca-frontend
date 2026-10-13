import { PrismaClient } from "@prisma/client";
import {
  ErroAjuste,
  ehConflitoDeConcorrencia,
  registrarAjusteNaTransacao,
  validarEntradaAjuste,
} from "../services/ajusteEstoque.js";
const prisma = new PrismaClient();

export const listarEstoque = async (req, res) => {
  try {
    const [producaoSabores, vendasSabores, ajustes] = await Promise.all([
      prisma.producaoSabor.findMany({
        include: { sabor: { select: { id: true, nome: true } } },
      }),
      prisma.vendaSabor.findMany({
        include: { sabor: { select: { id: true, nome: true } } },
      }),
      prisma.ajusteEstoque.findMany({
        include: { sabor: { select: { id: true, nome: true } } },
      }),
    ]);

    const porSabor = {};

    producaoSabores.forEach((ps) => {
      const { id, nome } = ps.sabor;
      if (!porSabor[id]) porSabor[id] = { id, nome, produzido: 0, vendido: 0, ajustado: 0 };
      porSabor[id].produzido += ps.quantidade;
    });

    vendasSabores.forEach((vs) => {
      const { id, nome } = vs.sabor;
      if (!porSabor[id]) porSabor[id] = { id, nome, produzido: 0, vendido: 0, ajustado: 0 };
      porSabor[id].vendido += vs.quantidade;
    });

    ajustes.forEach((a) => {
      const { id, nome } = a.sabor;
      if (!porSabor[id]) porSabor[id] = { id, nome, produzido: 0, vendido: 0, ajustado: 0 };
      porSabor[id].ajustado += a.diferenca;
    });

    const itens = Object.values(porSabor)
      .map((s) => ({ ...s, saldo: s.produzido - s.vendido + s.ajustado }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const totalProduzido = itens.reduce((s, i) => s + i.produzido, 0);
    const totalVendido = itens.reduce((s, i) => s + i.vendido, 0);
    const totalAjustado = itens.reduce((s, i) => s + i.ajustado, 0);
    const totalSaldo = totalProduzido - totalVendido + totalAjustado;

    res.json({ itens, totalProduzido, totalVendido, totalAjustado, totalSaldo });
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar estoque" });
  }
};

export const listarAjustes = async (req, res) => {
  try {
    const { saborId, limit } = req.query;
    const where = {};
    if (saborId) {
      where.saborId = parseInt(saborId);
      if (!Number.isInteger(where.saborId)) {
        return res.status(400).json({ error: "Sabor inválido" });
      }
    }
    const take = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

    const ajustes = await prisma.ajusteEstoque.findMany({
      where,
      orderBy: [{ data: "desc" }, { id: "desc" }],
      take,
      include: {
        sabor: { select: { id: true, nome: true } },
        usuario: { select: { id: true, nome: true } },
      },
    });
    res.json(ajustes);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar ajustes de estoque" });
  }
};

export const registrarAjuste = async (req, res) => {
  try {
    const dados = validarEntradaAjuste(req.body);
    const resultado = await prisma.$transaction(
      (tx) => registrarAjusteNaTransacao(tx, dados, req.usuario.id),
      { maxWait: 5000, timeout: 15000 },
    );

    if (resultado.semAlteracao) {
      return res.json({
        semAlteracao: true,
        saldoAtual: resultado.saldoAtual,
        message: "Contagem igual ao saldo atual: nenhum ajuste registrado",
      });
    }
    if (resultado.repetido) {
      return res.json({ ajuste: resultado.ajuste, repetido: true });
    }
    res.status(201).json({ ajuste: resultado.ajuste });
  } catch (error) {
    if (error instanceof ErroAjuste) {
      return res.status(error.status).json({ error: error.message, ...error.extra });
    }
    if (error?.code === "P2002") {
      return res.status(409).json({
        error: "Esta chave de idempotência já foi usada em outro ajuste",
        codigo: "CHAVE_REUTILIZADA",
      });
    }
    if (ehConflitoDeConcorrencia(error)) {
      return res.status(409).json({
        error:
          "Outra operação alterou este estoque ao mesmo tempo. Nenhum ajuste foi registrado; tente novamente.",
        codigo: "CONFLITO_CONCORRENCIA",
      });
    }
    console.error("Erro ao registrar ajuste de estoque:", error);
    res.status(500).json({ error: "Erro ao registrar ajuste de estoque" });
  }
};
