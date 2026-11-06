# Status

Calculados em `classify()` (`src/services/analysis.service.js`), comparando a data de assinatura do contrato considerado com a data de exportação escolhida (regras em [origem-dos-dados.md](origem-dos-dados.md)).

| Status | Regra |
|---|---|
| Exportado após a assinatura | exportação > assinatura |
| Exportado antes da assinatura | exportação < assinatura (só existe exportação anterior à assinatura considerada) |
| Exportado no mesmo momento da assinatura | exportação = assinatura |
| Contrato enviado, aguardando assinatura | há envelope ativado, mas o contrato considerado não foi assinado |
| Sem contrato enviado | nenhum envelope ativado para o lead |
| Sem exportação | há assinatura, mas nenhuma exportação bem-sucedida |

## "Exportado antes da assinatura"

**Não significa que o lead foi exportado sem assinatura.** O nome compara a exportação com **a assinatura que a análise está considerando**, que por padrão é a do **último** contrato assinado.

O caso típico:

```
contrato 1 assinado ──► exportado ao SGA ──► contrato 2 assinado (adendo/substituição)
                                              ▲
                                              └─ "último contrato assinado"
```

O lead passou pelo fluxo normal: o primeiro contrato foi assinado e depois veio a exportação. Mais tarde foi gerado e assinado um novo contrato. Como a análise usa o último contrato, a assinatura considerada fica **depois** da exportação, e o banco não registra uma nova exportação depois dela. Por isso o tempo aparece negativo.

Esses leads ficam **fora** do tempo médio e da mediana, porque o tempo negativo não mede "quanto demorou para exportar depois de assinar".

### O que os dados mostram (leads com última assinatura em 2026, exportação do associado)

Consulta de diagnóstico feita em 06/11/2026, somente leitura:

| | Leads |
|---|---|
| Total com assinatura e exportação | 5.541 |
| Exportado antes da última assinatura | 361 |
| ↳ já tinham um contrato **anterior** assinado antes da exportação | **352 (97,5%)** |
| ↳ nenhuma assinatura registrada antes da exportação | 9 |

Em média, a nova assinatura acontece 4,6 dias depois da exportação.

Os 9 restantes:

- 7 têm um único contrato, já enviado antes da exportação, e a assinatura ocorreu entre 10 min e 2 h **depois** da exportação. Ou seja, a exportação aconteceu com o contrato ainda pendente na Clicksign. Sem o código do backend não dá para saber se é uma brecha da regra, uma exportação manual ou atraso no registro da assinatura.
- 2 têm dois contratos e nenhum dos dois estava assinado na hora da exportação (diferença de 26 h e de cerca de 31 dias).

Se quiser ver só os casos de "exportado após", basta filtrar a tabela pelo status. Se quiser medir contra o **primeiro** contrato, isso exigiria uma nova opção em "Assinatura considerada" (não existe hoje).
