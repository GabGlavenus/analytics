import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, rankAnalysts, summarize } from '../src/services/analysis.service.js';
import { resolvePeriod } from '../src/services/period.service.js';
import { subtractMonths, parseIsoDate, toIsoDate, dbDateToMs, shiftTimezone, todayIn } from '../src/utils/dates.js';
import { sanitizeRanking, sanitizeRows, toCsv, toXlsx } from '../src/exporters/index.js';

const lead = (over) => ({ leadCode: 'L2026B9ZE', signedAt: null, exportedAt: null, sentCount: 0, signedCount: 0, ...over });
const signed = (signedAt, exportedAt, over) => lead({ signedAt, exportedAt, sentCount: 1, signedCount: 1, ...over });

test('exportado após a assinatura: tempo positivo em dias e horas', () => {
  const r = classify(signed('2026-10-01 10:00:00', '2026-10-04 22:00:00'));
  assert.equal(r.status, 'APOS');
  assert.equal(r.intervalDays, 3.5);
  assert.equal(r.intervalHours, 84);
});

test('exportado antes da assinatura (novo contrato depois da exportação): tempo negativo', () => {
  const r = classify(signed('2026-10-10 00:00:00', '2026-10-08 00:00:00', { sentCount: 2, signedCount: 2 }));
  assert.equal(r.status, 'ANTES');
  assert.equal(r.intervalDays, -2);
  assert.equal(r.intervalHours, -48);
});

test('tempo arredondado nunca vira -0', () => {
  const r = classify(signed('2026-10-10 10:00:00', '2026-10-10 09:59:59'));
  assert.equal(r.status, 'ANTES');
  assert.ok(Object.is(r.intervalDays, 0));
  assert.ok(Object.is(r.intervalHours, 0));
});

test('dados incompletos', () => {
  assert.equal(classify(lead({ exportedAt: '2026-10-01 10:00:00' })).status, 'SEM_CONTRATO');
  assert.equal(classify(lead({ exportedAt: '2026-10-01 10:00:00', sentCount: 2, signedCount: 1 })).status, 'AGUARDANDO');
  assert.equal(classify(signed('2026-10-01 10:00:00', null)).status, 'SEM_EXPORTACAO');
  const zero = classify(signed('2026-10-01 10:00:00', '0000-00-00 00:00:00'));
  assert.equal(zero.status, 'SEM_EXPORTACAO');
  assert.equal(zero.exportedAt, null);
});

test('resumo: contagens, médias gerais e só dos exportados após a assinatura', () => {
  const rows = [
    signed('2026-10-01 00:00:00', '2026-10-02 00:00:00'), // +24h
    signed('2026-10-01 00:00:00', '2026-10-04 00:00:00', { sentCount: 3, signedCount: 2 }), // +72h
    signed('2026-10-05 00:00:00', '2026-10-04 12:00:00'), // -12h
    lead({ exportedAt: '2026-10-01 00:00:00', sentCount: 1 }), // aguardando
  ].map(classify);
  const s = summarize(rows);
  assert.equal(s.leadsAnalisados, 4);
  assert.equal(s.comparados, 3);
  assert.equal(s.leadsComAssinatura, 3);
  assert.equal(s.contratosAssinados, 4);
  assert.equal(s.semCorrespondencia, 1);
  assert.equal(s.mediaHoras, 28); // (24 + 72 - 12) / 3
  assert.equal(s.mediaDias, 1.2);
  assert.equal(s.medianaHoras, 24);
  assert.equal(s.mediaHorasAposAssinatura, 48); // (24 + 72) / 2
  assert.equal(s.mediaDiasAposAssinatura, 2);
  assert.equal(s.porStatus.ANTES, 1);
});

test('analista: nome no resultado e "Sem analista" quando ausente', () => {
  assert.equal(classify(signed('2026-10-01 10:00:00', null, { analystId: 7, analystName: 'Ana' })).analystName, 'Ana');
  const none = classify(signed('2026-10-01 10:00:00', null));
  assert.deepEqual([none.analystId, none.analystName], [null, 'Sem analista']);
});

test('ranking: ordena pelo maior tempo médio e só destaca com amostra mínima', () => {
  const mk = (analystId, analystName, hoursList, extra = []) => [
    ...hoursList.map((h) => signed('2026-10-01 00:00:00', shiftTimezone('2026-10-01 00:00:00', '+00:00', `+${String(h).padStart(2, '0')}:00`), { analystId, analystName })),
    ...extra.map((r) => ({ ...r, analystId, analystName })),
  ];
  const rows = [
    ...mk(1, 'Rápida', [1, 2, 3]),
    ...mk(2, 'Lenta', [10, 20, 30], [signed('2026-10-05 00:00:00', '2026-10-04 00:00:00'), signed('2026-10-05 00:00:00', null)]),
    ...mk(3, 'Poucos casos', [23]),
    ...mk(null, null, [22, 22, 22]),
  ].map(classify);

  const { analysts, slowest } = rankAnalysts(rows, 3);
  assert.deepEqual(analysts.map((a) => a.analystName), ['Poucos casos', 'Sem analista', 'Lenta', 'Rápida']);
  // "Poucos casos" tem só 1 lead e "Sem analista" não é uma pessoa: o destaque vai para "Lenta".
  assert.equal(slowest.analystName, 'Lenta');
  const lenta = analysts.find((a) => a.analystId === 2);
  assert.deepEqual(
    [lenta.leads, lenta.exportadosAposAssinatura, lenta.mediaHoras, lenta.medianaHoras, lenta.maxHoras, lenta.exportadosAntes, lenta.semExportacao],
    [5, 3, 20, 20, 30, 1, 1],
  );
  assert.equal(analysts.find((a) => a.analystId === 3).amostraSuficiente, false);
});

test('ranking: sem nenhuma analista com amostra suficiente não há destaque', () => {
  const rows = [classify(signed('2026-10-01 00:00:00', '2026-10-02 00:00:00', { analystId: 1, analystName: 'Ana' }))];
  assert.equal(rankAnalysts(rows, 10).slowest, null);
});

test('fuso: UTC do banco <-> horário de Brasília', () => {
  assert.equal(shiftTimezone('2026-11-05 20:11:04', '+00:00', '-03:00'), '2026-11-05 17:11:04');
  assert.equal(shiftTimezone('2026-01-01 01:30:00', '+00:00', '-03:00'), '2025-12-31 22:30:00');
  assert.equal(shiftTimezone('2026-09-05 00:00:00', '-03:00', '+00:00'), '2026-09-05 03:00:00');
  // 01:00 UTC do dia 6 ainda é dia 5 em Brasília
  assert.equal(toIsoDate(todayIn('-03:00', new Date('2026-11-06T01:00:00Z'))), '2026-11-05');
});

test('subtração de meses respeita fim de mês', () => {
  assert.equal(toIsoDate(subtractMonths(parseIsoDate('2026-03-31'), 1)), '2026-02-28');
  assert.equal(toIsoDate(subtractMonths(parseIsoDate('2026-11-05'), 2)), '2026-09-05');
  assert.equal(toIsoDate(subtractMonths(parseIsoDate('2026-01-15'), 12)), '2025-01-15');
});

test('período personalizado: intervalo semiaberto e validações', () => {
  const p = resolvePeriod({ preset: 'custom', startDate: '2026-09-01', endDate: '2026-10-31' });
  assert.equal(p.from, '2026-09-01 00:00:00');
  assert.equal(p.toExclusive, '2026-11-01 00:00:00');
  // limites enviados ao banco (UTC): meia-noite de Brasília = 03:00 UTC
  assert.equal(p.dbFrom, '2026-09-01 03:00:00');
  assert.equal(p.dbToExclusive, '2026-11-01 03:00:00');
  assert.throws(() => resolvePeriod({ preset: 'custom', startDate: '2026-10-31', endDate: '2026-09-01' }), /anterior/);
  assert.throws(() => resolvePeriod({ preset: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' }), /válidas/);
  assert.throws(() => resolvePeriod({ preset: "1' OR 1=1" }), /inválido/);
});

test('períodos pré-definidos terminam hoje', () => {
  for (const preset of ['30d', '2m', '3m', '6m', '12m']) {
    const p = resolvePeriod({ preset });
    assert.ok(p.startDate < p.endDate, preset);
    assert.ok(dbDateToMs(p.toExclusive) > Date.now() - 86_400_000 * 2, preset);
  }
  const d30 = resolvePeriod({ preset: '30d' });
  assert.equal((dbDateToMs(d30.toExclusive) - dbDateToMs(d30.from)) / 86_400_000, 30);
});

test('exportação CSV: pt-BR, BOM e proteção contra fórmulas', () => {
  const row = classify(signed('2026-10-01 10:00:00', '2026-10-04 22:00:00', { analystId: 1, analystName: 'Ana' }));
  const rows = sanitizeRows([{ ...row, leadCode: '=HYPERLINK("x")', extra: 'ignorado' }]);
  const csv = toCsv(rows);
  assert.ok(csv.startsWith('\uFEFF"Código do lead";"Analista";"Data de assinatura (último contrato)";'));
  assert.match(csv, /"'=HYPERLINK\(""x""\)";"Ana";"01\/10\/2026 10:00:00";"04\/10\/2026 22:00:00";3,5;84;"Exportado após a assinatura";1;1/);
  assert.ok(!csv.includes('ignorado'));
});

test('exportação XLSX: resultados, ranking por analista e parâmetros', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const rows = [classify(signed('2026-10-01 10:00:00', '2026-10-02 10:00:00', { analystId: 1, analystName: 'Ana' }))];
  const ranking = sanitizeRanking(rankAnalysts(rows, 1).analysts);
  const buf = await toXlsx(sanitizeRows(rows), { Período: 'teste' }, ranking);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resultados', 'Por analista', 'Parâmetros']);
  const r = wb.getWorksheet('Por analista').getRow(2).values.slice(1);
  assert.deepEqual(r.slice(0, 4), ['Ana', 1, 1, 24]);
  assert.throws(() => sanitizeRanking('x'), /lista/);
});
