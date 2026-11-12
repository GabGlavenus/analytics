import os from 'node:os';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { closePool } from './db/pool.js';

const { host, port } = config.server;

const server = createApp().listen(port, host, () => {
  if (host !== '0.0.0.0') return console.log(`Rodando em http://${host}:${port}`);
  console.log(`Rodando em http://localhost:${port}`);
  Object.values(os.networkInterfaces()).flat()
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .forEach((i) => console.log(`Na rede:    http://${i.address}:${port}`));
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE'
    ? `A porta ${port} já está em uso: o sistema provavelmente já está aberto em outra janela.`
    : err.message);
  process.exit(1);
});

async function shutdown() {
  server.close();
  await closePool().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
