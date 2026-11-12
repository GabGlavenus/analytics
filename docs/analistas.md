# Tela "Análises por analista"

Endereço: `/analistas.html` (menu **Análises por analista** no topo).

Mostra as **análises concluídas** pelas analistas no período: quantas cada uma fez, por dia, e a lista das análises com a ficha completa do associado e do veículo.

## Filtros

| Filtro | Como funciona |
|---|---|
| **De / Até** | Dias no horário de Brasília, ambos inclusivos. Atalhos: hoje, ontem, últimos 7 dias, este mês, mês passado. Ao abrir, a tela mostra **ontem** |
| **Analista** | Todas ou uma analista. Também dá para clicar na linha da analista na tabela "Por analista" (clicar de novo remove o filtro) |
| **Buscar** | Nome do associado ou razão social, placa (com ou sem hífen), código da análise, código do lead ou CPF/CNPJ (com ou sem pontuação, a partir de 3 dígitos) |

Os filtros ficam no endereço da página (`?inicio=…&fim=…`), então dá para salvar ou enviar o link de uma consulta.

## O que aparece

- **Cartões:** total de análises concluídas, quantas de **documento** e de **vistoria**, e quantas analistas concluíram alguma.
- **Por analista:** totais de cada analista, da que mais concluiu para a que menos concluiu.
- **Por dia:** totais por dia e analista, do dia mais recente para o mais antigo.
- **Análises:** até as **1000 mais recentes**. Clique numa linha para abrir a ficha (análise, associado, veículo, plano e valores, comercial e SGA). Leilão e chassi remarcado aparecem destacados quando "Sim".

## De onde vêm os dados

| Dado | Origem no `crmdb` |
|---|---|
| Análise concluída | `analise.status = 'CONCLUIDO'` |
| Data de conclusão | `analise.concluidoEm`; se vazia (algumas análises antigas), `analise.atualizadoEm` |
| Analista | `analise.usuarioId` → `user` (nome de exibição ou, na falta, o nome) |
| Tipo | `analise.tipoAnalise` (`DOCUMENTO` / `VISTORIA`) |
| Associado | `analise.leadId` → `lead`; para PJ, a razão social |
| Veículo, plano e SGA na ficha | `veiculo` com `leadCodigo` igual ao código do lead (o cadastro mais recente). Na falta de um campo, usa o que está no `lead` |
| Tempo de análise | `distribuidoEm` até a data de conclusão |

As datas são gravadas em UTC e exibidas no horário de Brasília (`DB_TIMEZONE` / `APP_TIMEZONE` no `.env`).
