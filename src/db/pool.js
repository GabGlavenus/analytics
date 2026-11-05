import mysql from 'mysql2/promise';
import { config } from '../config/index.js';

// Pool de conexões único da aplicação. Toda sessão é colocada em modo
// READ ONLY: qualquer INSERT/UPDATE/DELETE acidental é rejeitado pelo próprio
// servidor MySQL/MariaDB, além de a aplicação só emitir SELECTs.
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  timezone: config.db.timezone,
  connectionLimit: config.db.connectionLimit,
  // Datas chegam como texto 'YYYY-MM-DD HH:MM:SS', exatamente como gravadas no
  // banco: evita conversões de fuso entre MySQL, Node e navegador.
  dateStrings: true,
  multipleStatements: false,
  supportBigNumbers: true,
  bigNumberStrings: true,
});

pool.pool.on('connection', (conn) => {
  conn.query('SET SESSION TRANSACTION READ ONLY');
});

/** Executa um SELECT parametrizado e devolve apenas as linhas. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function closePool() {
  await pool.end();
}
