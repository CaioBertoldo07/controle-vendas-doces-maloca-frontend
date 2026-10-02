-- Etapa 6 (TCC): hardening da camada SMA.
-- ADITIVA: só colunas anuláveis, tabelas novas e índices únicos. Nenhum DROP, nenhuma
-- coluna existente alterada, nenhum dado de negócio tocado.
--   recomendacoes.chaveAtiva / acoes_propostas.chaveAtiva: unicidade NO BANCO da
--     deduplicação (preenchida só enquanto ABERTA / PENDENTE; NULL depois; o MySQL
--     aceita vários NULL num índice único).
--   conversas_agente.processandoAte/tokenProcessamento: lease de um turno por vez.
--   execucoes_rotina, sinais_analise: rotinas analíticas e sinais de eventos.
-- Aplicada apenas em bancos locais nesta etapa.

-- AlterTable
ALTER TABLE `recomendacoes` ADD COLUMN `chaveAtiva` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `acoes_propostas` ADD COLUMN `chaveAtiva` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `conversas_agente` ADD COLUMN `processandoAte` DATETIME(3) NULL,
    ADD COLUMN `tokenProcessamento` VARCHAR(36) NULL;

-- CreateTable
CREATE TABLE `execucoes_rotina` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rotina` VARCHAR(50) NOT NULL,
    `janela` VARCHAR(40) NOT NULL,
    `gatilho` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `execucaoId` INTEGER NULL,
    `tentativas` INTEGER NOT NULL DEFAULT 1,
    `iniciadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finalizadaEm` DATETIME(3) NULL,
    `bloqueadoAte` DATETIME(3) NOT NULL,
    `erro` TEXT NULL,

    UNIQUE INDEX `execucoes_rotina_rotina_janela_key`(`rotina`, `janela`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sinais_analise` (
    `rotina` VARCHAR(50) NOT NULL,
    `pendente` BOOLEAN NOT NULL DEFAULT false,
    `eventos` INTEGER NOT NULL DEFAULT 0,
    `ultimoEvento` VARCHAR(50) NULL,
    `ultimoEventoEm` DATETIME(3) NULL,
    `atualizadoEm` DATETIME(3) NOT NULL,

    PRIMARY KEY (`rotina`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `recomendacoes_chaveAtiva_key` ON `recomendacoes`(`chaveAtiva`);

-- CreateIndex
CREATE UNIQUE INDEX `acoes_propostas_chaveAtiva_key` ON `acoes_propostas`(`chaveAtiva`);


-- Backfill: recomendações ABERTAS já existentes recebem a chave ativa. Só a MAIS
-- RECENTE de cada (agente, chave) a recebe, então o índice único nunca é violado;
-- duplicatas antigas (se houver) continuam ABERTAS, sem chave, para o gestor resolver.
UPDATE `recomendacoes` r
  JOIN (
    SELECT MAX(`id`) AS `id`
    FROM `recomendacoes`
    WHERE `status` = 'ABERTA' AND JSON_EXTRACT(`dados`, '$.controle.chave') IS NOT NULL
    GROUP BY `agente`, JSON_UNQUOTE(JSON_EXTRACT(`dados`, '$.controle.chave'))
  ) m ON m.`id` = r.`id`
  SET r.`chaveAtiva` = CONCAT(r.`agente`, '|', JSON_UNQUOTE(JSON_EXTRACT(r.`dados`, '$.controle.chave')));
