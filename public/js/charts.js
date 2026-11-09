// Gráficos do relatório em SVG puro (sem biblioteca), gerados como texto a
// partir de analyze(). Cores vêm das classes CSS (.chart-*), que seguem o tema
// claro/escuro. Cada marca tem <title> como dica ao passar o mouse.

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const intf = new Intl.NumberFormat('pt-BR');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NICE_STEPS = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168, 336, 720];
const niceStep = (raw) => NICE_STEPS.find((s) => s >= raw) ?? Math.ceil(raw / 720) * 720;
// Passos para contagens: 1, 2, 5 × 10^k.
const niceCount = (raw) => {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
};

// Barra com as pontas de cima arredondadas (4px) e a base reta, apoiada no eixo.
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Histograma do tempo até exportar, com os outliers numa barra separada à direita. */
export function histogramSvg(a) {
  if (!a.enough) return '';
  const W = 760;
  const H = 260;
  const M = { top: 28, right: 16, bottom: 40, left: 44 };
  const step = niceStep(a.fence / 12);
  const nBins = Math.max(1, Math.ceil(a.fence / step));
  const bins = Array.from({ length: nBins }, () => 0);
  for (const r of a.after) if (r.intervalHours <= a.fence) bins[Math.min(nBins - 1, Math.floor(r.intervalHours / step))] += 1;
  const counts = [...bins, a.outliers.length];
  const maxCount = Math.max(...counts, 1);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const slot = plotW / (nBins + 1.5); // meia vaga de folga antes da barra de outliers
  const y = (c) => M.top + plotH - (c / maxCount) * plotH;
  const xHours = (h) => M.left + (h / (nBins * step)) * nBins * slot;
  const total = a.after.length;
  const out = [];

  const yStep = niceCount(maxCount / 4);
  for (let v = 0; v <= maxCount; v += yStep) {
    out.push(`<line class="chart-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(v)}" y2="${y(v)}"/>`,
      `<text class="chart-axis" x="${M.left - 6}" y="${y(v) + 4}" text-anchor="end">${intf.format(v)}</text>`);
  }
  bins.forEach((c, i) => {
    const x = M.left + i * slot + 1;
    const from = i * step;
    const to = i === nBins - 1 ? a.fence : (i + 1) * step;
    out.push(`<path class="chart-bar" d="${barPath(x, y(c), slot - 2, Math.max(0, M.top + plotH - y(c)))}">`
      + `<title>${nf.format(from)}–${nf.format(to)} h: ${intf.format(c)} leads (${nf.format((c / total) * 100)}%)</title></path>`);
  });
  const labelEvery = Math.ceil(nBins / 8);
  for (let i = 0; i <= nBins; i += labelEvery) {
    out.push(`<text class="chart-axis" x="${M.left + i * slot}" y="${M.top + plotH + 16}" text-anchor="middle">${nf.format(i * step)}</text>`);
  }
  const ox = M.left + (nBins + 0.5) * slot + 1;
  const oc = a.outliers.length;
  out.push(`<path class="chart-bar-out" d="${barPath(ox, y(oc), slot - 2, Math.max(0, M.top + plotH - y(oc)))}">`
    + `<title>Outliers (acima de ${nf.format(a.fence)} h): ${intf.format(oc)} leads (${nf.format(a.outShare * 100)}%)</title></path>`,
  `<text class="chart-axis" x="${ox + (slot - 2) / 2}" y="${M.top + plotH + 16}" text-anchor="middle">outliers</text>`,
  `<text class="chart-label" x="${ox + (slot - 2) / 2}" y="${y(oc) - 6}" text-anchor="middle">${intf.format(oc)}</text>`);

  // Linhas de referência: mediana e média sem outliers.
  const refs = [['mediana', a.clean.median], ['média s/ outliers', a.clean.mean]];
  refs.forEach(([label, h], i) => {
    const x = xHours(h);
    out.push(`<line class="chart-ref${i ? ' chart-ref-alt' : ''}" x1="${x}" x2="${x}" y1="${M.top - 4}" y2="${M.top + plotH}"/>`,
      `<text class="chart-label" x="${x + 4}" y="${M.top + 8 + i * 14}">${label} ${nf.format(h)} h</text>`);
  });
  out.push(`<line class="chart-baseline" x1="${M.left}" x2="${W - M.right}" y1="${M.top + plotH}" y2="${M.top + plotH}"/>`,
    `<text class="chart-axis" x="${M.left + plotW / 2}" y="${H - 6}" text-anchor="middle">horas entre a assinatura e a exportação</text>`,
    `<text class="chart-axis" x="${M.left}" y="14">leads</text>`);

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histograma do tempo até exportar: mediana ${nf.format(a.clean.median)} horas sem outliers, ${intf.format(oc)} outliers">${out.join('')}</svg>`;
}

/** Boxplot por analista (sem outliers), com a mediana da equipe como referência. */
export function boxplotSvg(a, minLeads = 4) {
  if (!a.enough) return '';
  const list = a.analysts.filter((s) => s.clean.n >= minLeads);
  if (list.length < 2) return '';
  const rowH = 30;
  const M = { top: 30, right: 110, bottom: 34, left: 170 };
  const W = 760;
  const H = M.top + list.length * rowH + M.bottom;
  const max = Math.max(...list.map((s) => s.clean.max), a.clean.median);
  const step = niceStep(max / 6);
  const top = Math.ceil(max / step) * step;
  const plotW = W - M.left - M.right;
  const x = (h) => M.left + (h / top) * plotW;
  const out = [];

  for (let v = 0; v <= top; v += step) {
    out.push(`<line class="chart-grid" x1="${x(v)}" x2="${x(v)}" y1="${M.top - 6}" y2="${H - M.bottom}"/>`,
      `<text class="chart-axis" x="${x(v)}" y="${H - M.bottom + 16}" text-anchor="middle">${nf.format(v)}</text>`);
  }
  list.forEach((s, i) => {
    const c = s.clean;
    const cy = M.top + i * rowH + rowH / 2;
    const name = s.name.length > 24 ? `${s.name.slice(0, 23)}…` : s.name;
    out.push(`<g class="chart-row"><title>${esc(s.name)}: mediana ${nf.format(c.median)} h · P25 ${nf.format(c.p25)} h · P75 ${nf.format(c.p75)} h`
      + ` · ${intf.format(c.n)} leads sem outliers · ${intf.format(s.outliers)} outliers · ${esc(s.verdict)}</title>`
      + `<rect class="chart-hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}"/>`
      + `<text class="chart-name" x="${M.left - 10}" y="${cy + 4}" text-anchor="end">${esc(name)}</text>`
      + `<line class="chart-whisker" x1="${x(c.min)}" x2="${x(c.max)}" y1="${cy}" y2="${cy}"/>`
      + `<rect class="chart-box" x="${x(c.p25)}" y="${cy - 8}" width="${Math.max(2, x(c.p75) - x(c.p25))}" height="16" rx="3"/>`
      + `<line class="chart-median" x1="${x(c.median)}" x2="${x(c.median)}" y1="${cy - 8}" y2="${cy + 8}"/>`
      + `<text class="chart-label" x="${W - M.right + 8}" y="${cy + 4}">${s.outliers ? `+${intf.format(s.outliers)} outliers` : 'sem outliers'}</text></g>`);
  });
  const tx = x(a.clean.median);
  out.push(`<line class="chart-ref" x1="${tx}" x2="${tx}" y1="${M.top - 10}" y2="${H - M.bottom}"/>`,
    `<text class="chart-label" x="${tx + 4}" y="${M.top - 14}">mediana da equipe ${nf.format(a.clean.median)} h</text>`,
    `<text class="chart-axis" x="${M.left + plotW / 2}" y="${H - 4}" text-anchor="middle">horas (caixa = P25 a P75, traço = mediana, linha = mínimo a máximo sem outliers)</text>`);

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Boxplot do tempo até exportar por analista, sem outliers">${out.join('')}</svg>`;
}
