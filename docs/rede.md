# Uso pela rede local

## 1. Configurar o `.env`

```
HOST=0.0.0.0
PORT=3000
```

`HOST=0.0.0.0` libera o acesso pelos outros computadores. O sistema **não pede login**: qualquer pessoa na rede local que souber o endereço consegue abrir as telas, inclusive a de analistas, que mostra CPF, telefone e endereço dos associados.

## 2. Iniciar o sistema

Dê dois cliques em **`iniciar.bat`**. Vai abrir uma janela preta mostrando algo como:

```
Rodando em http://localhost:3000
Na rede:    http://192.168.10.78:3000
```

**Não feche essa janela** — se fechar, o sistema sai do ar para todo mundo. O computador também precisa ficar ligado (e sem entrar em suspensão).

## 3. Acessar de outro computador

No navegador do outro computador (na mesma rede), abra o endereço da linha **"Na rede"**. Depois de mudar o `.env`, reinicie o sistema (feche a janela e abra o `iniciar.bat` de novo).

## 4. Firewall

Clique com o botão direito em **`liberar-firewall.ps1` > Executar com o PowerShell** e aceite o pedido de administrador. A porta do `.env` é liberada **apenas para computadores da rede local** (regra "Analises CRM"; a regra antiga "Analises por Analista", se existir, é substituída). Refaça se mudar a porta.

## 5. Iniciar junto com o Windows (opcional)

1. Aperte `Win + R`, digite `shell:startup` e dê Enter.
2. Nessa pasta, crie um **atalho** para o `iniciar.bat`.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Outro computador não abre a página | Confira se a janela do `iniciar.bat` está aberta e se o IP mudou (linha "Na rede") |
| O IP muda de vez em quando | Peça ao responsável pela rede um **IP fixo** (reserva DHCP) para este computador |
| "Não foi possível conectar ao banco do CRM" | Verifique a internet deste computador e os dados de conexão no `.env` |
| "A porta 3000 já está em uso" | O sistema já está rodando em outra janela. Feche a duplicada |
