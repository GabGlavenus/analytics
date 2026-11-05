import {
  EXPORT_SOURCES, findLeadSignatureAndExport, PERIOD_BASES, SIGNATURE_CHOICES,
} from '../repositories/leadContract.repository.js';
import { dbDateToMs, DAY_IN_MS } from '../utils/dates.js';
import { resolvePeriod, ValidationError } from './period.service.js';

export const STATUS = Object.freeze({
  APOS: 'Exportado após a assinatura',
  ANTES: 'Exportado antes da assinatura',
  SIMULTANEO: 'Exportado no mesmo momento da assinatura',
  AGUARDANDO: 'Contrato enviado, aguardando assinatura',
  SEM_CONTRATO: 'Sem contrato enviado',
  SEM_EXPORTACAO: 'Sem exportação',
});

const NO_MATCH = ['AGUARDANDO', 'SEM_CONTRATO', 'SEM_EXPORTACAO'];

export const DEFAULTS = Object.freeze({ basis: 'qualquer', exportSource: 'associado', signatureChoice: 'ultimo_assinado' });

const HOUR_MS = 3_600_000;
const round1 = (n) => Math.round(n * 10) / 10 || 0; // "|| 0" evita -0
const validDate = (v) => (dbDateToMs(v) === null ? null : v);

/**
 * Compara as datas de UM lead. Intervalo = exportação − assinatura:
 * positivo quando o lead foi exportado depois da assinatura, negativo antes.
 */
export function classify(row) {
  const signedAt = validDate(row.signedAt);
  const exportedAt = validDate(row.exportedAt);
  const signedMs = dbDateToMs(signedAt);
  const exportedMs = dbDateToMs(exportedAt);
  const sentCount = Number(row.sentCount) || 0;

  let status;
  let intervalDays = null;
  let intervalHours = null;
  if (signedMs === null) status = sentCount > 0 ? 'AGUARDANDO' : 'SEM_CONTRATO';
  else if (exportedMs === null) status = 'SEM_EXPORTACAO';
  else {
    const diff = exportedMs - signedMs;
    intervalDays = round1(diff / DAY_IN_MS);
    intervalHours = round1(diff / HOUR_MS);
    status = diff > 0 ? 'APOS' : diff < 0 ? 'ANTES' : 'SIMULTANEO';
  }

  return {
    leadCode: row.leadCode,
    analystId: row.analystId ?? null,
    analystName: row.analystName || NO_ANALYST_LABEL,
    signedAt,
    exportedAt,
    intervalDays,
    intervalHours,
    status,
    statusLabel: STATUS[status],
    signedCount: Number(row.signedCount) || 0,
    sentCount,
  };
}

export const NO_ANALYST = 'sem';
export const NO_ANALYST_LABEL = 'Sem analista';
// Mínimo de leads exportados após a assinatura para uma analista concorrer ao
// destaque de "mais demora" (evita que 1 ou 2 casos isolados definam o ranking).
export const MIN_SAMPLE = 10;

/**
 * Tempo assinatura → exportação por analista (somente leads exportados após a
 * assinatura), ordenado do maior para o menor tempo médio.
 */
export function rankAnalysts(rows, minSample = MIN_SAMPLE) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.analystId ?? NO_ANALYST;
    if (!groups.has(key)) groups.set(key, { analystId: r.analystId ?? null, analystName: r.analystName, rows: [] });
    groups.get(key).rows.push(r);
  }

  const analysts = [...groups.values()].map(({ analystId, analystName, rows: list }) => {
    const hours = list.filter((r) => r.status === 'APOS').map((r) => r.intervalHours).sort((a, b) => a - b);
    const count = (st) => list.filter((r) => r.status === st).length;
    const mean = hours.length ? hours.reduce((s, v) => s + v, 0) / hours.length : null;
    return {
      analystId,
      analystName,
      leads: list.length,
      exportadosAposAssinatura: hours.length,
      mediaHoras: mean === null ? null : round1(mean),
      medianaHoras: hours.length ? round1(median(hours)) : null,
      maxHoras: hours.length ? hours.at(-1) : null,
      exportadosAntes: count('ANTES'),
      semExportacao: count('SEM_EXPORTACAO'),
      amostraSuficiente: hours.length >= minSample,
    };
  });

  analysts.sort((a, b) => (b.mediaHoras ?? -Infinity) - (a.mediaHoras ?? -Infinity)
    || b.exportadosAposAssinatura - a.exportadosAposAssinatura);
  const slowest = analysts.find((a) => a.analystId !== null && a.amostraSuficiente) ?? null;
  return { analysts, slowest, minSample };
}

/** Valor do filtro: '' (todas), 'sem' (sem analista) ou o id numérico. */
function parseAnalyst(value) {
  if (value === undefined || value === '') return null;
  if (value === NO_ANALYST) return NO_ANALYST;
  if (/^\d{1,9}$/.test(value)) return Number(value);
  throw new ValidationError(`Analista inválida: ${value}`);
}

const matchesAnalyst = (row, analyst) =>
  analyst === null || (analyst === NO_ANALYST ? row.analystId === null : row.analystId === analyst);

function median(sorted) {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarize(rows) {
  const byStatus = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
  for (const r of rows) byStatus[r.status] += 1;

  const compared = rows.filter((r) => r.intervalHours !== null);
  const hours = compared.map((r) => r.intervalHours).sort((a, b) => a - b);
  const after = compared.filter((r) => r.status === 'APOS').map((r) => r.intervalHours).sort((a, b) => a - b);
  const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);
  const toDays = (h) => (h === null ? null : round1(h / 24));
  const roundH = (h) => (h === null ? null : round1(h));

  return {
    leadsAnalisados: rows.length,
    comparados: compared.length,
    leadsComAssinatura: rows.filter((r) => r.signedAt).length,
    contratosAssinados: rows.reduce((s, r) => s + r.signedCount, 0),
    semCorrespondencia: NO_MATCH.reduce((s, k) => s + byStatus[k], 0),
    mediaDias: toDays(avg(hours)),
    mediaHoras: roundH(avg(hours)),
    medianaDias: toDays(median(hours)),
    medianaHoras: roundH(median(hours)),
    // Só os exportados depois da assinatura: o "tempo para exportar" propriamente dito.
    mediaDiasAposAssinatura: toDays(avg(after)),
    mediaHorasAposAssinatura: roundH(avg(after)),
    medianaHorasAposAssinatura: roundH(median(after)),
    minDias: hours.length ? toDays(hours[0]) : null,
    maxDias: hours.length ? toDays(hours.at(-1)) : null,
    porStatus: byStatus,
  };
}

function pick(name, value, allowed) {
  const v = value ?? DEFAULTS[name];
  if (!Object.hasOwn(allowed, v)) throw new ValidationError(`Valor inválido para ${name}: ${v}`);
  return v;
}

/** Executa a análise completa para os parâmetros vindos da interface/API. */
export async function runAnalysis({ preset, startDate, endDate, basis, exportSource, signatureChoice, analyst } = {}) {
  const options = {
    basis: pick('basis', basis, PERIOD_BASES),
    exportSource: pick('exportSource', exportSource, EXPORT_SOURCES),
    signatureChoice: pick('signatureChoice', signatureChoice, SIGNATURE_CHOICES),
  };
  const analystFilter = parseAnalyst(analyst);
  const period = resolvePeriod({ preset, startDate, endDate });

  const raw = await findLeadSignatureAndExport({ dbFrom: period.dbFrom, dbToExclusive: period.dbToExclusive, ...options });
  const allRows = raw.map(classify);
  // O ranking compara todas as analistas do período; indicadores e tabela
  // respeitam o filtro de analista.
  const ranking = rankAnalysts(allRows);
  const rows = allRows.filter((r) => matchesAnalyst(r, analystFilter));
  const analystLabel = analystFilter === null ? 'Todas'
    : analystFilter === NO_ANALYST ? NO_ANALYST_LABEL
      : (ranking.analysts.find((a) => a.analystId === analystFilter)?.analystName ?? `#${analystFilter}`);

  return {
    ranking,
    period: {
      preset: period.preset,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
      ...options,
      analyst: analystFilter === null ? '' : String(analystFilter),
      analystLabel,
      basisLabel: PERIOD_BASES[options.basis],
      exportSourceLabel: EXPORT_SOURCES[options.exportSource],
      signatureChoiceLabel: SIGNATURE_CHOICES[options.signatureChoice],
    },
    summary: summarize(rows),
    rows,
    generatedAt: new Date().toISOString(),
  };
}
