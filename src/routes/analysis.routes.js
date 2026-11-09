import { Router } from 'express';
import { DEFAULTS, NO_ANALYST, NO_ANALYST_LABEL, runAnalysis, STATUS } from '../services/analysis.service.js';
import { PRESETS, resolvePeriod } from '../services/period.service.js';
import {
  EXPORT_SOURCES, findAnalysts, PERIOD_BASES, SIGNATURE_CHOICES,
} from '../repositories/leadContract.repository.js';
import { sanitizeRanking, sanitizeReport, sanitizeRows, toCsv, toXlsx } from '../exporters/index.js';

export const router = Router();

const str = (v) => (typeof v === 'string' && v !== '' ? v : undefined);
const toOptions = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
const safeMeta = (meta) => (meta && typeof meta === 'object'
  ? Object.fromEntries(Object.entries(meta).slice(0, 20).map(([k, v]) => [String(k).slice(0, 60), String(v ?? '').slice(0, 200)]))
  : {});
const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

/** Opções para montar a interface (com as datas que cada período pré-definido cobre hoje). */
router.get('/options', async (_req, res) => {
  const analysts = await findAnalysts();
  res.json({
    presets: Object.entries(PRESETS).map(([value, p]) => {
      const dates = value === 'custom' ? {} : resolvePeriod({ preset: value });
      return { value, label: p.label, startDate: dates.startDate, endDate: dates.endDate };
    }),
    bases: toOptions(PERIOD_BASES),
    exportSources: toOptions(EXPORT_SOURCES),
    signatureChoices: toOptions(SIGNATURE_CHOICES),
    analysts: [
      ...analysts.map((a) => ({ value: String(a.id), label: a.name })),
      { value: NO_ANALYST, label: NO_ANALYST_LABEL },
    ],
    statuses: toOptions(STATUS),
    defaults: DEFAULTS,
  });
});

/**
 * GET /api/analysis?preset=2m
 *     /api/analysis?preset=custom&startDate=2026-01-01&endDate=2026-03-31
 * Opcionais: basis=qualquer|assinatura|exportacao, exportSource=associado|veiculo,
 *            signatureChoice=ultimo_assinado|ultimo_enviado, analyst=<id do usuário>|sem
 */
router.get('/analysis', async (req, res) => {
  const q = req.query;
  res.json(await runAnalysis({
    preset: str(q.preset),
    startDate: str(q.startDate),
    endDate: str(q.endDate),
    basis: str(q.basis),
    exportSource: str(q.exportSource),
    signatureChoice: str(q.signatureChoice),
    analyst: str(q.analyst),
  }));
});

// A exportação recebe as linhas exatamente como estão na tela (já filtradas e
// ordenadas), para que o arquivo corresponda ao que o usuário está vendo.
router.post('/export/csv', (req, res) => {
  const rows = sanitizeRows(req.body?.rows);
  res.attachment(`assinatura-x-exportacao-${fileStamp()}.csv`).type('text/csv; charset=utf-8').send(toCsv(rows));
});

router.post('/export/xlsx', async (req, res) => {
  const rows = sanitizeRows(req.body?.rows);
  const ranking = sanitizeRanking(req.body?.ranking);
  const buffer = await toXlsx(rows, safeMeta(req.body?.meta), ranking, sanitizeReport(req.body?.report));
  res.attachment(`assinatura-x-exportacao-${fileStamp()}.xlsx`)
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .send(Buffer.from(buffer));
});
