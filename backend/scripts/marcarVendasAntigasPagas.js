/**
 * Backfill do controle de pagamento.
 *
 * O campo `pago` nasce como false, então as vendas que já existiam antes dessa
 * funcionalidade apareceriam como pendentes. Este script marca como pagas as
 * vendas anteriores a uma data de corte (por padrão, agora).
 *
 * Uso:
 *   node scripts/marcarVendasAntigasPagas.js              # tudo até agora
 *   node scripts/marcarVendasAntigasPagas.js 2026-08-14   # tudo até essa data
 *
 * Rode UMA VEZ, logo após o deploy que criou a coluna. Se rodar depois,
 * vendas legitimamente pendentes dentro do corte também virariam pagas.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const main = async () => {
  const arg = process.argv[2];
  const corte = arg ? new Date(`${arg}T23:59:59`) : new Date();

  if (isNaN(corte.getTime())) {
    console.error(`❌ Data de corte inválida: "${arg}". Use AAAA-MM-DD.`);
    process.exit(1);
  }

  const pendentes = await prisma.venda.findMany({
    where: { pago: false, data: { lte: corte } },
    select: { id: true, data: true, valor: true },
  });

  if (pendentes.length === 0) {
    console.log("✅ Nenhuma venda pendente até o corte. Nada a fazer.");
    return;
  }

  const total = pendentes.reduce((s, v) => s + parseFloat(v.valor), 0);
  console.log(
    `🔎 ${pendentes.length} venda(s) até ${corte.toLocaleString("pt-BR")} — R$ ${total.toFixed(2)}`,
  );

  // dataPagamento = data da venda: é a melhor aproximação para registros antigos.
  // Um único UPDATE — atualizar linha a linha pelo proxy público leva minutos.
  const atualizadas = await prisma.$executeRaw`
    UPDATE vendas
       SET pago = true, dataPagamento = data
     WHERE pago = false AND data <= ${corte}
  `;

  console.log(`✅ ${atualizadas} venda(s) marcada(s) como paga(s).`);
};

main()
  .catch((error) => {
    console.error("❌ Erro no backfill:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
