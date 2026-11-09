// Estatística descritiva pura (sem DOM): usada pelo relatório no navegador e
// pelos testes em node.

export const sum = (values) => values.reduce((s, v) => s + v, 0);
export const mean = (values) => (values.length ? sum(values) / values.length : null);

/** Quantil com interpolação linear (mesmo método do QUARTIL.INC do Excel). Espera lista ordenada. */
export function quantile(sorted, p) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Resumo completo de uma lista de números. */
export function describe(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { n: 0 };
  const m = mean(s);
  const sd = n > 1 ? Math.sqrt(sum(s.map((v) => (v - m) ** 2)) / (n - 1)) : 0;
  const median = quantile(s, 0.5);
  const p25 = quantile(s, 0.25);
  const p75 = quantile(s, 0.75);
  const cut = Math.floor(n * 0.1);
  return {
    n,
    sum: sum(s),
    mean: m,
    sd,
    cv: m ? sd / m : null,
    min: s[0],
    p10: quantile(s, 0.1),
    p25,
    median,
    p75,
    p90: quantile(s, 0.9),
    p95: quantile(s, 0.95),
    max: s[n - 1],
    iqr: p75 - p25,
    // Desvio absoluto mediano: dispersão que não se deixa levar por casos extremos.
    mad: quantile(s.map((v) => Math.abs(v - median)).sort((a, b) => a - b), 0.5),
    // Média aparada 10%: descarta os 10% menores e os 10% maiores.
    trimmedMean: mean(s.slice(cut, n - cut)),
    // Assimetria amostral (> 0: cauda longa à direita).
    skew: n > 2 && sd > 0 ? (n / ((n - 1) * (n - 2))) * sum(s.map((v) => ((v - m) / sd) ** 3)) : 0,
  };
}

/**
 * Limite superior de outlier de Tukey (critério do boxplot): Q3 + k·IQR.
 * k = 1,5 marca outliers; k = 3, extremos. Com menos de 4 valores não há outlier.
 * Não usa escala log: os tempos são bimodais (muitos leads saem em minutos),
 * o que alarga o IQR em log e deixaria passar casos de dezenas de dias.
 */
export function upperFence(values, k = 1.5) {
  if (values.length < 4) return Infinity;
  const s = [...values].sort((a, b) => a - b);
  const q3 = quantile(s, 0.75);
  return q3 + k * (q3 - quantile(s, 0.25));
}

/**
 * Intervalo de confiança de 95% da mediana por estatísticas de ordem
 * (aproximação normal da binomial). Espera lista ordenada; null se n < 6.
 */
export function medianCI(sorted) {
  const n = sorted.length;
  if (n < 6) return null;
  const d = 0.98 * Math.sqrt(n); // 1,96 · √n / 2
  return [sorted[Math.max(0, Math.floor(n / 2 - d))], sorted[Math.min(n - 1, Math.ceil(n / 2 + d) - 1)]];
}

/** Fração dos valores menores ou iguais ao limite. */
export const shareAtMost = (values, limit) => (values.length ? values.filter((v) => v <= limit).length / values.length : null);
