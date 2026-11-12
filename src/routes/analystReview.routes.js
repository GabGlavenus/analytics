import { Router } from 'express';
import { reviewFilter } from '../services/analystReview.service.js';
import {
  findReviewAnalysts, findReviewByCode, findReviews, summarizeReviews,
} from '../repositories/analystReview.repository.js';

// Rotas da tela "Análises por analista", montadas em /api/analises.
// Filtros: inicio=AAAA-MM-DD, fim=AAAA-MM-DD, analista=<id do usuário>, busca=<texto>
export const router = Router();

const str = (v) => (typeof v === 'string' ? v : undefined);
const filterFrom = (q) => reviewFilter({ inicio: str(q.inicio), fim: str(q.fim), analista: str(q.analista), busca: str(q.busca) });

router.get('/analistas', async (_req, res) => {
  res.json(await findReviewAnalysts());
});

router.get('/resumo', async (req, res) => {
  res.json(await summarizeReviews(filterFrom(req.query)));
});

router.get('/', async (req, res) => {
  res.json(await findReviews(filterFrom(req.query)));
});

router.get('/:codigo', async (req, res) => {
  const review = await findReviewByCode(req.params.codigo);
  if (!review) return res.status(404).json({ error: 'Análise não encontrada.' });
  res.json(review);
});
