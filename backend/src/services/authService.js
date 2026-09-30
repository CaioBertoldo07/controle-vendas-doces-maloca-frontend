/**
 * Autenticação do gestor: verificação de credencial e emissão do JWT.
 * Extraído de authController.login sem mudança (bcrypt.compare; JWT
 * { id, email } assinado com JWT_SECRET, validade de 7 dias).
 * O middleware verificarAuth e a API Key permanecem como estavam.
 */
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { erro } from "../lib/erros.js";
import { prisma } from "../lib/prisma.js";

const credencialInvalida = () => erro(401, "Email ou senha inválidos");

/**
 * Devolve { token, usuario: { id, nome, email } } ou lança ErroDominio 401
 * com a mesma mensagem para email inexistente e senha errada.
 * KNOWN_BEHAVIOR: sem email, o Prisma lança erro comum (a API responde 500).
 */
export async function autenticar({ email, senha } = {}) {
  const usuario = await prisma.usuario.findUnique({
    where: { email },
  });
  if (!usuario) throw credencialInvalida();

  const senhaValida = await bcrypt.compare(senha, usuario.senha);
  if (!senhaValida) throw credencialInvalida();

  const token = jwt.sign(
    { id: usuario.id, email: usuario.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  return {
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
    },
  };
}
