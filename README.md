# Assinatura do contrato × Exportação do lead

Aplicação web em Node.js que consulta o `crmdb` (MySQL 8) **somente em modo leitura** e mede, para cada lead, quanto tempo levou para o lead ser **exportado ao SGA depois que o último contrato foi assinado** na Clicksign. Mostra também a **analista responsável** por cada lead e um **ranking das analistas** pelo tempo até a exportação.

Documentação detalhada (uso, origem de cada dado e regras de status) em [`docs/`](docs/README.md).

## Requisitos

- Node.js 20 ou superior (testado no 24)
- Acesso de rede ao MySQL do CRM, com um usuário que tenha permissão de leitura

## Instalação e execução

```bash
npm install
cp .env.example .env      # no Windows: copy .env.example .env
# edite o .env com host, porta, usuário e senha
npm start
```

Depois, abra **http://127.0.0.1:3000**.

| Comando | Para quê |
|---|---|
| `npm start` | Inicia a aplicação |
| `npm run dev` | Inicia e reinicia sozinho a cada alteração no código |
| `npm test` | Testes automatizados (não acessam o banco) |
| `npm run inspect-schema` | Mostra a estrutura real das tabelas usadas (diagnóstico, sem dados pessoais) |

### Configuração (`.env`)

| Variável | Descrição |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexão com o banco |
| `DB_TIMEZONE` | Fuso em que o banco grava as datas. O `crmdb` grava em **UTC** (`+00:00`) |
| `APP_TIMEZONE` | Fuso de exibição e dos limites do período (`-03:00`, horário de Brasília) |
| `PORT`, `HOST` | Endereço do servidor web. Por padrão só aceita acesso da própria máquina (`127.0.0.1`) |

O `.env` está no `.gitignore`. Nunca coloque credenciais no código.

Sugestão de usuário dedicado, só com leitura:

```sql
CREATE USER 'analise_leitura'@'%' IDENTIFIED BY '...';
GRANT SELECT ON crmdb.* TO 'analise_leitura'@'%';
```

## Como usar

1. **Período:** escolha entre últimos 30 dias, 2, 3, 6 ou 12 meses, ou personalizado. Se você editar uma das datas, o período passa a ser personalizado.
2. **Considerar leads com:** define qual data precisa cair no período:
   - *assinatura ou exportação* (padrão): mostra também os leads sem correspondência;
   - *somente assinatura*;
   - *somente exportação*.
3. **Assinatura considerada:**
   - **último contrato assinado** (padrão);
   - **último contrato enviado**: se ele ainda não foi assinado, o lead aparece como "aguardando assinatura".
4. **Data de exportação:** exportação do **associado** (padrão) ou do **veículo** ao SGA.
5. **Analista:** todas, uma analista específica ou "Sem analista". O filtro vale para indicadores, tabela e arquivos exportados. Com um resultado na tela, trocar a analista refaz a consulta.
6. **Consultar.** Na tabela é possível filtrar por código, status, tempo mínimo e máximo (em dias), data de assinatura e data de exportação, além de ordenar clicando no cabeçalho.
7. **Exportar Excel / CSV:** o arquivo sai exatamente como está na tela, já filtrado e ordenado. O Excel inclui as abas "Por analista" (ranking) e "Parâmetros" (período, regras e filtros usados).

**Tempo até exportar = data de exportação − data de assinatura**, em dias e em horas. O indicador "Tempo médio assinatura → exportação" considera só os leads exportados **depois** da assinatura. Os exportados antes aparecem à parte.

### Ranking por analista

- A seção **"Tempo assinatura → exportação por analista"** mostra, para cada analista: leads no período, quantos foram exportados após a assinatura, tempo médio, mediana, maior tempo e sem exportação. Clicar numa linha filtra o painel por aquela analista; clicar de novo remove o filtro.
- O ranking sempre compara **todas** as analistas do período, mesmo com o filtro de analista ativo.
- **Analista que mais demora** é a de maior **tempo médio** entre as que têm pelo menos **10 leads** exportados após a assinatura (`MIN_SAMPLE` em `src/services/analysis.service.js`). Assim, contas com 1 ou 2 leads, como usuários de teste, não definem o destaque. Elas continuam no ranking, em tom mais claro.
- A média é sensível a casos extremos (por exemplo, um lead que levou 50 dias). Compare sempre com a **mediana**, que mostra o tempo típico.

## De onde vêm os dados

O mapeamento foi confirmado inspecionando o schema real (`npm run inspect-schema`):

```
lead.id ──< clicksign_envio.leadId          (FK; 1 envelope = 1 contrato)
            clicksign_envio.id ──< clicksign_log.envioId   (FK)

lead.codigo ── associado.leadCodigo (único) ──< exportacao_sga_log.idAssociado
lead.codigo ── veiculo.leadCodigo   (1 por lead) ──< exportacao_sga_log.idVeiculo

lead.id ── analise.leadId (único) ── analise.usuarioId ── user.id   (analista)
```

- **Contrato enviado:** envelope com a ação `activate` (`statusCode` 2xx) no `clicksign_log`. Envelopes que deram erro nunca são ativados e não contam.
- **Data de assinatura:** eventos `webhook_sign` do envelope. A Clicksign envia um por documento (cerca de 4 por envelope), todos do mesmo signatário e com menos de 1 s de diferença; usa-se o último deles.
  - O horário vem de `event.occurred_at` no payload, que é o momento real da assinatura na Clicksign. O `criadoEm` é só o horário em que o webhook chegou (já atrasou até 2 h) e serve apenas como reserva.
  - Validado contra `contratogerado.dataAssinatura`: diferença média de 9 s em 6.285 contratos.
- **Último contrato:** a ordem dos envelopes de um lead segue o `id`, que coincide com a ordem de criação em 100% dos leads.
- **Data de exportação:** a **primeira exportação bem-sucedida** (`exportacao_sga_log.sucesso = 1`) feita **a partir da assinatura considerada**. Se não houver nenhuma depois dela, usa-se a **última exportação anterior**, e o status fica "Exportado antes da assinatura". Se o lead não tem assinatura, mostra-se a primeira exportação.
- **Analista responsável:** `analise.usuarioId` → `user`, exibindo `nomeExibicao` ou, se vazio, `nome`. A tabela `analise` tem um registro por lead (`leadId` é único) e cobre 100% dos leads exportados. É a analista que conclui a análise documental, o que dispara a exportação: na maioria dos casos ela ocorre em até 5 minutos após a conclusão. Não confundir com `lead.userId`, que é o consultor do lead.
  - O banco guarda só a analista **atual** do lead. Se o lead foi redistribuído, vale a última responsável, porque não há histórico de quem fez cada etapa.
- **Mesmo lead:** os contratos são ligados pela FK `clicksign_envio.leadId`. Ela confere em 100% dos casos com o código do lead enviado à Clicksign. As exportações são ligadas pelo **código do lead** (`leadCodigo`). Tudo é agregado por `lead.id`, então cada lead aparece **uma única vez**.
- **Fuso:** os limites do período são convertidos de Brasília para UTC antes da consulta, e as datas retornadas são convertidas de volta para Brasília.

### Status

| Status | Regra |
|---|---|
| Exportado após a assinatura | exportação > assinatura |
| Exportado antes da assinatura | só há exportação anterior à assinatura considerada (por exemplo, um contrato novo assinado depois de exportar) |
| Exportado no mesmo momento | exportação = assinatura |
| Contrato enviado, aguardando assinatura | há contrato enviado, mas o considerado não foi assinado |
| Sem contrato enviado | nenhum envelope ativado para o lead |
| Sem exportação | contrato assinado, mas nenhuma exportação bem-sucedida |

### Observações dos dados (novembro de 2026)

- Em 2026, cerca de 5,2 mil leads foram exportados depois da última assinatura, com **média de 49 h e mediana de 30 h**.
- Cerca de 360 leads (aproximadamente 6%) têm um contrato assinado **depois** da exportação, como adendos ou substituições. No fluxo atual, essa nova assinatura não gera nova exportação no log, e por isso esses leads aparecem como "Exportado antes da assinatura".
- Existem 5 registros de associado/veículo cujo `leadCodigo` não existe na tabela `lead`. Eles não podem ser ligados a nenhum lead e ficam de fora.

## Estrutura do projeto

```
├── public/                     Interface web (HTML/CSS/JS puros, sem build)
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js               filtros, ordenação, paginação e exportação
├── scripts/
│   └── inspect-schema.js       inspeção da estrutura do banco (leitura, sem dados pessoais)
├── src/
│   ├── server.js               inicialização do servidor
│   ├── app.js                  Express + helmet + rotas
│   ├── config/index.js         leitura e validação do .env
│   ├── db/pool.js              pool MySQL em sessão READ ONLY
│   ├── repositories/
│   │   └── leadContract.repository.js   ÚNICO lugar com SQL / nomes de tabelas
│   ├── services/
│   │   ├── period.service.js   períodos pré-definidos e personalizados
│   │   └── analysis.service.js comparação, status e indicadores
│   ├── exporters/index.js      geração de CSV e XLSX
│   ├── routes/analysis.routes.js
│   ├── middleware/errorHandler.js
│   └── utils/dates.js          datas e fusos
└── test/                       testes (node:test)
```

### API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/options` | Períodos (com as datas de hoje), opções, analistas, status e padrões |
| GET | `/api/analysis?preset=2m` | Análise. Parâmetros: `preset`, `startDate`, `endDate` (com `preset=custom`), `basis` (`qualquer`/`assinatura`/`exportacao`), `signatureChoice` (`ultimo_assinado`/`ultimo_enviado`), `exportSource` (`associado`/`veiculo`), `analyst` (id do usuário ou `sem`). A resposta traz `rows`, `summary` e `ranking` |
| POST | `/api/export/xlsx` · `/api/export/csv` | Corpo: `{ rows, meta, ranking? }`. Devolve o arquivo |

Exemplo: `GET /api/analysis?preset=custom&startDate=2026-09-01&endDate=2026-10-31&basis=assinatura`

## Segurança

- **Somente leitura em duas camadas:** a aplicação só executa `SELECT`, e toda conexão abre com `SET SESSION TRANSACTION READ ONLY`, então o próprio MySQL recusa qualquer escrita.
- **Consultas parametrizadas:** as datas vão como parâmetros (`?`). Os trechos de SQL que variam vêm de listas fixas no código, e qualquer valor fora delas é recusado com erro 400.
- **Proteções web e de arquivo:**
  - cabeçalhos de segurança via `helmet` (CSP etc.);
  - servidor acessível só pela própria máquina por padrão;
  - erros internos não expõem SQL ao navegador;
  - o CSV é protegido contra injeção de fórmulas no Excel.

## Como estender

- **Novo período pré-definido:** adicione uma entrada em `PRESETS` (`src/services/period.service.js`).
- **Outra regra de contrato ou de exportação:** ajuste `CONTRACT_CTES`, `RANK_COLUMNS` ou `EXPORT_CTES` em `src/repositories/leadContract.repository.js` e o rótulo correspondente (`SIGNATURE_CHOICES` / `EXPORT_SOURCES`).
- **Nova coluna no resultado:** inclua no `SELECT` do repositório, em `classify()` (`analysis.service.js`), em `EXPORT_COLUMNS` (`src/exporters/index.js`) e na tabela de `public/index.html` / `app.js`.
- **Nova análise:** crie um novo repositório e serviço e registre a rota em `src/routes/`.
