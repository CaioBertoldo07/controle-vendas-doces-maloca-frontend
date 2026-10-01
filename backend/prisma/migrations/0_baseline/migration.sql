-- CreateTable
CREATE TABLE `usuarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(100) NOT NULL,
    `email` VARCHAR(100) NOT NULL,
    `senha` VARCHAR(255) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `usuarios_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clientes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sabores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(50) NOT NULL,
    `precoUnitario` DECIMAL(10, 2) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `rendimentoBase` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quantidade` INTEGER NOT NULL,
    `valor` DECIMAL(10, 2) NOT NULL,
    `desconto` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `pago` BOOLEAN NOT NULL DEFAULT false,
    `dataPagamento` DATETIME(3) NULL,
    `idempotencyKey` VARCHAR(100) NULL,
    `clienteId` INTEGER NOT NULL,

    UNIQUE INDEX `vendas_idempotencyKey_key`(`idempotencyKey`),
    INDEX `vendas_clienteId_idx`(`clienteId`),
    INDEX `vendas_data_idx`(`data`),
    INDEX `vendas_pago_idx`(`pago`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `venda_sabores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vendaId` INTEGER NOT NULL,
    `saborId` INTEGER NOT NULL,
    `quantidade` INTEGER NOT NULL,

    INDEX `venda_sabores_vendaId_idx`(`vendaId`),
    INDEX `venda_sabores_saborId_idx`(`saborId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `materias_primas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(100) NOT NULL,
    `unidadeBase` VARCHAR(10) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receita_itens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saborId` INTEGER NOT NULL,
    `materiaPrimaId` INTEGER NOT NULL,
    `quantidadeBase` DECIMAL(10, 3) NOT NULL,

    INDEX `receita_itens_saborId_idx`(`saborId`),
    INDEX `receita_itens_materiaPrimaId_idx`(`materiaPrimaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `movimentacoes_materia_prima` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `materiaPrimaId` INTEGER NOT NULL,
    `tipo` VARCHAR(10) NOT NULL,
    `origem` VARCHAR(20) NOT NULL,
    `quantidade` DECIMAL(10, 3) NOT NULL,
    `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `custoId` INTEGER NULL,
    `producaoId` INTEGER NULL,
    `observacao` VARCHAR(255) NULL,

    INDEX `movimentacoes_materia_prima_materiaPrimaId_idx`(`materiaPrimaId`),
    INDEX `movimentacoes_materia_prima_custoId_idx`(`custoId`),
    INDEX `movimentacoes_materia_prima_producaoId_idx`(`producaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(100) NOT NULL,
    `categoria` VARCHAR(50) NOT NULL DEFAULT 'Matéria Prima',
    `quantidade` DECIMAL(10, 3) NOT NULL,
    `unidade` VARCHAR(20) NOT NULL,
    `valorTotal` DECIMAL(10, 2) NOT NULL,
    `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `observacao` VARCHAR(255) NULL,
    `materiaPrimaId` INTEGER NULL,

    INDEX `custos_data_idx`(`data`),
    INDEX `custos_materiaPrimaId_idx`(`materiaPrimaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `producao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `observacao` VARCHAR(255) NULL,

    INDEX `producao_data_idx`(`data`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `producao_sabores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `producaoId` INTEGER NOT NULL,
    `saborId` INTEGER NOT NULL,
    `quantidade` INTEGER NOT NULL,

    INDEX `producao_sabores_producaoId_idx`(`producaoId`),
    INDEX `producao_sabores_saborId_idx`(`saborId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `vendas` ADD CONSTRAINT `vendas_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `venda_sabores` ADD CONSTRAINT `venda_sabores_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `vendas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `venda_sabores` ADD CONSTRAINT `venda_sabores_saborId_fkey` FOREIGN KEY (`saborId`) REFERENCES `sabores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receita_itens` ADD CONSTRAINT `receita_itens_saborId_fkey` FOREIGN KEY (`saborId`) REFERENCES `sabores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receita_itens` ADD CONSTRAINT `receita_itens_materiaPrimaId_fkey` FOREIGN KEY (`materiaPrimaId`) REFERENCES `materias_primas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `movimentacoes_materia_prima` ADD CONSTRAINT `movimentacoes_materia_prima_materiaPrimaId_fkey` FOREIGN KEY (`materiaPrimaId`) REFERENCES `materias_primas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custos` ADD CONSTRAINT `custos_materiaPrimaId_fkey` FOREIGN KEY (`materiaPrimaId`) REFERENCES `materias_primas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `producao_sabores` ADD CONSTRAINT `producao_sabores_producaoId_fkey` FOREIGN KEY (`producaoId`) REFERENCES `producao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `producao_sabores` ADD CONSTRAINT `producao_sabores_saborId_fkey` FOREIGN KEY (`saborId`) REFERENCES `sabores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

