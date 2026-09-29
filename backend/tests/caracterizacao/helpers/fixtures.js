/**
 * Fixtures determinísticas e 100% fictícias (nenhum nome, valor ou hash real).
 * Criam o estado diretamente no banco de teste via Prisma, para que cada teste
 * prepare só o que precisa. O comportamento sob teste é sempre exercitado
 * pela API ou pela função real do sistema.
 */
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET_TESTE } from "../setup/ambiente.js";
import { prisma } from "./db.js";

export const SENHA_TESTE = "senha-ficticia-123";

// ---------- Usuário / autenticação ----------
export async function criarUsuario({
  nome = "Gestora Fictícia",
  email = "gestora@exemplo.test",
  senha = SENHA_TESTE,
} = {}) {
  const usuario = await prisma.usuario.create({
    data: { nome, email, senha: await bcrypt.hash(senha, 4) },
  });
  return { usuario, senha };
}

export function tokenPara(usuario, payloadExtra = {}) {
  return jwt.sign({ id: usuario.id, email: usuario.email, ...payloadExtra }, JWT_SECRET_TESTE, {
    ...(payloadExtra.exp ? {} : { expiresIn: "7d" }),
  });
}

/** Cria um usuário e devolve um token válido para ele. */
export async function autenticar() {
  const { usuario } = await criarUsuario();
  return tokenPara(usuario);
}

// ---------- Cadastros ----------
export const criarCliente = (nome = "Mercearia Fictícia Aurora") =>
  prisma.cliente.create({ data: { nome } });

export const criarSabor = ({ nome = "Sabor Fictício", precoUnitario = 5.5, ativo = true, rendimentoBase = null } = {}) =>
  prisma.sabor.create({ data: { nome, precoUnitario, ativo, rendimentoBase } });

export const criarMateriaPrima = ({ nome = "Insumo Fictício", unidadeBase = "g", ativo = true } = {}) =>
  prisma.materiaPrima.create({ data: { nome, unidadeBase, ativo } });

/** Define rendimentoBase e itens de receita de um sabor. */
export async function definirReceita(saborId, rendimentoBase, itens) {
  await prisma.sabor.update({ where: { id: saborId }, data: { rendimentoBase } });
  for (const { materiaPrimaId, quantidadeBase } of itens) {
    await prisma.receitaItem.create({ data: { saborId, materiaPrimaId, quantidadeBase } });
  }
}

/** Movimentação direta de matéria-prima (para preparar saldos). */
export const movimentar = (materiaPrimaId, { tipo = "ENTRADA", origem = "CUSTO", quantidade, data = new Date("2026-03-01T12:00:00Z") }) =>
  prisma.movimentacaoMateriaPrima.create({ data: { materiaPrimaId, tipo, origem, quantidade, data } });

// ---------- Operações (estado pronto, sem passar pela API) ----------
export async function criarVenda({
  clienteId,
  itens,
  data = new Date("2026-03-10T12:00:00Z"),
  valor,
  desconto = 0,
  pago = false,
  dataPagamento = null,
  quantidade,
}) {
  const total = quantidade ?? itens.reduce((s, i) => s + i.quantidade, 0);
  return prisma.venda.create({
    data: {
      clienteId,
      quantidade: total,
      valor: valor ?? total * 5.5,
      desconto,
      data,
      pago,
      dataPagamento: pago ? (dataPagamento ?? data) : null,
      sabores: { create: itens.map(({ saborId, quantidade: q }) => ({ saborId, quantidade: q })) },
    },
  });
}

export const criarProducao = ({ itens, data = new Date("2026-03-05T12:00:00Z"), observacao = null }) =>
  prisma.producao.create({
    data: {
      data,
      observacao,
      sabores: { create: itens.map(({ saborId, quantidade }) => ({ saborId, quantidade })) },
    },
  });

// ---------- Consultas de apoio às asserções ----------
export const movimentacoesDe = (where) =>
  prisma.movimentacaoMateriaPrima.findMany({ where, orderBy: { id: "asc" } });

/** Cenário MRP padrão: receita de 100 un. = 1000 g açúcar + 500 g coco. */
export async function cenarioReceitaBasica({ estoqueAcucar = 10000, estoqueCoco = 10000 } = {}) {
  const acucar = await criarMateriaPrima({ nome: "Açúcar Fictício", unidadeBase: "g" });
  const coco = await criarMateriaPrima({ nome: "Coco Fictício", unidadeBase: "g" });
  const sabor = await criarSabor({ nome: "Cocada Fictícia" });
  await definirReceita(sabor.id, 100, [
    { materiaPrimaId: acucar.id, quantidadeBase: 1000 },
    { materiaPrimaId: coco.id, quantidadeBase: 500 },
  ]);
  if (estoqueAcucar) await movimentar(acucar.id, { quantidade: estoqueAcucar });
  if (estoqueCoco) await movimentar(coco.id, { quantidade: estoqueCoco });
  return { acucar, coco, sabor };
}
