# Origem dos dados

Todo o SQL fica em `src/repositories/leadContract.repository.js`. A conexão é somente leitura (`SET SESSION TRANSACTION READ ONLY`).

## Relacionamento entre as tabelas

```
lead.id ──< clicksign_envio.leadId              (1 envelope = 1 contrato)
            clicksign_envio.id ──< clicksign_log.envioId

lead.codigo ── associado.leadCodigo ──< exportacao_sga_log.idAssociado
lead.codigo ── veiculo.leadCodigo   ──< exportacao_sga_log.idVeiculo

lead.id ── analise.leadId ── analise.usuarioId ── user.id
```

## Tabelas e colunas usadas

| Tabela | Colunas | Para quê |
|---|---|---|
| `lead` | `id`, `codigo` | Identifica o lead. Tudo é agrupado por `lead.id` |
| `clicksign_envio` | `id`, `leadId` | Envelopes (contratos) enviados à Clicksign |
| `clicksign_log` | `envioId`, `acao`, `statusCode`, `payload`, `criadoEm` | Eventos do envelope: envio (`activate`) e assinatura (`webhook_sign`) |
| `associado` | `id`, `leadCodigo` | Liga o lead ao associado exportado |
| `veiculo` | `id`, `leadCodigo` | Liga o lead ao veículo exportado |
| `exportacao_sga_log` | `idAssociado`, `idVeiculo`, `tipoExportacao`, `sucesso`, `dataTentativa` | Tentativas de exportação ao SGA |
| `analise` | `leadId`, `usuarioId` | Analista responsável pela análise documental |
| `user` | `id`, `nomeExibicao`, `nome` | Nome da analista |

`contratogerado.dataAssinatura` não entra na análise. Foi usada só para validar a data de assinatura (diferença média de 9 s em 6.285 contratos).

## Cada dado, passo a passo

### Contrato enviado

Envelope de `clicksign_envio` que tem um registro em `clicksign_log` com `acao = 'activate'` e `statusCode` entre 200 e 299. Envelopes que falharam nunca são ativados e não contam.

- **Contratos enviados** (coluna da tabela) = quantidade desses envelopes no lead.

### Data de assinatura

Registros `clicksign_log` com `acao = 'webhook_sign'` do envelope. A Clicksign manda um webhook por documento (cerca de 4 por envelope, segundos de diferença entre eles); usa-se **o mais recente**.

- O horário vem de `payload → event.occurred_at`, que é o momento real da assinatura na Clicksign, convertido para UTC.
- Se o `occurred_at` não existir, usa-se `clicksign_log.criadoEm`, que é o horário de **chegada** do webhook (já houve atraso de até 2 h).
- **Contratos assinados** (coluna da tabela) = quantidade de envelopes com pelo menos um `webhook_sign`.

### Qual contrato vale

Um lead pode ter vários envelopes. A ordem é a do `clicksign_envio.id` (confere com a ordem de criação em 100% dos leads).

- *Último contrato assinado*: o envelope assinado de maior `id`.
- *Último contrato enviado*: o envelope ativado de maior `id`, assinado ou não.

### Data de exportação

Exportações bem-sucedidas: `exportacao_sga_log.sucesso = 1`, com `tipoExportacao = 'ASSOCIADO'` (via `associado`) ou `'VEICULO'` (via `veiculo`), conforme o filtro. A data é `dataTentativa`.

Como um lead pode ter várias exportações, a escolha segue esta ordem:

1. a **primeira** exportação **igual ou posterior** à assinatura considerada;
2. se não houver, a **última** exportação **anterior** à assinatura (esse caso vira "Exportado antes da assinatura");
3. se o lead não tem assinatura, a primeira exportação do lead.

Trecho do SQL:

```sql
COALESCE(MIN(CASE WHEN x.t >= u.signedAt THEN x.t END),
         MAX(CASE WHEN x.t <  u.signedAt THEN x.t END),
         MIN(x.t)) AS exportedAt
```

### Analista

`analise.usuarioId` → `user`. Exibe `nomeExibicao` ou, se vazio, `nome`. É quem conclui a análise documental, que é o que dispara a exportação: na maioria dos casos a exportação ocorre em até 5 minutos após a conclusão (dedução pelos horários gravados).

- `analise.leadId` é único: o banco guarda só a analista **atual**. Se o lead foi redistribuído, aparece a última responsável.
- Não confundir com `lead.userId`, que é o consultor do lead.

### Período

Os limites são convertidos de Brasília para UTC antes da consulta (`src/services/period.service.js`), porque o `crmdb` grava as datas em UTC. As datas retornadas são convertidas de volta para Brasília.

### Tempo até exportar e status

Calculados em JavaScript, não no banco (`classify()` em `src/services/analysis.service.js`). Ver [status.md](status.md).

## Limitações conhecidas

- Existem 5 registros de `associado`/`veiculo` cujo `leadCodigo` não existe em `lead`. Ficam de fora.
- Não há histórico de troca de analista.
- As regras do backend (quando ele exporta, se exige assinatura etc.) não foram vistas no código. O que está aqui reflete o que os dados mostram.
