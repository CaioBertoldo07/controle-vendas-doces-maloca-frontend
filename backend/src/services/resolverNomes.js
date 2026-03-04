import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Normaliza string para comparação: "Doce de Leite" -> "docedeleite"
function normalizar(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]/g, ""); // remove espaços e especiais
}

export async function resolverCliente(nomeTexto) {
  const clientes = await prisma.cliente.findMany();
  const alvo = normalizar(nomeTexto);

  // 1. Busca exata normalizada
  const exato = clientes.find((c) => normalizar(c.nome) === alvo);
  if (exato) return exato;

  // 2. Busca por contém (ex: "João" encontra "João Santos")
  const parcial = clientes.find(
    (c) =>
      normalizar(c.nome).includes(alvo) || alvo.includes(normalizar(c.nome)),
  );
  if (parcial) return parcial;

  return null; // não encontrado
}

export async function resolverSabores(saboresTexto) {
  // saboresTexto: [{ nome: "Tradicional", quantidade: 20 }, ...]
  const saboresDB = await prisma.sabor.findMany({ where: { ativo: true } });

  const resultado = [];
  const naoEncontrados = [];

  for (const item of saboresTexto) {
    const alvo = normalizar(item.nome);

    const encontrado = saboresDB.find(
      (s) =>
        normalizar(s.nome) === alvo ||
        normalizar(s.nome).includes(alvo) ||
        alvo.includes(normalizar(s.nome)),
    );

    if (encontrado) {
      resultado.push({ saborId: encontrado.id, quantidade: item.quantidade });
    } else {
      naoEncontrados.push(item.nome);
    }
  }
  return { sabores: resultado, naoEncontrados };
}
