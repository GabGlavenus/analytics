// Interface: consulta a API, aplica filtros/ordenação/paginação no navegador
// e envia as linhas visíveis (filtradas e ordenadas) para exportação.

const $ = (id) => document.getElementById(id);

const state = {
  result: null,
  view: [],
  sort: { key: 'signedAt', dir: 'desc' },
  page: 1,
  pageSize: 100,
  presets: [],
};

const numberFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat('pt-BR');

// 'YYYY-MM-DD HH:MM:SS' -> 'DD/MM/YYYY HH:MM'
const fmtDate = (v) => (v ? v.replace(/^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2}:\d{2})?.*$/, (_m, y, mo, d, hm) => `${d}/${mo}/${y}${hm ? ` ${hm}` : ''}`) : '—');
const fmtNum = (v) => (v === null || v === undefined ? '—' : numberFmt.format(v));
const plural = (v, word) => `${numberFmt.format(v)} ${word}${Math.abs(v) === 1 ? '' : 's'}`;

// Tempo com sentido explícito: "1,8 dias (43,5 h) depois" / "6,7 dias antes".
function durationText(days, hours, { direction = true } = {}) {
  if (days === null || days === undefined) return '—';
  if (hours === 0) return 'no mesmo momento';
  const abs = Math.abs(days) >= 1 ? `${plural(Math.abs(days), 'dia')} (${numberFmt.format(Math.abs(hours))} h)` : plural(Math.abs(hours), 'hora');
  return direction ? `${abs} ${hours < 0 ? 'antes' : 'depois'}` : abs;
}

// Horas com equivalente em dias quando passa de 1 dia: "63,2 h (2,6 dias)".
const hoursText = (h) => {
  if (h === null || h === undefined) return '—';
  const base = `${numberFmt.format(h)} h`;
  return Math.abs(h) >= 24 ? `${base} (${plural(h / 24, 'dia')})` : base;
};

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Falha na requisição (${res.status}).`);
  }
  return res;
}

function showError(message) {
  $('error').textContent = message ?? '';
  $('error').hidden = !message;
}

// ---------- Período e opções ----------

function fillSelect(select, items) {
  for (const { value, label } of items) select.add(new Option(label, value));
}

function applyPresetDates() {
  const preset = state.presets.find((p) => p.value === $('preset').value);
  if (preset?.startDate) {
    $('startDate').value = preset.startDate;
    $('endDate').value = preset.endDate;
  }
}

async function loadOptions() {
  const opts = await (await api('/options')).json();
  state.presets = opts.presets;
  fillSelect($('preset'), opts.presets);
  fillSelect($('basis'), opts.bases);
  fillSelect($('signatureChoice'), opts.signatureChoices);
  fillSelect($('exportSource'), opts.exportSources);
  fillSelect($('analyst'), opts.analysts);
  fillSelect($('f-status'), opts.statuses);
  for (const [name, value] of Object.entries(opts.defaults)) $(name).value = value;
  $('preset').value = '2m';
  applyPresetDates();
}

$('preset').addEventListener('change', applyPresetDates);
// Trocar a analista com um resultado na tela refaz a consulta automaticamente.
$('analyst').addEventListener('change', () => { if (state.result) $('period-form').requestSubmit(); });
for (const id of ['startDate', 'endDate']) {
  // Editar uma data manualmente transforma a seleção em período personalizado.
  $(id).addEventListener('input', () => { $('preset').value = 'custom'; });
}

$('period-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  showError(null);
  const params = new URLSearchParams({
    preset: $('preset').value,
    basis: $('basis').value,
    signatureChoice: $('signatureChoice').value,
    exportSource: $('exportSource').value,
  });
  if ($('analyst').value) params.set('analyst', $('analyst').value);
  if ($('preset').value === 'custom') {
    params.set('startDate', $('startDate').value);
    params.set('endDate', $('endDate').value);
  }

  $('run-btn').disabled = true;
  $('run-btn').textContent = 'Consultando…';
  try {
    state.result = await (await api(`/analysis?${params}`)).json();
    $('startDate').value = state.result.period.startDate;
    $('endDate').value = state.result.period.endDate;
    state.page = 1;
    renderSummary();
    renderRanking();
    refresh();
  } catch (err) {
    showError(err.message);
  } finally {
    $('run-btn').disabled = false;
    $('run-btn').textContent = 'Consultar';
  }
});

// ---------- Indicadores ----------

function renderSummary() {
  const { summary: s, period: p } = state.result;
  $('period-info').textContent =
    `${p.label}: ${fmtDate(p.startDate)} a ${fmtDate(p.endDate)} · ${p.basisLabel} · ${p.signatureChoiceLabel} · ${p.exportSourceLabel}` +
    ` · Analista: ${p.analystLabel}` +
    ` · consultado em ${new Date(state.result.generatedAt).toLocaleString('pt-BR')}`;

  const st = s.porStatus;
  $('kpi-leads').textContent = intFmt.format(s.leadsAnalisados);
  $('kpi-leads-sub').textContent = `${intFmt.format(s.comparados)} com assinatura e exportação`;
  $('kpi-signed').textContent = intFmt.format(s.contratosAssinados);
  $('kpi-signed-sub').textContent = `${intFmt.format(s.leadsComAssinatura)} leads com contrato assinado`;
  $('kpi-nomatch').textContent = intFmt.format(s.semCorrespondencia);
  $('kpi-nomatch-sub').textContent =
    `${intFmt.format(st.SEM_EXPORTACAO)} sem exportação · ${intFmt.format(st.AGUARDANDO)} aguardando assinatura · ${intFmt.format(st.SEM_CONTRATO)} sem contrato`;

  // Indicador principal: quanto tempo levou para exportar DEPOIS da assinatura.
  $('kpi-avg').textContent = durationText(s.mediaDiasAposAssinatura, s.mediaHorasAposAssinatura, { direction: false });
  $('kpi-avg-sub').textContent = st.APOS
    ? `mediana ${numberFmt.format(s.medianaHorasAposAssinatura)} h · ${intFmt.format(st.APOS)} exportados após a assinatura` +
      (st.ANTES ? ` · ${intFmt.format(st.ANTES)} já exportados antes (fora da média)` : '')
    : 'nenhum lead exportado após a assinatura';

  const { slowest, minSample } = state.result.ranking;
  $('kpi-slowest').textContent = slowest ? slowest.analystName : '—';
  $('kpi-slowest-sub').textContent = slowest
    ? `média ${hoursText(slowest.mediaHoras)} · mediana ${hoursText(slowest.medianaHoras)} · ${intFmt.format(slowest.exportadosAposAssinatura)} leads`
    : `nenhuma analista com ${minSample}+ leads exportados após a assinatura`;
}

// ---------- Ranking por analista ----------

function renderRanking() {
  const { analysts, slowest, minSample } = state.result.ranking;
  const tbody = document.querySelector('#ranking tbody');
  tbody.replaceChildren();
  const selected = state.result.period.analyst;

  analysts.forEach((a, i) => {
    const tr = tbody.insertRow();
    const key = a.analystId === null ? 'sem' : String(a.analystId);
    if (slowest && a.analystId === slowest.analystId) tr.classList.add('is-slowest');
    if (!a.amostraSuficiente) {
      tr.classList.add('small-sample');
      tr.title = `Menos de ${minSample} leads exportados após a assinatura: fora do destaque.`;
    }
    if (selected === key) tr.classList.add('is-selected');
    cell(tr, String(i + 1), 'num');
    cell(tr, a.analystName);
    cell(tr, intFmt.format(a.leads), 'num');
    cell(tr, intFmt.format(a.exportadosAposAssinatura), 'num');
    cell(tr, hoursText(a.mediaHoras), 'num');
    cell(tr, hoursText(a.medianaHoras), 'num');
    cell(tr, hoursText(a.maxHoras), 'num');
    cell(tr, intFmt.format(a.semExportacao), 'num');
    // Clique filtra o painel pela analista (clicar de novo remove o filtro).
    tr.addEventListener('click', () => {
      $('analyst').value = selected === key ? '' : key;
      $('period-form').requestSubmit();
    });
  });
  if (analysts.length === 0) {
    const td = tbody.insertRow().insertCell();
    td.colSpan = 8;
    td.className = 'empty';
    td.textContent = 'Nenhum lead no período.';
  }
}

// ---------- Filtros, ordenação e paginação ----------

function currentFilters() {
  const num = (id) => ($(id).value === '' ? null : Number($(id).value));
  return {
    code: $('f-code').value.trim().toUpperCase(),
    status: $('f-status').value,
    min: num('f-min'),
    max: num('f-max'),
    sigFrom: $('f-sig-from').value,
    sigTo: $('f-sig-to').value,
    expFrom: $('f-exp-from').value,
    expTo: $('f-exp-to').value,
  };
}

function inDateRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  const day = value.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

function matches(row, f) {
  if (f.code && !String(row.leadCode ?? '').toUpperCase().includes(f.code)) return false;
  if (f.status && row.status !== f.status) return false;
  if (f.min !== null && (row.intervalDays === null || row.intervalDays < f.min)) return false;
  if (f.max !== null && (row.intervalDays === null || row.intervalDays > f.max)) return false;
  return inDateRange(row.signedAt, f.sigFrom, f.sigTo) && inDateRange(row.exportedAt, f.expFrom, f.expTo);
}

function compare(a, b, key, type, dir) {
  const va = a[key];
  const vb = b[key];
  // Valores ausentes sempre ao final, independentemente da direção.
  if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
  if (vb === null || vb === undefined) return -1;
  const r = type === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
  return dir === 'asc' ? r : -r;
}

function refresh() {
  if (!state.result) return;
  const f = currentFilters();
  const th = document.querySelector(`th[data-sort="${state.sort.key}"]`);
  state.view = state.result.rows
    .filter((r) => matches(r, f))
    .sort((a, b) => compare(a, b, state.sort.key, th.dataset.type, state.sort.dir)
      || String(a.leadCode).localeCompare(String(b.leadCode)));
  renderTable();
}

function cell(tr, text, className) {
  const td = tr.insertCell();
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderTable() {
  const tbody = document.querySelector('#results tbody');
  tbody.replaceChildren();

  const total = state.view.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;

  for (const r of state.view.slice(start, start + state.pageSize)) {
    const tr = tbody.insertRow();
    cell(tr, r.leadCode ?? '—', 'code');
    cell(tr, r.analystName);
    cell(tr, fmtDate(r.signedAt));
    cell(tr, fmtDate(r.exportedAt));
    cell(tr, fmtNum(r.intervalDays), 'num');
    cell(tr, fmtNum(r.intervalHours), 'num');
    const badge = document.createElement('span');
    badge.className = `status status-${r.status}`;
    badge.textContent = r.statusLabel;
    tr.insertCell().append(badge);
    cell(tr, intFmt.format(r.signedCount), 'num');
    cell(tr, intFmt.format(r.sentCount), 'num');
  }
  if (total === 0) {
    const td = tbody.insertRow().insertCell();
    td.colSpan = 9;
    td.className = 'empty';
    td.textContent = state.result.rows.length ? 'Nenhum lead corresponde aos filtros.' : 'Nenhum lead encontrado no período.';
  }

  for (const h of document.querySelectorAll('#results th')) {
    h.setAttribute('aria-sort', h.dataset.sort === state.sort.key ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  }
  $('count-info').textContent = `${intFmt.format(total)} de ${intFmt.format(state.result.rows.length)} leads exibidos após filtros.`;
  $('pg-info').textContent = `Página ${state.page} de ${pages}`;
  $('pg-prev').disabled = state.page <= 1;
  $('pg-next').disabled = state.page >= pages;
  $('exp-xlsx').disabled = $('exp-csv').disabled = total === 0;
}

for (const th of document.querySelectorAll('#results th[data-sort]')) {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc' };
    refresh();
  });
}

for (const id of ['f-code', 'f-status', 'f-min', 'f-max', 'f-sig-from', 'f-sig-to', 'f-exp-from', 'f-exp-to']) {
  $(id).addEventListener('input', () => { state.page = 1; refresh(); });
}
$('f-clear').addEventListener('click', () => {
  for (const el of document.querySelectorAll('.filters input, .filters select')) el.value = '';
  state.page = 1;
  refresh();
});
$('pg-prev').addEventListener('click', () => { state.page -= 1; renderTable(); });
$('pg-next').addEventListener('click', () => { state.page += 1; renderTable(); });
$('pg-size').addEventListener('change', () => { state.pageSize = Number($('pg-size').value); state.page = 1; renderTable(); });

// ---------- Exportação ----------

async function exportAs(format) {
  showError(null);
  const { period, summary, ranking } = state.result;
  const f = currentFilters();
  const meta = {
    'Período': `${period.label} (${period.startDate} a ${period.endDate})`,
    'Analista': period.analystLabel,
    'Analista que mais demora': ranking.slowest
      ? `${ranking.slowest.analystName} — média ${ranking.slowest.mediaHoras} h (${ranking.slowest.exportadosAposAssinatura} leads)`
      : `nenhuma com ${ranking.minSample}+ leads`,
    'Base do período': period.basisLabel,
    'Assinatura considerada': period.signatureChoiceLabel,
    'Data de exportação': `${period.exportSourceLabel} — primeira após a assinatura (ou última anterior, se não houver)`,
    'Tempo até exportar': 'data de exportação − data de assinatura (negativo = já exportado antes da assinatura)',
    'Tempo médio após a assinatura (h)': summary.mediaHorasAposAssinatura ?? '',
    'Mediana após a assinatura (h)': summary.medianaHorasAposAssinatura ?? '',
    'Fuso': 'Horário de Brasília',
    'Filtros aplicados': Object.entries(f).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => `${k}=${v}`).join(', ') || 'nenhum',
    'Ordenação': `${state.sort.key} ${state.sort.dir}`,
    'Linhas exportadas': state.view.length,
    'Consultado em': new Date(state.result.generatedAt).toLocaleString('pt-BR'),
  };
  try {
    const res = await api(`/export/${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: state.view, meta, ranking: ranking.analysts }),
    });
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `resultado.${format}`;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err.message);
  }
}
$('exp-xlsx').addEventListener('click', () => exportAs('xlsx'));
$('exp-csv').addEventListener('click', () => exportAs('csv'));

loadOptions().catch((err) => showError(err.message));
