// Utilitários de data. As datas do banco são tratadas como texto
// 'YYYY-MM-DD[ HH:MM:SS]' no horário do CRM; os cálculos usam UTC apenas como
// "relógio neutro", para que diferenças não sofram com fuso/horário de verão.

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' de um Date, considerando seus campos UTC. */
export function toIsoDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Converte 'YYYY-MM-DD' em Date (meia-noite UTC) validando datas inexistentes. */
export function parseIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || toIsoDate(date) !== value ? null : date;
}

/** Converte o texto de DATE/DATETIME do banco em milissegundos (relógio neutro). */
export function dbDateToMs(value) {
  if (!value || value.startsWith('0000-00-00')) return null;
  const ms = Date.parse(`${value.replace(' ', 'T').slice(0, 19)}Z`);
  return Number.isNaN(ms) ? null : ms;
}

const offsetMinutes = (offset) => {
  const [, sign, hh, mm] = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
};

/** Converte 'YYYY-MM-DD HH:MM:SS' de um fuso (fromOffset) para outro (toOffset). */
export function shiftTimezone(value, fromOffset, toOffset) {
  const ms = dbDateToMs(value) + (offsetMinutes(toOffset) - offsetMinutes(fromOffset)) * 60_000;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Subtrai meses preservando o fim do mês (31/03 - 1 mês = 28 ou 29/02). */
export function subtractMonths(date, months) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return result;
}

/** "Hoje" (meia-noite, relógio neutro) no fuso informado ('+HH:MM'/'-HH:MM'). */
export function todayIn(offset, now = new Date()) {
  return parseIsoDate(toIsoDate(new Date(now.getTime() + offsetMinutes(offset) * 60_000)));
}

export const DAY_IN_MS = DAY_MS;
