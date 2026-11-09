// Relatório do tempo assinatura → exportação: estatística descritiva,
// isolamento de outliers, metas de prazo, comparação entre analistas e
// tendência. Puro (sem DOM), para ser testado em node.
// analyze() calcula; buildReport() escreve o texto; charts.js desenha.

import { describe, medianCI, shareAtMost, upperFence } from './stats.js';

export const MIN_SAMPLE = 10; // mesmo critério do ranking (MIN_SAMPLE em analysis.service.js)
export const DEFAULT_GOALS = [24, 48, 72];
const MAX_GOALS = 5;
const TOP_OUTLIERS = 10;
const TREND_MIN = 20; // leads para comparar as duas metades do período
const NAME_WIDTH = 24;
const HOUR_MS = 3_600_000;

const nf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const intf = new Intl.NumberFormat('pt-BR');
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (ok(v) ? nf.format(v) : '—');
const pct = (v) => (ok(v) ? `${nf.format(v * 100)}%` : '—');
const hrs = (v) => (ok(v) ? `${nf.format(v)} h${Math.abs(v) >= 24 ? ` (${nf.format(v / 24)} dias)` : ''}` : '—');
const day = (v) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '—');
const cut = (s, w) => (s.length > w ? `${s.slice(0, w - 1)}…` : s);
const kv = (label, value) => `  ${`${label} `.padEnd(30, '.')} ${value}`;
const sortedNums = (list) => [...list].sort((a, b) => a - b);
// Datas chegam como 'YYYY-MM-DD HH:MM:SS' (Brasília). Só diferenças importam, então o fuso local do parse não afeta.
const toMs = (v) => (v ? Date.parse(v.replace(' ', 'T')) : NaN);
// reduce em vez de Math.max(...lista): o spread estoura a pilha com listas muito grandes.
const maxMs = (values) => values.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), -Infinity);

/** Lê as metas digitadas ("24, 48, 72"). Devolve a lista ordenada ou null se inválida. */
export function parseGoals(text) {
  const parts = String(text ?? '').split(/[\s;,]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_GOALS) return null;
  const goals = parts.map(Number);
  if (goals.some((g) => !Number.isFinite(g) || g <= 0 || g > 10_000)) return null;
  return [...new Set(goals)].sort((a, b) => a - b);
}

function textTable(header, rows, alignRight) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => `  ${cells.map((c, i) => (alignRight[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ')}`.trimEnd();
  return [line(header), `  ${widths.map((w) => '-'.repeat(w)).join('  ')}`, ...rows.map(line)];
}

/** Estatísticas de uma analista: outliers pelo limite da equipe, robustas sem eles. */
function analystStats(list, fence, teamMedian, goals) {
  const hours = list.map((r) => r.intervalHours);
  const clean = sortedNums(hours.filter((h) => h <= fence));
  const c = describe(clean);
  const ci = medianCI(clean);
  let verdict = 'amostra pequena';
  if (clean.length >= MIN_SAMPLE && ci) {
    if (ci[0] > teamMedian) verdict = 'acima da equipe';
    else if (ci[1] < teamMedian) verdict = 'abaixo da equipe';
    else verdict = 'dentro do padrão';
  }
  return {
    analystId: list[0].analystId ?? null,
    name: list[0].analystName,
    n: list.length,
    outliers: list.length - clean.length,
    clean: c,
    ci,
    meanAll: describe(hours).mean,
    withinGoals: goals.map((g) => shareAtMost(hours, g)),
    verdict,
    eligible: clean.length >= MIN_SAMPLE && list[0].analystId != null,
  };
}

/**
 * Tendência entre as metades do período, corrigindo a censura à direita:
 * leads assinados no fim do período ainda podem não ter sido exportados.
 * Entram só os leads assinados até (referência − P90). Quem foi assinado antes
 * disso e segue sem exportação entra com o tempo já decorrido: é um limite
 * inferior acima da mediana, então não muda a posição dela.
 */
function trendOf(after, pending, all, fence) {
  const refMs = maxMs([...after, ...pending].flatMap((r) => [toMs(r.signedAt), toMs(r.exportedAt)]));
  const cutoffMs = refMs - all.p90 * HOUR_MS;
  const signedBefore = (r) => toMs(r.signedAt) <= cutoffMs;
  const afterIn = after.filter(signedBefore);
  const pendingIn = pending.filter(signedBefore).map((r) => ({ signedAt: r.signedAt, hours: (refMs - toMs(r.signedAt)) / HOUR_MS }));
  const points = [...afterIn.map((r) => ({ signedAt: r.signedAt, hours: r.intervalHours })), ...pendingIn]
    .filter((p) => p.hours <= fence)
    .sort((a, b) => a.signedAt.localeCompare(b.signedAt));
  if (points.length < TREND_MIN) return null;
  const half = Math.floor(points.length / 2);
  const first = points.slice(0, half);
  const second = points.slice(half);
  const m1 = describe(first.map((p) => p.hours)).median;
  const m2 = describe(second.map((p) => p.hours)).median;
  return {
    first: { from: first[0].signedAt, to: first.at(-1).signedAt, median: m1 },
    second: { from: second[0].signedAt, to: second.at(-1).signedAt, median: m2 },
    change: m1 > 0 ? m2 / m1 - 1 : 0,
    excludedRecent: after.length + pending.length - afterIn.length - pendingIn.length,
    pendingIncluded: pendingIn.filter((p) => p.hours <= fence).length,
  };
}

/** Calcula tudo o que o relatório e os gráficos mostram. */
export function analyze(rows, { goals = DEFAULT_GOALS } = {}) {
  const count = (st) => rows.filter((r) => r.status === st).length;
  const after = rows.filter((r) => r.status === 'APOS' && ok(r.intervalHours));
  const pending = rows.filter((r) => r.status === 'SEM_EXPORTACAO' && r.signedAt);
  const base = {
    goals,
    total: rows.length,
    after,
    outside: count('ANTES') + count('SIMULTANEO'),
    backlog: count('SEM_EXPORTACAO'),
    waiting: count('AGUARDANDO') + count('SEM_CONTRATO'),
    enough: after.length >= 4,
  };
  if (!base.enough) return base;

  const hours = after.map((r) => r.intervalHours);
  const all = describe(hours);
  const fence = upperFence(hours);
  const extremeFence = upperFence(hours, 3);
  const outliers = after.filter((r) => r.intervalHours > fence).sort((a, b) => b.intervalHours - a.intervalHours);
  const clean = describe(hours.filter((h) => h <= fence));

  const groups = new Map();
  for (const r of after) {
    const key = r.analystId ?? 'sem';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const analysts = [...groups.values()].map((list) => analystStats(list, fence, clean.median, goals))
    .sort((a, b) => (b.clean.median ?? -1) - (a.clean.median ?? -1) || b.n - a.n);

  // Pendentes assinados há mais tempo que o limite já são casos extremos, mesmo sem exportação.
  const refMs = maxMs(after.map((r) => toMs(r.exportedAt)));
  const stuck = pending.filter((r) => (refMs - toMs(r.signedAt)) / HOUR_MS > fence).length;

  return {
    ...base,
    all,
    fence,
    extremeFence,
    outliers,
    extremes: outliers.filter((r) => r.intervalHours > extremeFence).length,
    clean,
    outShare: outliers.length / after.length,
    outHoursShare: (all.sum - clean.sum) / all.sum,
    within: goals.map((g) => shareAtMost(hours, g)),
    analysts,
    stuck,
    trend: trendOf(after, pending, all, fence),
  };
}

/**
 * Monta o relatório em texto para as linhas recebidas (as da tela, já filtradas).
 * header: linhas de contexto (período, filtros) escritas logo após o título.
 */
export function buildReport(rows, { header = [], goals = DEFAULT_GOALS } = {}) {
  const a = analyze(rows, { goals });
  const L = ['RELATÓRIO — TEMPO ASSINATURA → EXPORTAÇÃO', ...header, ''];

  // 1. Base
  L.push('1. BASE DA ANÁLISE');
  L.push(`• ${intf.format(a.total)} leads no filtro atual; ${intf.format(a.after.length)} exportados após a assinatura entram nos cálculos.`);
  if (a.outside) L.push(`• ${intf.format(a.outside)} exportados antes ou no mesmo momento da assinatura ficam fora: não medem tempo de exportação.`);
  if (a.backlog) {
    L.push(`• ${intf.format(a.backlog)} leads com contrato assinado ainda sem exportação (pendência que não aparece nos tempos).`
      + (a.stuck ? ` Desses, ${intf.format(a.stuck)} já esperam mais que o limite de outlier (${hrs(a.fence)}).` : ''));
  }
  if (a.waiting) L.push(`• ${intf.format(a.waiting)} sem assinatura (aguardando ou sem contrato enviado).`);
  if (!a.enough) {
    L.push('', 'Amostra insuficiente: são necessários pelo menos 4 leads exportados após a assinatura.');
    return L.join('\n');
  }
  const { all, clean } = a;

  // 2. Descritiva
  L.push('', '2. ESTATÍSTICA DESCRITIVA (todos os exportados após a assinatura)');
  L.push(
    kv('Leads', intf.format(all.n)),
    kv('Média', hrs(all.mean)),
    kv('Mediana', hrs(all.median)),
    kv('Média aparada 10%', hrs(all.trimmedMean)),
    kv('Desvio padrão', hrs(all.sd)),
    kv('Coeficiente de variação', pct(all.cv)),
    kv('Desvio absoluto mediano', hrs(all.mad)),
    kv('Mínimo', hrs(all.min)),
    kv('P10', hrs(all.p10)),
    kv('P25 (1º quartil)', hrs(all.p25)),
    kv('P75 (3º quartil)', hrs(all.p75)),
    kv('P90', hrs(all.p90)),
    kv('P95', hrs(all.p95)),
    kv('Máximo', hrs(all.max)),
    kv('Intervalo interquartil', hrs(all.iqr)),
    kv('Assimetria', num(all.skew)),
  );
  L.push('');
  L.push(`• Metade dos leads é exportada em até ${hrs(all.median)}; 90% em até ${hrs(all.p90)}.`);
  if (all.median > 0 && all.mean > all.median * 1.1) {
    L.push(`• A média fica ${pct(all.mean / all.median - 1)} acima da mediana: distribuição com cauda longa à direita.`
      + ' Poucos casos muito demorados puxam a média para cima; a mediana representa melhor o lead típico.');
  }
  if (ok(all.cv)) {
    L.push(all.cv > 1 ? `• Variabilidade alta (CV ${pct(all.cv)}): o prazo é pouco previsível.`
      : all.cv > 0.5 ? `• Variabilidade moderada (CV ${pct(all.cv)}).`
        : `• Variabilidade baixa (CV ${pct(all.cv)}): o prazo é previsível.`);
  }

  // 3. Outliers
  L.push('', '3. OUTLIERS (casos extremos isolados)');
  L.push(`• Critério: tempo acima de ${hrs(a.fence)}, o limite de Tukey (Q3 + 1,5 × IQR, o mesmo do boxplot).`
    + ' Só a cauda superior é isolada: casos rápidos não inflam a média.');
  if (a.outliers.length === 0) {
    L.push('• Nenhum lead ultrapassa o limite. A média já é representativa.');
  } else {
    L.push(`• ${intf.format(a.outliers.length)} leads (${pct(a.outShare)}) são outliers e somam ${pct(a.outHoursShare)} de todas as horas de espera.`);
    if (a.extremes) L.push(`• Desses, ${intf.format(a.extremes)} são extremos (acima de ${hrs(a.extremeFence)}, Q3 + 3 × IQR).`);
    L.push('');
    L.push(...textTable(
      ['Medida', 'Com outliers', 'Sem outliers'],
      [
        ['Leads', intf.format(all.n), intf.format(clean.n)],
        ['Média', hrs(all.mean), hrs(clean.mean)],
        ['Mediana', hrs(all.median), hrs(clean.median)],
        ['Desvio padrão', hrs(all.sd), hrs(clean.sd)],
        ['P90', hrs(all.p90), hrs(clean.p90)],
        ['Máximo', hrs(all.max), hrs(clean.max)],
      ],
      [false, true, true],
    ));
    L.push('');
    L.push(`• Sem os outliers, a média cai ${pct(1 - clean.mean / all.mean)} (de ${hrs(all.mean)} para ${hrs(clean.mean)}).`);
    L.push(`• Maiores casos (${Math.min(TOP_OUTLIERS, a.outliers.length)} de ${intf.format(a.outliers.length)}). Vale verificar cada um individualmente:`);
    L.push(...textTable(
      ['Lead', 'Analista', 'Assinatura', 'Tempo'],
      a.outliers.slice(0, TOP_OUTLIERS).map((r) => [String(r.leadCode ?? '—'), cut(r.analystName, NAME_WIDTH), day(r.signedAt), hrs(r.intervalHours)]),
      [false, false, false, true],
    ));
  }

  // 4. Metas de prazo
  L.push('', '4. CUMPRIMENTO DE METAS (todos os exportados após a assinatura)');
  a.goals.forEach((g, i) => L.push(kv(`Até ${num(g)} h`, pct(a.within[i]))));

  // 5. Por analista
  if (a.analysts.length > 1) {
    L.push('', '5. POR ANALISTA (outliers isolados com o limite da equipe)');
    L.push(`  Mediana da equipe sem outliers: ${hrs(clean.median)}. "Leitura" compara o intervalo de 95% da mediana`
      + ` da analista com a da equipe. Abaixo de ${MIN_SAMPLE} leads sem outliers, a amostra é pequena demais para concluir.`);
    L.push('');
    L.push(...textTable(
      ['Analista', 'Leads', 'Outliers', 'Mediana s/ out.', 'IC 95% mediana', 'Média s/ out.', 'Média c/ out.',
        ...a.goals.map((g) => `Até ${num(g)} h`), 'Leitura'],
      a.analysts.map((s) => [
        cut(s.name, NAME_WIDTH), intf.format(s.n), intf.format(s.outliers), num(s.clean.median),
        s.ci ? `${num(s.ci[0])} – ${num(s.ci[1])}` : '—', num(s.clean.mean), num(s.meanAll),
        ...s.withinGoals.map(pct), s.verdict,
      ]),
      [false, true, true, true, true, true, true, ...a.goals.map(() => true), false],
    ));
    L.push('  (tempos em horas)');
  }

  // 6. Tendência
  const t = a.trend;
  if (t) {
    const word = Math.abs(t.change) < 0.1 ? 'estável' : t.change < 0 ? `melhora de ${pct(-t.change)}` : `piora de ${pct(t.change)}`;
    L.push('', '6. TENDÊNCIA (mediana sem outliers, pela data de assinatura)');
    L.push(kv(`1ª metade (${day(t.first.from)} a ${day(t.first.to)})`, hrs(t.first.median)));
    L.push(kv(`2ª metade (${day(t.second.from)} a ${day(t.second.to)})`, hrs(t.second.median)));
    L.push(`• Resultado: ${word} (variações abaixo de 10% são tratadas como estáveis).`);
    L.push(`• Para não favorecer o fim do período, ficam fora os ${intf.format(t.excludedRecent)} leads assinados nas últimas`
      + ` ${hrs(all.p90)} (P90), que ainda podem não ter sido exportados.`
      + (t.pendingIncluded ? ` ${intf.format(t.pendingIncluded)} leads anteriores ainda sem exportação entram com o tempo já decorrido.` : ''));
  }

  // 7. Conclusões
  L.push('', '7. CONCLUSÕES');
  if (a.outliers.length) {
    L.push(`• Referência realista: mediana de ${hrs(clean.median)} e média de ${hrs(clean.mean)} sem outliers,`
      + ` contra média bruta de ${hrs(all.mean)}.`);
    L.push(`• ${intf.format(a.outliers.length)} leads (${pct(a.outShare)}) concentram ${pct(a.outHoursShare)} das horas.`
      + ' Tratar esses casos um a um tende a trazer mais ganho do que cobrar a equipe toda.');
  } else {
    L.push(`• Referência: mediana de ${hrs(all.median)} e média de ${hrs(all.mean)}.`);
  }
  const eligible = a.analysts.filter((s) => s.eligible);
  if (eligible.length > 1) {
    const byMean = [...eligible].sort((x, y) => y.meanAll - x.meanAll)[0];
    const byMedian = eligible[0]; // já ordenado pela mediana sem outliers
    L.push(byMean.analystId === byMedian.analystId
      ? `• ${byMedian.name} é a mais lenta tanto pela média bruta quanto pela mediana sem outliers.`
      : `• Pela média bruta, a mais lenta parece ser ${byMean.name}; sem outliers e pela mediana, é ${byMedian.name}.`
        + ` A média de ${byMean.name} é mais afetada por casos demorados do que o tempo típico dela.`);
  }
  const above = a.analysts.filter((s) => s.verdict === 'acima da equipe').map((s) => s.name);
  const below = a.analysts.filter((s) => s.verdict === 'abaixo da equipe').map((s) => s.name);
  if (above.length) L.push(`• Tempo típico acima da equipe, com significância estatística: ${above.join(', ')}.`);
  if (below.length) L.push(`• Tempo típico abaixo da equipe, com significância estatística: ${below.join(', ')}.`);
  if (a.analysts.length > 1 && !above.length && !below.length) L.push('• Nenhuma analista se diferencia da equipe com significância estatística.');
  const concentrated = a.analysts.filter((s) => s.outliers >= 3 && s.outliers / s.n > 2 * a.outShare).map((s) => `${s.name} (${s.outliers})`);
  if (concentrated.length) L.push(`• Concentram outliers acima do dobro da taxa geral: ${concentrated.join(', ')}.`);

  return L.join('\n');
}
