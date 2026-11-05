// Erros de validação (status 4xx) vão para o usuário; demais erros são
// registrados no console e respondidos com mensagem genérica, sem expor SQL.
export function errorHandler(err, _req, res, _next) {
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) {
    console.error(`[erro] ${err.code ?? ''} ${err.message}`);
    const dbDown = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ER_ACCESS_DENIED_ERROR'].includes(err.code);
    return res.status(dbDown ? 503 : 500).json({
      error: dbDown ? 'Não foi possível conectar ao banco do CRM. Verifique o .env.' : 'Erro interno ao processar a consulta.',
    });
  }
  res.status(status).json({ error: err.expose === false ? 'Requisição inválida.' : err.message });
}
