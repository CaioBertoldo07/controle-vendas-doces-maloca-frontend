-- Executado apenas na PRIMEIRA inicialização do volume do MySQL local.
-- O banco de desenvolvimento (doces_maloca_dev) e o usuário `maloca` são
-- criados pelas variáveis do docker-compose.yml. Aqui criamos o banco de
-- TESTE, separado e descartável.
CREATE DATABASE IF NOT EXISTS doces_maloca_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON doces_maloca_test.* TO 'maloca'@'%';
FLUSH PRIVILEGES;
