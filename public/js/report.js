// Relatório em texto do tempo assinatura → exportação: estatística descritiva,
// isolamento de outliers, metas de prazo, comparação entre analistas e
// tendência. Puro (sem DOM), para ser testado em node.

import { describe, medianCI, shareAtMost, upperFence } from './stats.js';

export const MIN_SAMPLE = 10; // mesmo critério do ranking (MIN_SAMPLE em analysis.service.js)
export const SLA_HOURS = [24, 48, 72];
const TOP_OUTLIERS = 10;
const TREND_MIN = 20; // leads sem outliers para comparar as duas metades do período
const NAME_WIDTH = 24;

const nf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const intf = new Intl.NumberFormat('pt-BR');
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (ok(v) ? nf.format(v) : '—');
const pct = (v) => (ok(v) ? `${nf.format(v * 100)}%` : '—');
const hrs = (v) => (ok(v) ? `${nf.format(v)} h${Math.abs(v) >= 24 ? ` (${nf.format(v / 24)} dias)` : ''}` : '—');
const day = (v) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '—');
const cut = (s, w) => (s.length > w ? `${s.slice(0, w - 1)}…` : s);
const kv = (label, value) => `  ${`${label} `.padEnd(30, '.')} ${value}`;
const sortedHours = (list) => list.map((r) => r.intervalHours).sort((a, b) => a - b);

function textTable(header, rows, alignRight) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => `  ${cells.map((c, i) => (alignRight[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ')}`.trimEnd();
  return [line(header), `  ${widths.map((w) => '-'.repeat(w)).join('  ')}`, ...rows.map(line)];
}

/** Estatísticas de uma analista: outliers pelo limite da equipe, robustas sem eles. */
function analystStats(list, fence, teamMedian) {
  const clean = sortedHours(list.filter((r) => r.intervalHours <= fence));
  const all = describe(list.map((r) => r.intervalHours));
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
    medianClean: c.median ?? null,
    ci,
    meanAll: all.mean,
    meanClean: c.mean ?? null,
    within48: shareAtMost(list.map((r) => r.intervalHours), 48),
    verdict,
    eligible: clean.length >= MIN_SAMPLE && list[0].analystId != null,
  };
}

/**
 * Monta o relatório para as linhas recebidas (as que estão na tela, já filtradas).
 * header: linhas de contexto (período, filtros) escritas logo após o título.
 */
export function buildReport(rows, { header = [] } = {}) {
  const L = ['RELATÓRIO — TEMPO ASSINATURA → EXPORTAÇÃO', ...header, ''];
  const count = (st) => rows.filter((r) => r.status === st).length;
  const after = rows.filter((r) => r.status === 'APOS' && ok(r.intervalHours));

  // 1. Base
  L.push('1. BASE DA ANÁLISE');
  L.push(`- ${intf.format(rows.length)} leads no filtro atual; ${intf.format(after.length)} exportados após a assinatura entram nos cálculos.`);
  const outside = count('ANTES') + count('SIMULTANEO');
  if (outside) L.push(`- ${intf.format(outside)} exportados antes ou no mesmo momento da assinatura ficam fora: não medem tempo de exportação.`);
  const backlog = count('SEM_EXPORTACAO');
  if (backlog) L.push(`- ${intf.format(backlog)} leads com contrato assinado ainda sem exportação (pendência que não aparece nos tempos).`);
  const waiting = count('AGUARDANDO') + count('SEM_CONTRATO');
  if (waiting) L.push(`- ${intf.format(waiting)} sem assinatura (aguardando ou sem contrato enviado).`);
  if (after.length < 4) {
    L.push('', 'Amostra insuficiente: são necessários pelo menos 4 leads exportados após a assinatura.');
    return L.join('\n');
  }

  // 2. Descritiva
  const all = describe(after.map((r) => r.intervalHours));
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
  L.push(`- Metade dos leads é exportada em até ${hrs(all.median)}; 90% em até ${hrs(all.p90)}.`);
  if (all.median > 0 && all.mean > all.median * 1.1) {
    L.push(`- A média fica ${pct(all.mean / all.median - 1)} acima da mediana: distribuição com cauda longa à direita.`
      + ' Poucos casos muito demorados puxam a média para cima; a mediana representa melhor o lead típico.');
  }
  if (ok(all.cv)) {
    L.push(all.cv > 1 ? `- Variabilidade alta (CV ${pct(all.cv)}): o prazo é pouco previsível.`
      : all.cv > 0.5 ? `- Variabilidade moderada (CV ${pct(all.cv)}).`
        : `- Variabilidade baixa (CV ${pct(all.cv)}): o prazo é previsível.`);
  }

  // 3. Outliers
  const fence = upperFence(after.map((r) => r.intervalHours));
  const extremeFence = upperFence(after.map((r) => r.intervalHours), 3);
  const outliers = after.filter((r) => r.intervalHours > fence).sort((a, b) => b.intervalHours - a.intervalHours);
  const cleanRows = after.filter((r) => r.intervalHours <= fence);
  const clean = describe(cleanRows.map((r) => r.intervalHours));
  const outShare = outliers.length / after.length;
  const outHoursShare = (all.sum - clean.sum) / all.sum;
  L.push('', '3. OUTLIERS (casos extremos isolados)');
  L.push(`- Critério: tempo acima de ${hrs(fence)}, o limite de Tukey (Q3 + 1,5 × IQR, o mesmo do boxplot).`
    + ' Só a cauda superior é isolada: casos rápidos não inflam a média.');
  if (outliers.length === 0) {
    L.push('- Nenhum lead ultrapassa o limite. A média já é representativa.');
  } else {
    L.push(`- ${intf.format(outliers.length)} leads (${pct(outShare)}) são outliers e somam ${pct(outHoursShare)} de todas as horas de espera.`);
    const extremes = outliers.filter((r) => r.intervalHours > extremeFence).length;
    if (extremes) L.push(`- Desses, ${intf.format(extremes)} são extremos (acima de ${hrs(extremeFence)}, Q3 + 3 × IQR).`);
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
    L.push(`- Sem os outliers, a média cai ${pct(1 - clean.mean / all.mean)} (de ${hrs(all.mean)} para ${hrs(clean.mean)}).`);
    L.push(`- Maiores casos (${Math.min(TOP_OUTLIERS, outliers.length)} de ${intf.format(outliers.length)}). Vale verificar cada um individualmente:`);
    L.push(...textTable(
      ['Lead', 'Analista', 'Assinatura', 'Tempo'],
      outliers.slice(0, TOP_OUTLIERS).map((r) => [String(r.leadCode ?? '—'), cut(r.analystName, NAME_WIDTH), day(r.signedAt), hrs(r.intervalHours)]),
      [false, false, false, true],
    ));
  }

  // 4. Metas de prazo
  const hoursAll = after.map((r) => r.intervalHours);
  L.push('', '4. CUMPRIMENTO DE PRAZO (todos os exportados após a assinatura)');
  for (const limit of SLA_HOURS) L.push(kv(`Até ${limit} h`, pct(shareAtMost(hoursAll, limit))));

  // 5. Por analista
  const groups = new Map();
  for (const r of after) {
    const key = r.analystId ?? 'sem';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const analysts = [...groups.values()].map((list) => analystStats(list, fence, clean.median))
    .sort((a, b) => (b.medianClean ?? -1) - (a.medianClean ?? -1) || b.n - a.n);
  if (analysts.length > 1) {
    L.push('', '5. POR ANALISTA (outliers isolados com o limite da equipe)');
    L.push(`  Mediana da equipe sem outliers: ${hrs(clean.median)}. "Leitura" compara o intervalo de 95% da mediana`
      + ` da analista com a da equipe. Abaixo de ${MIN_SAMPLE} leads sem outliers, a amostra é pequena demais para concluir.`);
    L.push('');
    L.push(...textTable(
      ['Analista', 'Leads', 'Outliers', 'Mediana s/ out.', 'IC 95% mediana', 'Média s/ out.', 'Média c/ out.', 'Até 48 h', 'Leitura'],
      analysts.map((a) => [
        cut(a.name, NAME_WIDTH), intf.format(a.n), intf.format(a.outliers), num(a.medianClean),
        a.ci ? `${num(a.ci[0])} – ${num(a.ci[1])}` : '—', num(a.meanClean), num(a.meanAll), pct(a.within48), a.verdict,
      ]),
      [false, true, true, true, true, true, true, true, false],
    ));
    L.push('  (tempos em horas)');
  }

  // 6. Tendência
  const bySignature = [...cleanRows].sort((a, b) => String(a.signedAt).localeCompare(String(b.signedAt)));
  if (bySignature.length >= TREND_MIN) {
    const half = Math.floor(bySignature.length / 2);
    const first = bySignature.slice(0, half);
    const second = bySignature.slice(half);
    const m1 = describe(sortedHours(first)).median;
    const m2 = describe(sortedHours(second)).median;
    const change = m1 > 0 ? m2 / m1 - 1 : 0;
    const word = Math.abs(change) < 0.1 ? 'estável' : change < 0 ? `melhora de ${pct(-change)}` : `piora de ${pct(change)}`;
    L.push('', '6. TENDÊNCIA (mediana sem outliers, pela data de assinatura)');
    L.push(kv(`1ª metade (${day(first[0].signedAt)} a ${day(first.at(-1).signedAt)})`, hrs(m1)));
    L.push(kv(`2ª metade (${day(second[0].signedAt)} a ${day(second.at(-1).signedAt)})`, hrs(m2)));
    L.push(`- Resultado: ${word} (variações abaixo de 10% são tratadas como estáveis).`);
    if (backlog) L.push(`- Atenção: os ${intf.format(backlog)} leads assinados e ainda não exportados ficam fora; se forem recentes, favorecem a 2ª metade.`);
  }

  // 7. Conclusões
  L.push('', '7. CONCLUSÕES');
  if (!outliers.length) L.push(`- Referência: mediana de ${hrs(all.median)} e média de ${hrs(all.mean)}.`);
  if (outliers.length) {
    L.push(`- Referência realista: mediana de ${hrs(clean.median)} e média de ${hrs(clean.mean)} sem outliers,`
      + ` contra média bruta de ${hrs(all.mean)}.`);
    L.push(`- ${intf.format(outliers.length)} leads (${pct(outShare)}) concentram ${pct(outHoursShare)} das horas.`
      + ' Tratar esses casos um a um tende a trazer mais ganho do que cobrar a equipe toda.');
  }
  const eligible = analysts.filter((a) => a.eligible);
  if (eligible.length > 1) {
    const byMean = [...eligible].sort((a, b) => b.meanAll - a.meanAll)[0];
    const byMedian = eligible[0]; // já ordenado pela mediana sem outliers
    L.push(byMean.analystId === byMedian.analystId
      ? `- ${byMedian.name} é a mais lenta tanto pela média bruta quanto pela mediana sem outliers.`
      : `- Pela média bruta, a mais lenta parece ser ${byMean.name}; sem outliers e pela mediana, é ${byMedian.name}.`
        + ` A média de ${byMean.name} é mais afetada por casos demorados do que o tempo típico dela.`);
  }
  const above = analysts.filter((a) => a.verdict === 'acima da equipe').map((a) => a.name);
  const below = analysts.filter((a) => a.verdict === 'abaixo da equipe').map((a) => a.name);
  if (above.length) L.push(`- Tempo típico acima da equipe, com significância estatística: ${above.join(', ')}.`);
  if (below.length) L.push(`- Tempo típico abaixo da equipe, com significância estatística: ${below.join(', ')}.`);
  if (analysts.length > 1 && !above.length && !below.length) L.push('- Nenhuma analista se diferencia da equipe com significância estatística.');
  const concentrated = analysts.filter((a) => a.outliers >= 3 && a.outliers / a.n > 2 * outShare).map((a) => `${a.name} (${a.outliers})`);
  if (concentrated.length) L.push(`- Concentram outliers acima do dobro da taxa geral: ${concentrated.join(', ')}.`);

  return L.join('\n');
}
