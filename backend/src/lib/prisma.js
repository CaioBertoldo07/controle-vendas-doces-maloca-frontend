// Instância única do Prisma para todo o backend (controllers, services,
// middlewares e, futuramente, a camada de agentes). Substitui as instâncias
// que antes eram criadas em cada arquivo.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
