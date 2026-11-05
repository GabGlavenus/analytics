// Inspeção (somente leitura) da estrutura real das tabelas usadas na análise.
// Uso: npm run inspect-schema
import { pool, query, closePool } from '../src/db/pool.js';
import { config } from '../src/config/index.js';

// Tabelas usadas pela análise (ver src/repositories/leadContract.repository.js)
const TABLES = ['lead', 'clicksign_envio', 'clicksign_log', 'associado', 'veiculo', 'exportacao_sga_log'];
const LEAD_CODE_REGEX = '^L[0-9]{4}[A-Z0-9]{2,}$';
const RELATED_NAME_REGEX = 'export|clicksign|contrat|envio|sign|assinat';
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
const TEXT_TYPES = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'json', 'enum']);
const SAMPLE_SIZE = 5000;
const MAX_DISTINCT = 40;

// Colunas com dados pessoais nunca têm valores exibidos.
const PII_COLUMN = /cpf|cnpj|rg$|^rg|nome|razao|email|telefone|celular|endereco|cep|numero|complemento|bairro|placa|chassi|renava|cnh|motor|nascimento|orgaoExpedidor|senha|token|observ|obs[A-Z]/i;
const MIN_REPEAT = 5; // só lista valores de colunas onde cada valor se repete, em média, 5+ vezes

const id = (name) => pool.escapeId(name);
const maskEmails = (s) => s.replace(/([A-Za-z0-9._%+-]{1,3})[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+/g, '$1***@***');

function printable(value, max = 300) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  const s = maskEmails(typeof value === 'object' ? JSON.stringify(value) : String(value));
  return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s;
}

/** Descreve um JSON/texto sem revelar valores: chaves (até 2 níveis) ou só o tamanho. */
function describeStructure(value) {
  if (value === null || value === undefined) return value;
  let data = value;
  if (typeof value === 'string') {
    try { data = JSON.parse(value); } catch { return `<texto ${value.length} chars>`; }
  }
  if (data === null || typeof data !== 'object') return `<${typeof data}>`;
  const keys = (obj) => Object.keys(obj).map((k) =>
    (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]) ? `${k}{${Object.keys(obj[k]).join(',')}}` : k));
  return Array.isArray(data) ? `<lista com ${data.length} itens>` : `<json: ${keys(data).join(', ').slice(0, 300)}>`;
}

function section(title) {
  console.log(`\n${'='.repeat(80)}\n${title}\n${'='.repeat(80)}`);
}

async function columnsOf(table) {
  return query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, COLUMN_TYPE AS fullType,
            IS_NULLABLE AS nullable, COLUMN_KEY AS keyType, COLUMN_DEFAULT AS def,
            EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_MAXIMUM_LENGTH AS maxLen
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [config.db.database, table],
  );
}

async function inspectTable(table) {
  section(`TABELA ${table}`);
  const cols = await columnsOf(table);
  if (cols.length === 0) {
    console.log(`!! Tabela "${table}" não encontrada em ${config.db.database}`);
    return;
  }
  console.table(cols.map(({ name, fullType, nullable, keyType, def, extra, comment }) =>
    ({ name, fullType, nullable, keyType, def: printable(def, 40), extra, comment })));

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM ${id(table)}`);
  console.log(`Total de linhas: ${total}`);

  const indexes = await query(
    `SELECT INDEX_NAME AS idx, NON_UNIQUE AS nonUnique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      GROUP BY INDEX_NAME, NON_UNIQUE`,
    [config.db.database, table],
  );
  console.log('\nÍndices:');
  console.table(indexes);

  const pk = cols.find((c) => c.keyType === 'PRI')?.name;
  const orderBy = pk ? `ORDER BY ${id(pk)} DESC` : '';
  const recent = `(SELECT * FROM ${id(table)} ${orderBy} LIMIT ${SAMPLE_SIZE}) AS s`;

  const dateCols = cols.filter((c) => DATE_TYPES.has(c.type));
  if (dateCols.length) {
    console.log('\nColunas de data (tabela inteira):');
    const stats = [];
    for (const c of dateCols) {
      const [r] = await query(
        `SELECT COUNT(${id(c.name)}) AS preenchidos, MIN(${id(c.name)}) AS minimo, MAX(${id(c.name)}) AS maximo
           FROM ${id(table)}`,
      );
      stats.push({ coluna: c.name, preenchidos: r.preenchidos, minimo: printable(r.minimo), maximo: printable(r.maximo) });
    }
    console.table(stats);
  }

  const textCols = cols.filter((c) => TEXT_TYPES.has(c.type));
  console.log(`\nColunas com valores no padrão de código de lead (${LEAD_CODE_REGEX}), amostra de ${SAMPLE_SIZE} linhas recentes:`);
  const codeHits = [];
  for (const c of textCols) {
    const [r] = await query(
      `SELECT SUM(CAST(${id(c.name)} AS CHAR) REGEXP ?) AS exatos,
              SUM(CAST(${id(c.name)} AS CHAR) REGEXP ?) AS contem,
              COUNT(${id(c.name)}) AS preenchidos
         FROM ${recent}`,
      [LEAD_CODE_REGEX, 'L[0-9]{4}[A-Z0-9]{2,}'],
    );
    if (Number(r.contem) > 0) codeHits.push({ coluna: c.name, valor_exato: r.exatos, contem_codigo: r.contem, preenchidos: r.preenchidos });
  }
  console.table(codeHits.length ? codeHits : [{ resultado: 'nenhuma coluna de texto contém o padrão' }]);

  console.log(`\nColunas de baixa cardinalidade (<= ${MAX_DISTINCT} valores distintos) — candidatas a status/evento:`);
  const lowCardCandidates = cols.filter((c) => !PII_COLUMN.test(c.name) && (
    c.type === 'enum' || (['char', 'varchar'].includes(c.type) && Number(c.maxLen) <= 100) ||
    ['tinyint', 'smallint'].includes(c.type)));
  for (const c of lowCardCandidates) {
    const [{ n, filled }] = await query(`SELECT COUNT(DISTINCT ${id(c.name)}) AS n, COUNT(${id(c.name)}) AS filled FROM ${id(table)}`);
    if (Number(n) === 0 || Number(n) > MAX_DISTINCT || Number(filled) / Number(n) < MIN_REPEAT) continue;
    const values = await query(
      `SELECT ${id(c.name)} AS valor, COUNT(*) AS qtd FROM ${id(table)}
        GROUP BY ${id(c.name)} ORDER BY qtd DESC LIMIT ${MAX_DISTINCT}`,
    );
    console.log(`- ${c.name}:`, values.map((v) => `${printable(v.valor, 60)} (${v.qtd})`).join(' | '));
  }

  const safeCols = cols.filter((c) => !PII_COLUMN.test(c.name)).map((c) => id(c.name));
  console.log(`\nAmostra das 3 linhas mais recentes${pk ? ` (por ${pk})` : ''} — sem colunas pessoais, textos truncados, e-mails mascarados:`);
  const sample = await query(`SELECT ${safeCols.join(', ')} FROM ${id(table)} ${orderBy} LIMIT 3`);
  // JSON e textos longos podem conter dados pessoais: mostra apenas a estrutura.
  const structuralTypes = new Set(['json', 'text', 'mediumtext', 'longtext', 'tinytext']);
  const typeOf = Object.fromEntries(cols.map((c) => [c.name, c.type]));
  for (const row of sample) {
    console.log(Object.fromEntries(Object.entries(row).map(([k, v]) => [k,
      structuralTypes.has(typeOf[k]) ? describeStructure(v) : printable(v, 120)])));
  }
}

async function main() {
  section('SERVIDOR');
  const [v] = await query('SELECT VERSION() AS versao, @@session.time_zone AS tz_sessao, @@global.time_zone AS tz_global, @@session.transaction_read_only AS read_only');
  console.log(v);

  section(`CHAVES ESTRANGEIRAS envolvendo ${TABLES.join(', ')}`);
  const marks = TABLES.map(() => '?').join(', ');
  const fks = await query(
    `SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna,
            REFERENCED_TABLE_NAME AS ref_tabela, REFERENCED_COLUMN_NAME AS ref_coluna, CONSTRAINT_NAME AS nome
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
        AND (TABLE_NAME IN (${marks}) OR REFERENCED_TABLE_NAME IN (${marks}))`,
    [config.db.database, ...TABLES, ...TABLES],
  );
  console.table(fks.length ? fks : [{ resultado: 'nenhuma FK declarada' }]);

  section(`OUTRAS TABELAS/COLUNAS com nomes relacionados (${RELATED_NAME_REGEX})`);
  const related = await query(
    `SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, COLUMN_TYPE AS tipo
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND (TABLE_NAME REGEXP ? OR COLUMN_NAME REGEXP ?)
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [config.db.database, RELATED_NAME_REGEX, RELATED_NAME_REGEX],
  );
  console.table(related);

  for (const t of TABLES) await inspectTable(t);
}

main()
  .catch((err) => {
    console.error('\nFalha na inspeção:', err.code || '', err.message);
    process.exitCode = 1;
  })
  .finally(closePool);
