# Snake Arena — Servidor multiplayer

Servidor que roda as salas da Snake Arena: até 30 jogadores por sala, bots completando a arena, comida, batidas e ranking.

## Colocar no Render

1. Crie um repositório no GitHub e envie estes arquivos: `server.js`, `engine.js`, `package.json` e `README.md`.
2. No Render: **New → Web Service** → conecte o GitHub → escolha o repositório.
3. Preencha:
   - **Language:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Starter (o grátis desliga quando fica parado)
4. Clique em **Deploy**. Quando terminar, abra o endereço `https://SEU-NOME.onrender.com` no navegador. Deve aparecer `{"ok":true,...}`.
5. O endereço que o jogo usa é o mesmo, trocando `https://` por `wss://`.

## Configurações opcionais (Environment)

- `MAX_PLAYERS`: jogadores humanos por sala (padrão 30).
