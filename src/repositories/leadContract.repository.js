// Acesso a dados: única camada que conhece tabelas e colunas do CRM.
//
// Relacionamentos confirmados na inspeção do schema (npm run inspect-schema):
//   Contrato:   clicksign_log.envioId -> clicksign_envio.id (FK)
//               clicksign_envio.leadId -> lead.id (FK)
//               Contrato enviado = envelope com ação 'activate' (statusCode 2xx).
//               Assinatura = webhooks 'webhook_sign' do envelope (um por documento,
//               sempre um único signatário). Usa-se o event.occurred_at do payload
//               (momento real na Clicksign); criadoEm (recebimento) só como reserva.
//               A ordem dos envelopes de um lead é a do id (igual à de criadoEm).
//   Exportação: lead.codigo = associado.leadCodigo (único) / veiculo.leadCodigo
//               exportacao_sga_log (sucesso = 1) -> idAssociado / idVeiculo
//   Analista:   analise.leadId (único) -> lead.id; analise.usuarioId -> user.id
//               É quem conclui a análise documental, o que dispara a exportação
//               ao SGA. Guarda a analista ATUAL do lead (sem histórico de troca).
// Todas as colunas DATETIME do crmdb estão gravadas em UTC (config.db.timezone).

import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { shiftTimezone } from '../utils/dates.js';

/** Qual data precisa cair dentro do período para o lead entrar na análise. */
export const PERIOD_BASES = Object.freeze({
  qualquer: 'Assinatura ou exportação no período',
  assinatura: 'Assinatura no período',
  exportacao: 'Exportação no período',
});

/** De onde vem a data de exportação do lead. */
export const EXPORT_SOURCES = Object.freeze({
  associado: 'Exportação do associado ao SGA',
  veiculo: 'Exportação do veículo ao SGA',
});

/** Qual contrato do lead fornece a data de assinatura. */
export const SIGNATURE_CHOICES = Object.freeze({
  ultimo_assinado: 'Último contrato assinado',
  ultimo_enviado: 'Último contrato enviado (pode estar pendente)',
});

// occurred_at vem como '2026-11-05T17:11:01.221-03:00'; convertido para UTC.
const OCCURRED_AT_UTC = `CONVERT_TZ(
  STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(g.payload, '$.event.occurred_at')), 19), '%Y-%m-%dT%H:%i:%s'),
  RIGHT(JSON_UNQUOTE(JSON_EXTRACT(g.payload, '$.event.occurred_at')), 6),
  '+00:00')`;

// Um registro por envelope enviado, com a data de assinatura (ou NULL) e a
// posição do envelope entre os contratos do lead.
const CONTRACT_CTES = `
  enviado AS (
    SELECT DISTINCT e.id AS envioId, e.leadId
      FROM clicksign_envio e
      JOIN clicksign_log g ON g.envioId = e.id
     WHERE g.acao = 'activate' AND g.statusCode BETWEEN 200 AND 299
  ),
  assinado AS (
    SELECT g.envioId, MAX(COALESCE(${OCCURRED_AT_UTC}, g.criadoEm)) AS signedAt
      FROM clicksign_log g
     WHERE g.acao = 'webhook_sign'
     GROUP BY g.envioId
  ),
  contrato AS (
    SELECT c.leadId, c.envioId, a.signedAt,
           ROW_NUMBER() OVER (PARTITION BY c.leadId ORDER BY c.envioId DESC) AS rnEnviado,
           ROW_NUMBER() OVER (PARTITION BY c.leadId ORDER BY a.signedAt IS NULL, c.envioId DESC) AS rnAssinado,
           COUNT(*) OVER (PARTITION BY c.leadId) AS sentCount,
           COUNT(a.signedAt) OVER (PARTITION BY c.leadId) AS signedCount
      FROM enviado c
      LEFT JOIN assinado a ON a.envioId = c.envioId
  )`;

// Um registro por exportação bem-sucedida ao SGA, identificada pelo código do lead.
const EXPORT_CTES = {
  associado: `
  exportacao AS (
    SELECT a.leadCodigo, s.dataTentativa AS t
      FROM associado a
      JOIN exportacao_sga_log s ON s.idAssociado = a.id
     WHERE s.tipoExportacao = 'ASSOCIADO' AND s.sucesso = 1
  )`,
  veiculo: `
  exportacao AS (
    SELECT v.leadCodigo, s.dataTentativa AS t
      FROM veiculo v
      JOIN exportacao_sga_log s ON s.idVeiculo = v.id
     WHERE s.tipoExportacao = 'VEICULO' AND s.sucesso = 1
  )`,
};

const RANK_COLUMNS = { ultimo_assinado: 'rnAssinado', ultimo_enviado: 'rnEnviado' };

// Nome de exibição da analista (cai para o nome completo se não houver).
const ANALYST_NAME = `COALESCE(NULLIF(TRIM(us.nomeExibicao), ''), us.nome)`;

function periodFilter(basis, from, to) {
  const exp = { sql: 'r.exportedAt >= ? AND r.exportedAt < ?', params: [from, to] };
  const sig = { sql: 'r.signedAt >= ? AND r.signedAt < ?', params: [from, to] };
  if (basis === 'exportacao') return exp;
  if (basis === 'assinatura') return sig;
  return { sql: `(${exp.sql}) OR (${sig.sql})`, params: [...exp.params, ...sig.params] };
}

const toAppTz = (v) => (v ? shiftTimezone(v, config.db.timezone, config.app.timezone) : null);

/**
 * Retorna uma linha por lead (agrupada por lead.id, sem duplicidade):
 * { leadCode, signedAt, exportedAt, sentCount, signedCount }
 *
 * - signedAt: assinatura do contrato escolhido (último assinado ou último enviado).
 * - exportedAt: primeira exportação a partir da assinatura; se não houver,
 *   a última anterior a ela; sem assinatura, a primeira exportação do lead.
 * Datas em 'YYYY-MM-DD HH:MM:SS' no fuso da aplicação (ou null).
 *
 * @param {{ dbFrom: string, dbToExclusive: string, basis: string, exportSource: string, signatureChoice: string }} p
 */
export async function findLeadSignatureAndExport({ dbFrom, dbToExclusive, basis, exportSource, signatureChoice }) {
  if (!Object.hasOwn(PERIOD_BASES, basis)) throw new Error(`basis inválida: ${basis}`);
  if (!Object.hasOwn(EXPORT_CTES, exportSource)) throw new Error(`exportSource inválida: ${exportSource}`);
  if (!Object.hasOwn(RANK_COLUMNS, signatureChoice)) throw new Error(`signatureChoice inválida: ${signatureChoice}`);

  const filter = periodFilter(basis, dbFrom, dbToExclusive);
  const sql = `
    WITH ${CONTRACT_CTES},
    ultimo AS (
      SELECT leadId, signedAt, sentCount, signedCount
        FROM contrato
       WHERE ${RANK_COLUMNS[signatureChoice]} = 1
    ),
    ${EXPORT_CTES[exportSource]}
    SELECT r.* FROM (
      SELECT l.codigo AS leadCode,
             u.signedAt,
             COALESCE(MIN(CASE WHEN x.t >= u.signedAt THEN x.t END),
                      MAX(CASE WHEN x.t <  u.signedAt THEN x.t END),
                      MIN(x.t)) AS exportedAt,
             COALESCE(u.sentCount, 0)   AS sentCount,
             COALESCE(u.signedCount, 0) AS signedCount,
             an.usuarioId AS analystId,
             ${ANALYST_NAME} AS analystName
        FROM \`lead\` l
        LEFT JOIN ultimo u     ON u.leadId = l.id
        LEFT JOIN exportacao x ON x.leadCodigo = l.codigo
        LEFT JOIN analise an   ON an.leadId = l.id
        LEFT JOIN \`user\` us  ON us.id = an.usuarioId
       WHERE u.leadId IS NOT NULL OR x.leadCodigo IS NOT NULL
       GROUP BY l.id, l.codigo, u.signedAt, u.sentCount, u.signedCount, an.usuarioId, us.nomeExibicao, us.nome
    ) r
     WHERE ${filter.sql}
     ORDER BY r.leadCode`;

  const rows = await query(sql, filter.params);
  return rows.map((r) => ({
    leadCode: r.leadCode,
    signedAt: toAppTz(r.signedAt),
    exportedAt: toAppTz(r.exportedAt),
    sentCount: Number(r.sentCount),
    signedCount: Number(r.signedCount),
    analystId: r.analystId === null ? null : Number(r.analystId),
    analystName: r.analystName,
  }));
}

/** Analistas que já tiveram leads atribuídos (para o filtro da interface). */
export async function findAnalysts() {
  const rows = await query(`
    SELECT an.usuarioId AS id, ${ANALYST_NAME} AS name, COUNT(*) AS leads
      FROM analise an
      JOIN \`user\` us ON us.id = an.usuarioId
     GROUP BY an.usuarioId, us.nomeExibicao, us.nome
     ORDER BY name`);
  return rows.map((r) => ({ id: Number(r.id), name: r.name, leads: Number(r.leads) }));
}
