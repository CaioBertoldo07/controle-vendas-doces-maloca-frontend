-- Etapa 5 (TCC): conversa gestor <-> Agente de Atendimento.
-- Migration ADITIVA: só cria duas tabelas novas; nenhuma tabela existente muda.
-- MensagemAgente continua sendo só comunicação entre agentes.
-- Aplicada apenas em bancos locais (dev e teste). Nunca em produção nesta etapa.

-- CreateTable
CREATE TABLE `conversas_agente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `estado` JSON NULL,
    `criadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadaEm` DATETIME(3) NOT NULL,

    INDEX `conversas_agente_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mensagens_conversa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversaId` INTEGER NOT NULL,
    `papel` VARCHAR(20) NOT NULL,
    `conteudo` TEXT NOT NULL,
    `dados` JSON NULL,
    `execucaoId` INTEGER NULL,
    `criadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mensagens_conversa_conversaId_idx`(`conversaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `conversas_agente` ADD CONSTRAINT `conversas_agente_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mensagens_conversa` ADD CONSTRAINT `mensagens_conversa_conversaId_fkey` FOREIGN KEY (`conversaId`) REFERENCES `conversas_agente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

