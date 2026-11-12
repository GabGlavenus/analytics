import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { router as analysisRouter } from './routes/analysis.routes.js';
import { router as analystReviewRouter } from './routes/analystReview.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Acessado por http na rede local: sem upgrade-insecure-requests, o navegador
  // pediria CSS/JS por https e a página quebraria nos outros computadores.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(express.json({ limit: '50mb' }));

  app.use('/api/analises', analystReviewRouter);
  app.use('/api', analysisRouter);
  app.use(express.static(publicDir));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use(errorHandler);
  return app;
}
