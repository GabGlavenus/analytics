import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewFilter } from '../src/services/analystReview.service.js';
import { createApp } from '../src/app.js';

test('filtro de análises: período em Brasília convertido para UTC (fim inclusivo)', () => {
  const f = reviewFilter({ inicio: '2026-11-01', fim: '2026-11-10' });
  assert.deepEqual(f.params, ['2026-11-01 03:00:00', '2026-11-11 03:00:00']);
  assert.match(f.sql, /a\.status = 'CONCLUIDO'/);
  assert.doesNotMatch(f.sql, /usuarioId/);
});

test('filtro de análises: analista e busca viram parâmetros, nunca texto no SQL', () => {
  const f = reviewFilter({ inicio: '2026-11-01', fim: '2026-11-01', analista: '42', busca: " 123.456-78' " });
  assert.ok(f.sql.includes('a.usuarioId = ?'));
  assert.ok(!f.sql.includes('123'));
  assert.equal(f.params[2], 42);
  assert.ok(f.params.includes('%12345678%'), 'busca por CPF usa só os dígitos');
});

test('filtro de análises: busca curta não procura por CPF', () => {
  const f = reviewFilter({ inicio: '2026-11-01', fim: '2026-11-01', busca: 'ab1' });
  assert.ok(!f.sql.includes('l.cpf'));
});

test('filtro de análises: entradas inválidas geram erro 400', () => {
  const bad = [
    { inicio: '2026-11-10', fim: '2026-11-01' },
    { inicio: '01/11/2026', fim: '2026-11-01' },
    { fim: '2026-11-01' },
    { inicio: '2026-11-01', fim: '2026-11-01', analista: 'abc' },
    { inicio: '2026-11-01', fim: '2026-11-01', analista: '-3' },
  ];
  for (const q of bad) assert.throws(() => reviewFilter(q), (e) => e.status === 400, JSON.stringify(q));
});

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('API de análises valida os filtros antes de consultar o banco', async () => {
  await withServer(createApp(), async (base) => {
    const res = await fetch(`${base}/api/analises/resumo?inicio=2026-11-10&fim=2026-11-01`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /data inicial/);
  });
});

test('CSP não força https (o sistema é acessado por http na rede local)', async () => {
  await withServer(createApp(), async (base) => {
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  });
});
