import { createApp } from './app.js';
import { config } from './config/index.js';
import { closePool } from './db/pool.js';

const server = createApp().listen(config.server.port, config.server.host, () => {
  console.log(`Análise assinatura x exportação disponível em http://${config.server.host}:${config.server.port}`);
});

async function shutdown() {
  server.close();
  await closePool().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
