# Como usar

Inicie com `npm start` e abra http://127.0.0.1:3000. A configuração do banco fica no `.env` (veja o README da raiz).

## Filtros da consulta

| Campo | O que faz |
|---|---|
| **Período** | Últimos 30 dias, 2, 3, 6 ou 12 meses, ou personalizado. Datas em horário de Brasília, com a data final incluída |
| **Considerar leads com** | Qual data precisa cair no período: *assinatura ou exportação* (padrão), *somente assinatura* ou *somente exportação* |
| **Assinatura considerada** | *Último contrato assinado* (padrão) ou *último contrato enviado*. No segundo caso, se o último envelope ainda não foi assinado, o lead aparece como "aguardando assinatura" |
| **Data de exportação** | Exportação do **associado** (padrão) ou do **veículo** ao SGA |
| **Analista** | Todas, uma analista ou "Sem analista". Vale para os indicadores, a tabela e os arquivos. O ranking continua mostrando todas |

## Indicadores (cartões do topo)

| Cartão | Cálculo |
|---|---|
| **Leads analisados** | Quantidade de leads retornados. Subtítulo: quantos têm assinatura **e** exportação |
| **Contratos assinados** | Soma dos envelopes assinados dos leads. Subtítulo: quantos leads têm ao menos um contrato assinado |
| **Sem correspondência** | Leads com status *Sem exportação*, *Aguardando assinatura* ou *Sem contrato enviado* |
| **Tempo médio assinatura → exportação** | Média de `exportação − assinatura` **só dos leads exportados depois da assinatura**. Os "exportados antes" ficam fora da média e aparecem contados no subtítulo |
| **Analista que mais demora** | Maior tempo médio entre as analistas com pelo menos 10 leads exportados após a assinatura (`MIN_SAMPLE`) |

## Ranking por analista

Uma linha por analista, com: leads no período, exportados após a assinatura, tempo médio, mediana, maior tempo e sem exportação. Média, mediana e maior tempo usam só os leads "exportados após". Clicar numa linha filtra o painel.

A coluna "Leads" inclui os leads com status "Exportado antes da assinatura" (ver [status.md](status.md)), que não têm coluna própria no ranking. Eles continuam visíveis na tabela de leads, filtrando pelo status.

## Tabela de leads

| Coluna | Significado |
|---|---|
| Código do lead | `lead.codigo` |
| Analista | Analista responsável pela análise documental |
| Data de assinatura | Assinatura do contrato considerado (ver filtro) |
| Data de exportação | Exportação ao SGA escolhida pela regra em [origem-dos-dados.md](origem-dos-dados.md#data-de-exportação) |
| Tempo até exportar (dias / horas) | `exportação − assinatura`. **Negativo** quando a exportação é anterior à assinatura |
| Status | Ver [status.md](status.md) |
| Contratos assinados / enviados | Quantos envelopes do lead foram assinados / ativados na Clicksign |

É possível filtrar por código, status, tempo mínimo e máximo, faixa de assinatura e faixa de exportação, e ordenar pelo cabeçalho.

## Arquivos exportados

- **CSV**: a tabela como está na tela (filtrada e ordenada), separador `;`.
- **Excel**: a mesma tabela, mais as abas **Por analista** (ranking) e **Parâmetros** (período, regras e filtros usados).
