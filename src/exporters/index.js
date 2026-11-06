import ExcelJS from 'exceljs';

// Colunas exportadas, na ordem da tabela da interface.
export const EXPORT_COLUMNS = [
  { key: 'leadCode', header: 'Código do lead', width: 16 },
  { key: 'analystName', header: 'Analista', width: 26 },
  { key: 'signedAt', header: 'Data de assinatura (último contrato)', width: 22, type: 'date' },
  { key: 'exportedAt', header: 'Data de exportação', width: 21, type: 'date' },
  { key: 'intervalDays', header: 'Tempo até exportar (dias)', width: 15, type: 'number' },
  { key: 'intervalHours', header: 'Tempo até exportar (horas)', width: 15, type: 'number' },
  { key: 'statusLabel', header: 'Status', width: 40 },
  { key: 'signedCount', header: 'Contratos assinados', width: 12, type: 'integer' },
  { key: 'sentCount', header: 'Contratos enviados', width: 12, type: 'integer' },
];

// Aba "Por analista" do Excel: ranking do tempo assinatura → exportação.
export const RANKING_COLUMNS = [
  { key: 'analystName', header: 'Analista', width: 26 },
  { key: 'leads', header: 'Leads no período', width: 12, type: 'integer' },
  { key: 'exportadosAposAssinatura', header: 'Exportados após a assinatura', width: 16, type: 'integer' },
  { key: 'mediaHoras', header: 'Tempo médio (horas)', width: 14, type: 'number' },
  { key: 'medianaHoras', header: 'Mediana (horas)', width: 14, type: 'number' },
  { key: 'maxHoras', header: 'Maior tempo (horas)', width: 14, type: 'number' },
  { key: 'semExportacao', header: 'Sem exportação', width: 12, type: 'integer' },
];

const MAX_ROWS = 200_000;
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/** Mantém apenas as colunas conhecidas, com o tipo esperado. */
function sanitize(list, columns, name, max) {
  if (!Array.isArray(list)) throw badRequest(`Corpo inválido: "${name}" deve ser uma lista.`);
  if (list.length > max) throw badRequest(`Máximo de ${max} linhas por exportação.`);
  return list.map((r) => Object.fromEntries(columns.map(({ key, type }) => {
    const v = r?.[key];
    if (v === null || v === undefined || v === '') return [key, null];
    if (type === 'number' || type === 'integer') return [key, Number.isFinite(Number(v)) ? Number(v) : null];
    return [key, String(v)];
  })));
}

export const sanitizeRows = (rows) => sanitize(rows, EXPORT_COLUMNS, 'rows', MAX_ROWS);
export const sanitizeRanking = (ranking) => (ranking === undefined ? [] : sanitize(ranking, RANKING_COLUMNS, 'ranking', 1000));

// 'YYYY-MM-DD HH:MM:SS' -> 'DD/MM/YYYY HH:MM:SS'
const brDate = (v) => (v ? v.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1') : '');

/** Neutraliza injeção de fórmulas ao abrir o arquivo no Excel. */
const formulaSafe = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function toCsv(rows) {
  const quote = (s) => `"${String(s).replaceAll('"', '""')}"`;
  const lines = [EXPORT_COLUMNS.map((c) => quote(c.header)).join(';')];
  for (const r of rows) {
    lines.push(EXPORT_COLUMNS.map(({ key, type }) => {
      const v = r[key];
      if (v === null) return '';
      if (type === 'number' || type === 'integer') return String(v).replace('.', ',');
      if (type === 'date') return quote(brDate(v));
      return quote(formulaSafe(v));
    }).join(';'));
  }
  // BOM para o Excel reconhecer UTF-8; ';' e vírgula decimal no padrão pt-BR.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const toExcelDate = (v) => (v ? new Date(`${v.replace(' ', 'T').slice(0, 19)}Z`) : null);

function addTableSheet(wb, title, columns, rows) {
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(({ key, header, width }) => ({ key, header, width }));
  for (const r of rows) {
    ws.addRow(Object.fromEntries(columns.map(({ key, type }) => {
      const v = r[key];
      if (type === 'date') return [key, toExcelDate(v)];
      return [key, typeof v === 'string' ? formulaSafe(v) : v];
    })));
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
  columns.forEach(({ type }, i) => {
    const col = ws.getColumn(i + 1);
    if (type === 'date') col.numFmt = 'dd/mm/yyyy hh:mm:ss';
    if (type === 'number') col.numFmt = '0.0';
    if (type === 'integer') col.numFmt = '0';
  });
  return ws;
}

export async function toXlsx(rows, meta = {}, ranking = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Análise assinatura x exportação';
  wb.created = new Date();

  addTableSheet(wb, 'Resultados', EXPORT_COLUMNS, rows);
  if (ranking.length) addTableSheet(wb, 'Por analista', RANKING_COLUMNS, ranking);

  const info = wb.addWorksheet('Parâmetros');
  info.columns = [{ header: 'Parâmetro', key: 'k', width: 30 }, { header: 'Valor', key: 'v', width: 60 }];
  info.getRow(1).font = { bold: true };
  for (const [k, v] of Object.entries(meta)) info.addRow({ k, v: v === null || v === undefined ? '' : formulaSafe(String(v)) });

  return wb.xlsx.writeBuffer();
}
