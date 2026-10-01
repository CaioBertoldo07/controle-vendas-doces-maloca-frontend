-- CreateTable
CREATE TABLE `execucoes_agente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agente` VARCHAR(50) NOT NULL,
    `tipoExecucao` VARCHAR(50) NOT NULL,
    `gatilho` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `iniciadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finalizadaEm` DATETIME(3) NULL,
    `duracaoMs` INTEGER NULL,
    `entrada` JSON NULL,
    `saida` JSON NULL,
    `erro` TEXT NULL,
    `metadados` JSON NULL,
    `execucaoPaiId` INTEGER NULL,

    INDEX `execucoes_agente_agente_idx`(`agente`),
    INDEX `execucoes_agente_status_idx`(`status`),
    INDEX `execucoes_agente_iniciadaEm_idx`(`iniciadaEm`),
    INDEX `execucoes_agente_execucaoPaiId_idx`(`execucaoPaiId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chamadas_tool` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `execucaoId` INTEGER NOT NULL,
    `tool` VARCHAR(80) NOT NULL,
    `origem` VARCHAR(20) NOT NULL,
    `entrada` JSON NULL,
    `ok` BOOLEAN NOT NULL,
    `saida` JSON NULL,
    `erro` TEXT NULL,
    `duracaoMs` INTEGER NOT NULL,
    `criadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chamadas_tool_execucaoId_idx`(`execucaoId`),
    INDEX `chamadas_tool_tool_idx`(`tool`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mensagens_agente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `execucaoId` INTEGER NOT NULL,
    `execucaoDestinoId` INTEGER NULL,
    `agenteOrigem` VARCHAR(50) NOT NULL,
    `agenteDestino` VARCHAR(50) NOT NULL,
    `tipo` VARCHAR(50) NOT NULL,
    `conteudo` JSON NULL,
    `status` VARCHAR(20) NOT NULL,
    `resposta` JSON NULL,
    `criadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mensagens_agente_execucaoId_idx`(`execucaoId`),
    INDEX `mensagens_agente_agenteOrigem_agenteDestino_idx`(`agenteOrigem`, `agenteDestino`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recomendacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agente` VARCHAR(50) NOT NULL,
    `execucaoId` INTEGER NULL,
    `tipo` VARCHAR(50) NOT NULL,
    `titulo` VARCHAR(200) NOT NULL,
    `descricao` TEXT NOT NULL,
    `prioridade` VARCHAR(10) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ABERTA',
    `dados` JSON NULL,
    `criadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvidaEm` DATETIME(3) NULL,

    INDEX `recomendacoes_status_idx`(`status`),
    INDEX `recomendacoes_agente_idx`(`agente`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acoes_propostas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo` VARCHAR(50) NOT NULL,
    `payload` JSON NOT NULL,
    `descricao` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    `criadaPorAgente` VARCHAR(50) NOT NULL,
    `execucaoId` INTEGER NULL,
    `criadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `aprovadaEm` DATETIME(3) NULL,
    `rejeitadaEm` DATETIME(3) NULL,
    `motivoRejeicao` VARCHAR(500) NULL,
    `executadaEm` DATETIME(3) NULL,
    `resultado` JSON NULL,
    `erro` TEXT NULL,

    INDEX `acoes_propostas_status_idx`(`status`),
    INDEX `acoes_propostas_criadaPorAgente_idx`(`criadaPorAgente`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `execucoes_agente` ADD CONSTRAINT `execucoes_agente_execucaoPaiId_fkey` FOREIGN KEY (`execucaoPaiId`) REFERENCES `execucoes_agente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chamadas_tool` ADD CONSTRAINT `chamadas_tool_execucaoId_fkey` FOREIGN KEY (`execucaoId`) REFERENCES `execucoes_agente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mensagens_agente` ADD CONSTRAINT `mensagens_agente_execucaoId_fkey` FOREIGN KEY (`execucaoId`) REFERENCES `execucoes_agente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mensagens_agente` ADD CONSTRAINT `mensagens_agente_execucaoDestinoId_fkey` FOREIGN KEY (`execucaoDestinoId`) REFERENCES `execucoes_agente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recomendacoes` ADD CONSTRAINT `recomendacoes_execucaoId_fkey` FOREIGN KEY (`execucaoId`) REFERENCES `execucoes_agente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `acoes_propostas` ADD CONSTRAINT `acoes_propostas_execucaoId_fkey` FOREIGN KEY (`execucaoId`) REFERENCES `execucoes_agente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

