import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando seed do banco de dados...");

  // Limpar dados existentes
  await prisma.vendaSabor.deleteMany();
  await prisma.venda.deleteMany();
  await prisma.sabor.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.usuario.deleteMany();

  // Criar usuário padrão
  const senhaHash = await bcrypt.hash("123456", 10);
  const usuario = await prisma.usuario.create({
    data: {
      nome: "Administrador",
      email: "admin@docesmaloca.com",
      senha: senhaHash,
    },
  });

  console.log(`✅ Usuário criado: ${usuario.email} / senha: 123456`);

  // Criar sabores
  const sabores = await prisma.sabor.createMany({
    data: [
      { nome: "Tradicional", precoUnitario: 5.5 },
      { nome: "Doce de Leite", precoUnitario: 5.5 },
      { nome: "Maracujá", precoUnitario: 5.5 },
      { nome: "Prestígio", precoUnitario: 5.5 },
      { nome: "Castanha", precoUnitario: 5.5 },
      { nome: "Cupuaçu", precoUnitario: 5.5 },
    ],
  });

  console.log(`✅ ${sabores.count} sabores criados`);

  // Criar clientes
  const clientesData = await prisma.cliente.createMany({
    data: [
      { nome: "Cantina NIB" },
      { nome: "Casa da Carne" },
      { nome: "Conveniência Akitem" },
      { nome: "Conveniência Torres Express" },
      { nome: "Dicapute" },
      { nome: "Empório Casa Moraes Centro" },
      { nome: "Empório Casa Moraes Vieiralves" },
      { nome: "Empório das Frutas" },
      { nome: "Frank Pan" },
      { nome: "Frutaria Adrianópolis" },
      { nome: "Frutaria Laranjeiras" },
      { nome: "Frutaria das Torres" },
      { nome: "Frutaria Dom Pedro" },
      { nome: "Frutaria João Valério" },
      { nome: "Frutaria Ki Fruta" },
      { nome: "Frutaria Nilton Lins" },
      { nome: "Frutaria Oliveira" },
      { nome: "Frutaria Shangrilá" },
      { nome: "Galeria 264" },
      { nome: "Hortifruti Dom Pedro" },
      { nome: "Hortifruti Ouro Verde" },
      { nome: "Hortifruti Planalto" },
      { nome: "Hortifruti Ribeiro" },
      { nome: "Mercadinho Bom Preço" },
      { nome: "Mercadinho do Japonês" },
      { nome: "Mercadinho Casas do Óleo" },
      { nome: "Panificadora AP Costa" },
      { nome: "Panificadora Barcelona" },
      { nome: "Panificadora Bela Serpan" },
      { nome: "Panificadora Coffee & Pão" },
      { nome: "Panificadora Elisa" },
      { nome: "Panificadora Lindopan" },
      { nome: "Panificadora Parque Dez" },
      { nome: "Panificadora Serpan Cidade Nova" },
      { nome: "Parceiro da Fruta" },
      { nome: "Restaurante Casa Branca" },
      { nome: "Restaurante Coqueiro Verde P10" },
      { nome: "Restaurante Coqueiro Verde PCA14" },
      { nome: "Varejão das Frutas" },
      { nome: "Venda Direta Para Clientes" },
      { nome: "Angela" },
    ],
  });

  console.log(`✅ ${clientesData.count} clientes criados`);

  // Buscar clientes e sabores criados
  const clientesCriados = await prisma.cliente.findMany();
  const saboresCriados = await prisma.sabor.findMany();

  // Criar vendas de exemplo com sabores
  const hoje = new Date();

  for (let i = 0; i < 20; i++) {
    const dataVenda = new Date(hoje);
    dataVenda.setDate(hoje.getDate() - i);

    const clienteAleatorio =
      clientesCriados[Math.floor(Math.random() * clientesCriados.length)];

    // Quantidade total de doces nesta venda
    const quantidadeTotal = Math.floor(Math.random() * 20) + 5;

    // Criar venda
    const venda = await prisma.venda.create({
      data: {
        clienteId: clienteAleatorio.id,
        quantidade: quantidadeTotal,
        valor: quantidadeTotal * 5.5,
        data: dataVenda,
      },
    });

    // Distribuir quantidades entre sabores aleatórios
    const numSabores = Math.floor(Math.random() * 3) + 1; // 1 a 3 sabores por venda
    const saboresUsados = [];
    let quantidadeRestante = quantidadeTotal;

    for (let j = 0; j < numSabores; j++) {
      let saborAleatorio;
      do {
        saborAleatorio =
          saboresCriados[Math.floor(Math.random() * saboresCriados.length)];
      } while (saboresUsados.includes(saborAleatorio.id));

      saboresUsados.push(saborAleatorio.id);

      const qtdSabor =
        j === numSabores - 1
          ? quantidadeRestante
          : Math.floor(Math.random() * quantidadeRestante) + 1;

      await prisma.vendaSabor.create({
        data: {
          vendaId: venda.id,
          saborId: saborAleatorio.id,
          quantidade: qtdSabor,
        },
      });

      quantidadeRestante -= qtdSabor;
    }
  }

  console.log("✅ 20 vendas criadas com sabores");
  console.log("🎉 Seed concluído com sucesso!");
  console.log("\n📧 Login: admin@docesmaloca.com");
  console.log("🔑 Senha: 123456\n");
}

main()
  .catch((e) => {
    console.error("❌ Erro no seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
