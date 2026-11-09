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

## Relatório em texto

O botão **Gerar relatório** (ao lado de Exportar) monta uma análise em texto dos leads **filtrados na tabela**, respeitando período, analista e filtros. Dá para copiar ou baixar em `.txt`. Ao mudar os filtros, gere de novo.

Acima do texto ficam dois gráficos: o **histograma** do tempo até exportar (outliers numa barra separada, com mediana e média sem outliers marcadas) e o **boxplot por analista** sem outliers (caixa = P25 a P75, traço = mediana, linha tracejada = mediana da equipe). Passe o mouse para ver os números.

O campo **Metas (h)** define os prazos medidos (até 5, separados por vírgula; padrão `24, 48, 72`).

Usa só os leads *Exportado após a assinatura*. Seções:

| Seção | O que mostra |
|---|---|
| Base da análise | Quantos leads entram nos cálculos e quantos ficam fora (exportados antes, sem exportação, sem assinatura). Destaca os assinados sem exportação há mais tempo que o limite de outlier |
| Estatística descritiva | Média, mediana, média aparada 10%, desvio padrão, coeficiente de variação, desvio absoluto mediano, P10 a P95, IQR e assimetria, com interpretação |
| Outliers | Leads acima de **Q3 + 1,5 × IQR** (critério do boxplot), com extremos acima de Q3 + 3 × IQR. Mostra quanto das horas eles concentram, as medidas com e sem outliers e os 10 maiores casos. Só a cauda superior é isolada |
| Cumprimento de metas | % exportados dentro de cada meta do campo **Metas (h)** |
| Por analista | Outliers de cada uma (pelo limite da equipe), mediana sem outliers com **intervalo de 95%**, média com e sem outliers e % dentro de cada meta. "Leitura" diz se o tempo típico está acima, abaixo ou dentro do padrão da equipe: acima/abaixo só quando o intervalo de 95% não inclui a mediana da equipe. Abaixo de 10 leads, "amostra pequena" |
| Tendência | Mediana sem outliers na 1ª e na 2ª metade do período (pela data de assinatura). Leads assinados nas últimas P90 horas ficam fora, porque ainda podem não ter sido exportados e favoreceriam o fim do período. Leads mais antigos ainda sem exportação entram com o tempo já decorrido |
| Conclusões | Referência realista, peso dos outliers e diferença entre "mais lenta pela média" e "mais lenta pela mediana" |

Com o filtro de uma única analista, a seção "Por analista" some (não há com quem comparar). Para comparar, use "Todas".

O cálculo fica em `public/js/stats.js` e `public/js/report.js`, e os gráficos em `public/js/charts.js`, sem acesso ao banco e com testes em `test/report.test.js`.

## Arquivos exportados

- **CSV**: a tabela como está na tela (filtrada e ordenada), separador `;`.
- **Excel**: a mesma tabela, mais as abas **Por analista** (ranking), **Parâmetros** (período, regras e filtros usados) e **Relatório** (o relatório em texto, gerado na hora com as metas do campo Metas).
