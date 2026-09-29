// Executado em cada processo de teste antes dos arquivos de teste:
// valida o ambiente, fixa o banco de teste e limpa as tabelas antes de cada teste.
import { afterAll, beforeEach } from "vitest";
import { ativarBancoDeTeste, prepararAmbienteDeTeste } from "./ambiente.js";

const { url } = prepararAmbienteDeTeste();
ativarBancoDeTeste(url);

// Import dinâmico: o PrismaClient da suíte só é criado depois da ativação.
const { prisma, limparBanco } = await import("../helpers/db.js");

beforeEach(async () => {
  await limparBanco();
});

afterAll(async () => {
  await prisma.$disconnect();
});
