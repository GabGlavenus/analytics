import { config } from '../config/index.js';
import { addDays, parseIsoDate, shiftTimezone, subtractMonths, toIsoDate, todayIn } from '../utils/dates.js';

// Períodos pré-definidos. Para adicionar outro, basta incluir uma entrada.
export const PRESETS = Object.freeze({
  '30d': { label: 'Últimos 30 dias', start: (today) => addDays(today, -29) },
  '2m': { label: 'Últimos 2 meses', start: (today) => subtractMonths(today, 2) },
  '3m': { label: 'Últimos 3 meses', start: (today) => subtractMonths(today, 3) },
  '6m': { label: 'Últimos 6 meses', start: (today) => subtractMonths(today, 6) },
  '12m': { label: 'Últimos 12 meses', start: (today) => subtractMonths(today, 12) },
  custom: { label: 'Período personalizado' },
});

const MAX_RANGE_DAYS = 3660;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * Resolve o período pedido em um intervalo fechado [startDate, endDate] (datas
 * 'YYYY-MM-DD', no fuso da aplicação) e no intervalo semiaberto usado no SQL,
 * já convertido para o fuso em que o banco grava: >= dbFrom AND < dbToExclusive.
 */
export function resolvePeriod({ preset = '30d', startDate, endDate } = {}) {
  if (!Object.hasOwn(PRESETS, preset)) {
    throw new ValidationError(`Período inválido: ${preset}`);
  }

  let start;
  let end;
  if (preset === 'custom') {
    start = parseIsoDate(startDate);
    end = parseIsoDate(endDate);
    if (!start || !end) throw new ValidationError('Informe data inicial e final válidas (AAAA-MM-DD).');
    if (start > end) throw new ValidationError('A data inicial deve ser anterior ou igual à data final.');
  } else {
    end = todayIn(config.app.timezone);
    start = PRESETS[preset].start(end);
  }

  if ((end - start) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new ValidationError('Período máximo permitido: 10 anos.');
  }

  const from = `${toIsoDate(start)} 00:00:00`;
  const toExclusive = `${toIsoDate(addDays(end, 1))} 00:00:00`;
  return {
    preset,
    label: PRESETS[preset].label,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    from,
    toExclusive,
    dbFrom: shiftTimezone(from, config.app.timezone, config.db.timezone),
    dbToExclusive: shiftTimezone(toExclusive, config.app.timezone, config.db.timezone),
  };
}
