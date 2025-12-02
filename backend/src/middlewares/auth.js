import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const verificarAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "Token não fornecido" });
    }

    const [, token] = authHeader.split(" ");

    if (!token) {
      return res.status(401).json({ error: "Token mal formatado" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const usuario = await prisma.usuario.findUnique({
      where: { id: decoded.id },
      select: { id: true, nome: true, email: true },
    });

    if (!usuario) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    req.usuario = usuario;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido" });
  }
};
