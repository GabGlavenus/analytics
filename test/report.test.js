import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, medianCI, quantile, shareAtMost, upperFence } from '../public/js/stats.js';
import { buildReport } from '../public/js/report.js';

test('quantil com interpolação linear (igual ao QUARTIL.INC)', () => {
  const s = [1, 2, 3, 4];
  assert.equal(quantile(s, 0.5), 2.5);
  assert.equal(quantile(s, 0.25), 1.75);
  assert.equal(quantile([], 0.5), null);
});

test('estatística descritiva básica', () => {
  const d = describe([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(d.n, 8);
  assert.equal(d.mean, 5);
  assert.equal(d.median, 4.5);
  assert.ok(Math.abs(d.sd - 2.138) < 0.001);
  assert.equal(d.min, 2);
  assert.equal(d.max, 9);
  assert.equal(d.mad, 0.5);
  assert.ok(d.skew > 0);
  assert.deepEqual(describe([]), { n: 0 });
});

test('limite de outlier isola só o caso extremo de uma cauda longa', () => {
  const values = [10, 12, 20, 24, 26, 30, 30, 35, 40, 48, 60, 500];
  const fence = upperFence(values);
  assert.ok(fence > 60 && fence < 500, `limite ${fence}`);
  assert.equal(upperFence([1, 2, 3]), Infinity);
});

test('IC 95% da mediana usa as posições 2 e 9 para n = 10', () => {
  assert.deepEqual(medianCI([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [2, 9]);
  assert.equal(medianCI([1, 2, 3]), null);
});

test('fração dentro do prazo', () => {
  assert.equal(shareAtMost([10, 20, 30, 50], 24), 0.5);
  assert.equal(shareAtMost([], 24), null);
});

const row = (analystId, analystName, intervalHours, i, status = 'APOS') => ({
  leadCode: `L${analystId}${i}`, analystId, analystName, status, intervalHours,
  signedAt: `2026-10-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`,
});

test('relatório isola outliers e separa média bruta da mediana robusta', () => {
  const rows = [];
  // Ana: tempos típicos altos, sem extremos. Bia: tempos baixos e 3 casos extremos.
  for (let i = 0; i < 20; i += 1) rows.push(row(1, 'Ana', 40 + (i % 5), i));
  for (let i = 0; i < 20; i += 1) rows.push(row(2, 'Bia', 10 + (i % 5), i));
  for (let i = 0; i < 3; i += 1) rows.push(row(2, 'Bia', 900 + i, 100 + i));
  rows.push(row(1, 'Ana', -5, 200, 'ANTES'), row(1, 'Ana', null, 201, 'SEM_EXPORTACAO'));

  const text = buildReport(rows, { header: ['Período: teste'] });
  assert.match(text, /Período: teste/);
  assert.match(text, /45 leads no filtro atual; 43 exportados após a assinatura/);
  assert.match(text, /3 leads \(7,0%\) são outliers/);
  assert.match(text, /L2100/); // maior caso listado
  assert.match(text, /Pela média bruta, a mais lenta parece ser Bia; sem outliers e pela mediana, é Ana/);
  assert.match(text, /acima da equipe/);
  assert.match(text, /1 leads com contrato assinado ainda sem exportação/);
});

test('relatório com amostra pequena não calcula estatísticas', () => {
  const text = buildReport([row(1, 'Ana', 10, 1), row(1, 'Ana', 12, 2)]);
  assert.match(text, /Amostra insuficiente/);
  assert.doesNotMatch(text, /ESTATÍSTICA DESCRITIVA/);
});
