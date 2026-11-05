// Ambiente fixo para os testes (carregado antes do dotenv, que não sobrescreve
// variáveis já definidas). Os testes não acessam o banco.
process.env.DB_HOST = 'test-host';
process.env.DB_USER = 'test-user';
process.env.DB_NAME = 'crmdb';
process.env.DB_TIMEZONE = '+00:00';
process.env.APP_TIMEZONE = '-03:00';
