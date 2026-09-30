import { prisma } from "../lib/prisma.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { responderErroDominio } from "../lib/erros.js";
import * as authService from "../services/authService.js";

// `registro` não tem rota desde o commit e0f7b64 (cadastro bloqueado): é
// código morto, mantido intocado na Etapa 0.4.

export const registro = async (req, res) => {
  try {
    const { nome, email, senha } = req.body;

    // Verificar se o email já existe
    const usuarioExiste = await prisma.usuario.findUnique({
      where: { email },
    });

    if (usuarioExiste) {
      return res.status(400).json({ error: "Email já cadastrado" });
    }

    // Hash da senha
    const senhaHash = await bcrypt.hash(senha, 10);

    // Criar usuário
    const usuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        senha: senhaHash,
      },
    });

    // Gerar token
    const token = jwt.sign(
      { id: usuario.id, email: usuario.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "Usuário criado com sucesso",
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
      },
    });
  } catch (error) {
    console.error("Erro no registro:", error);
    res.status(500).json({ error: "Erro ao criar usuário" });
  }
};

export const login = async (req, res) => {
  try {
    const { token, usuario } = await authService.autenticar(req.body);
    res.json({
      message: "Login realizado com sucesso",
      token,
      usuario,
    });
  } catch (error) {
    if (responderErroDominio(res, error)) return;
    console.error("Erro no login:", error);
    res.status(500).json({ error: "Erro ao fazer login" });
  }
};

export const verificarToken = async (req, res) => {
  res.json({
    message: "Token válido",
    usuario: req.usuario,
  });
};
