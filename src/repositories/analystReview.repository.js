// Acesso a dados das análises concluídas por analista (tela "Análises por analista").
//
// Tabelas: analise (a) -> user (u) pela analista que concluiu, -> `lead` (l).
// O detalhe ainda junta os cadastros auxiliares do lead e o veículo gerado após a
// venda (veiculo.leadCodigo = lead.codigo).
// Todas as colunas DATETIME do crmdb estão gravadas em UTC (config.db.timezone).

import { query } from '../db/pool.js';
import { config } from '../config/index.js';

// Data de conclusão; algumas análises concluídas antigas não têm concluidoEm preenchido.
const COMPLETED_AT = 'COALESCE(a.concluidoEm, a.atualizadoEm)';
const ANALYST_NAME = `COALESCE(NULLIF(TRIM(u.nomeExibicao), ''), u.nome)`;
// Para PJ o nome do associado é a razão social.
const MEMBER_NAME = `CASE WHEN l.pj = 1 AND COALESCE(l.razaoSocial, '') <> '' THEN l.razaoSocial ELSE l.nome END`;
const DIGITS_ONLY = (col) => `REPLACE(REPLACE(REPLACE(REPLACE(${col}, '.', ''), '-', ''), '/', ''), ' ', '')`;
const FROM_REVIEW = 'FROM analise a JOIN `user` u ON u.id = a.usuarioId JOIN `lead` l ON l.id = a.leadId';

// Os fusos vêm da configuração, já validados no formato +HH:MM.
const toAppTz = (col) => `CONVERT_TZ(${col}, '${config.db.timezone}', '${config.app.timezone}')`;
const localDateTime = (col) => `DATE_FORMAT(${toAppTz(col)}, '%d/%m/%Y %H:%i')`;

export const LIST_LIMIT = 1000;

/**
 * Monta o WHERE das análises concluídas.
 * @param {{ dbFrom: string, dbToExclusive: string, analystId?: number, search?: string }} f
 */
export function buildReviewFilter({ dbFrom, dbToExclusive, analystId, search }) {
  const where = [`a.status = 'CONCLUIDO'`, `${COMPLETED_AT} >= ?`, `${COMPLETED_AT} < ?`];
  const params = [dbFrom, dbToExclusive];
  if (analystId !== undefined) {
    where.push('a.usuarioId = ?');
    params.push(analystId);
  }
  if (search) {
    // Nome do associado, razão social, placa, código da análise ou do lead e CPF/CNPJ.
    const term = `%${search}%`;
    const conds = ['l.nome LIKE ?', 'l.razaoSocial LIKE ?', 'l.placa LIKE ?', 'a.codigo LIKE ?', 'l.codigo LIKE ?'];
    params.push(term, term, `%${search.replace(/[\s-]/g, '')}%`, term, term);
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) {
      conds.push(`${DIGITS_ONLY('l.cpf')} LIKE ?`);
      params.push(`%${digits}%`);
    }
    where.push(`(${conds.join(' OR ')})`);
  }
  return { sql: where.join(' AND '), params };
}

const COUNTS = `COUNT(*) AS total,
       SUM(a.tipoAnalise = 'DOCUMENTO') AS documento,
       SUM(a.tipoAnalise = 'VISTORIA') AS vistoria`;

const toCounts = (r) => ({ ...r, id: Number(r.id), total: Number(r.total), documento: Number(r.documento), vistoria: Number(r.vistoria) });

/** Analistas que já concluíram alguma análise (para o filtro da tela). */
export async function findReviewAnalysts() {
  const rows = await query(`
    SELECT u.id, ${ANALYST_NAME} AS nome, u.ativo
      FROM \`user\` u
     WHERE u.id IN (SELECT DISTINCT usuarioId FROM analise WHERE status = 'CONCLUIDO')
     ORDER BY u.ativo DESC, nome`);
  return rows.map((r) => ({ id: Number(r.id), nome: r.nome, ativo: Boolean(Number(r.ativo)) }));
}

/** Totais por analista e por dia (dia no fuso da aplicação). */
export async function summarizeReviews(filter) {
  const day = `DATE(${toAppTz(COMPLETED_AT)})`;
  const [porAnalista, porDia] = await Promise.all([
    query(`
      SELECT a.usuarioId AS id, ${ANALYST_NAME} AS nome, ${COUNTS}
        ${FROM_REVIEW}
       WHERE ${filter.sql}
       GROUP BY a.usuarioId, nome
       ORDER BY total DESC`, filter.params),
    query(`
      SELECT ${day} AS dia, a.usuarioId AS id, ${ANALYST_NAME} AS nome, ${COUNTS}
        ${FROM_REVIEW}
       WHERE ${filter.sql}
       GROUP BY dia, a.usuarioId, nome
       ORDER BY dia DESC, total DESC`, filter.params),
  ]);
  return { porAnalista: porAnalista.map(toCounts), porDia: porDia.map(toCounts) };
}

/** Análises do período, das mais recentes para as mais antigas (até LIST_LIMIT). */
export async function findReviews(filter) {
  return query(`
    SELECT a.codigo, l.codigo AS leadCodigo, a.tipoAnalise,
           ${ANALYST_NAME} AS analista,
           ${localDateTime('a.distribuidoEm')} AS distribuidoEm,
           ${localDateTime(COMPLETED_AT)} AS concluidoEm,
           ${MEMBER_NAME} AS associado, l.cpf, l.placa, l.tipoVeiculo,
           mk.nome AS marca, mv.nome AS modelo, l.anoModelo
      ${FROM_REVIEW}
      LEFT JOIN modeloveiculo mv ON mv.id = l.modeloId
      LEFT JOIN marcaveiculo mk ON mk.id = mv.marcaId
     WHERE ${filter.sql}
     ORDER BY ${COMPLETED_AT} DESC
     LIMIT ${LIST_LIMIT}`, filter.params);
}

/** Ficha completa de uma análise (lead, veículo, plano e SGA), ou null. */
export async function findReviewByCode(code) {
  const [review] = await query(`
    SELECT a.codigo, a.tipoAnalise, a.status, ${ANALYST_NAME} AS analista,
           ${localDateTime('a.criadoEm')} AS criadoEm,
           ${localDateTime('a.distribuidoEm')} AS distribuidoEm,
           ${localDateTime(COMPLETED_AT)} AS concluidoEm,
           TIMESTAMPDIFF(MINUTE, a.distribuidoEm, ${COMPLETED_AT}) AS minutosAnalise,
           l.codigo AS leadCodigo, l.etapa, l.pj,
           ${MEMBER_NAME} AS associado, l.nome AS nomeLead, l.razaoSocial, l.nomeFantasia, l.responsavelPj,
           l.cpf, l.rg, l.dataNascimento, l.telefone, l.email, l.cnh, l.categoriaCnh, l.dataVencimentoCnh,
           l.cep, l.endereco, l.numero, l.bairro, l.complemento, ci.nome AS cidade, ci.uf,
           l.placa, l.chassi, l.renavan AS renavam, l.anoFabricacao, l.anoModelo, l.tipoVeiculo, l.numeroMotor,
           mk.nome AS marca, mv.nome AS modelo, cor.nome AS cor, cb.nome AS combustivel, cat.nome AS categoria,
           l.gnv, l.chassiRemarcado, l.leilao, l.veiculoBlindado,
           p.nome AS plano, l.valorProtegido, l.valorAdesao, l.mensalidade, l.mensalidadeFinal, l.formaPagamento, l.dataVencimento,
           coop.nome AS cooperativa, o.nome AS origem,
           COALESCE(NULLIF(TRIM(c.nomeExibicao), ''), c.nome) AS consultor
      ${FROM_REVIEW}
      LEFT JOIN modeloveiculo mv ON mv.id = l.modeloId
      LEFT JOIN marcaveiculo mk ON mk.id = mv.marcaId
      LEFT JOIN cidade ci ON ci.id = l.cidadeId
      LEFT JOIN cor ON cor.id = l.corId
      LEFT JOIN combustivel cb ON cb.id = l.combustivelId
      LEFT JOIN categoria cat ON cat.id = l.categoriaId
      LEFT JOIN plano p ON p.id = l.planoId
      LEFT JOIN cooperativa coop ON coop.id = l.cooperativaId
      LEFT JOIN origem o ON o.id = l.origemId
      LEFT JOIN \`user\` c ON c.id = l.userId
     WHERE a.codigo = ?`, [code]);
  if (!review) return null;

  // Cadastro do veículo gerado após a venda (dados de FIPE, plano e SGA).
  const [vehicle] = await query(`
    SELECT placa, chassi, renavam, nomeMarca AS marca, nomeModelo AS modelo, anoFabricacao, anoModelo,
           nomeCor AS cor, nomeCombustivel AS combustivel, nomeCategoria AS categoria, codigoFipe, valorFipe,
           valorProtegido, nomePlano AS plano, nomeProdutoServico AS produto, valorAdesao, valorMensalidadeFinal AS mensalidade,
           formaPagamento, diaVencimento, cooperativaNome AS cooperativa, cidade, estado,
           instalacaoRastreador, empresaRastreador, statusExportacao, codigoSga, statusSgaSituacao
      FROM veiculo WHERE leadCodigo = ? ORDER BY id DESC LIMIT 1`, [review.leadCodigo]);

  return {
    ...review,
    minutosAnalise: review.minutosAnalise === null ? null : Number(review.minutosAnalise),
    veiculo: vehicle ?? null,
  };
}
