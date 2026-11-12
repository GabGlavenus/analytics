import { resolvePeriod, ValidationError } from './period.service.js';
import { buildReviewFilter } from '../repositories/analystReview.repository.js';

const MAX_SEARCH = 100;

/**
 * Valida os filtros da tela "Análises por analista" e devolve o WHERE do SQL.
 * Período em dias do fuso da aplicação ('YYYY-MM-DD', ambos inclusivos).
 */
export function reviewFilter({ inicio, fim, analista, busca } = {}) {
  const period = resolvePeriod({ preset: 'custom', startDate: inicio, endDate: fim });

  let analystId;
  if (analista !== undefined && analista !== '') {
    analystId = Number(analista);
    if (!Number.isSafeInteger(analystId) || analystId <= 0) throw new ValidationError('Analista inválida.');
  }

  const search = String(busca ?? '').trim().slice(0, MAX_SEARCH);
  return buildReviewFilter({ dbFrom: period.dbFrom, dbToExclusive: period.dbToExclusive, analystId, search });
}
