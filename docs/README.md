# Documentação

| Documento | Conteúdo |
|---|---|
| [uso.md](uso.md) | Como usar a tela: filtros, indicadores, ranking, tabela e arquivos exportados |
| [origem-dos-dados.md](origem-dos-dados.md) | De qual tabela e coluna do `crmdb` vem cada dado exibido |
| [status.md](status.md) | Regras de cada status, com destaque para "Exportado antes da assinatura" |
| [analistas.md](analistas.md) | Tela "Análises por analista": filtros, totais, ficha e de onde vem cada dado |
| [rede.md](rede.md) | Como deixar o sistema acessível aos outros computadores da rede |

Resumo em uma frase (tela Assinatura × Exportação): para cada lead, a aplicação pega a **data de assinatura do contrato** (Clicksign), a **data de exportação ao SGA** e a **analista responsável**, e calcula `exportação − assinatura`.

Observação importante: não há acesso ao código do backend do CRM. Tudo o que está aqui foi deduzido **lendo o banco** (estrutura das tabelas e os dados gravados), não a partir das regras do sistema. Onde é uma dedução, o texto avisa.
