import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name} (veja .env.example)`);
  }
  return value;
}

function utcOffset(name, fallback) {
  const value = process.env[name] || fallback;
  if (!/^[+-]\d{2}:\d{2}$/.test(value)) {
    throw new Error(`${name} deve estar no formato +HH:MM ou -HH:MM (recebido: ${value})`);
  }
  return value;
}

export const config = Object.freeze({
  db: Object.freeze({
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: required('DB_NAME'),
    // Fuso em que as colunas DATETIME estão gravadas (o crmdb grava em UTC).
    timezone: utcOffset('DB_TIMEZONE', '+00:00'),
    connectionLimit: Number(process.env.DB_POOL_SIZE || 5),
  }),
  app: Object.freeze({
    // Fuso de exibição e dos limites do período (horário de Brasília).
    timezone: utcOffset('APP_TIMEZONE', '-03:00'),
  }),
  server: Object.freeze({
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || '127.0.0.1',
  }),
});
