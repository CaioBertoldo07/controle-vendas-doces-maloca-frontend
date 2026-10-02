// Instância única do Prisma para todo o backend (controllers, services,
// middlewares e, futuramente, a camada de agentes). Substitui as instâncias
// que antes eram criadas em cada arquivo.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * Etapa 6: executa `fn` numa transação. Se `db` já é um cliente de transação
 * (sem $transaction), reaproveita-a; senão abre uma. Permite que um service
 * rode sozinho (HTTP) ou dentro da transação de quem o chama (executor de
 * ações), sem duplicar código.
 */
export const emTransacao = (db, fn, opcoes) => (typeof db.$transaction === "function" ? db.$transaction(fn, opcoes) : fn(db));
