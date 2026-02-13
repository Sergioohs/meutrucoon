# Truco Paulista Pro (Multiplayer)

Jogo de **Truco Paulista profissional** para web, em tempo real, para 4 jogadores (duplas), com sala privada, log de partida e gerenciamento completo de mão/pontos.

## Recursos principais

- Sala privada por código para partidas entre amigos.
- Multiplayer em tempo real via Socket.IO (4 jogadores).
- Duplas automáticas por assento (1&3 vs 2&4).
- Regras essenciais do Truco Paulista:
  - vira + manilha dinâmica
  - 3 vazas por mão
  - truco com níveis 1, 3, 6, 9 e 12
  - vitória da partida ao atingir 12 pontos
- Interface profissional com:
  - placar detalhado
  - destaque do jogador da vez
  - painel de ações (truco)
  - log de eventos da partida
  - botão de reinício de partida

## Rodando localmente

```bash
npm install
npm start
```

Aplicação em: `http://localhost:3000`

## Como jogar

1. Abra 4 abas/dispositivos.
2. Entre com nomes diferentes na mesma sala.
3. Jogue cartas na sua vez.
4. Quando disponível, peça aumento (truco) ou responda (aceitar/correr).
5. Use **Nova partida** ao final para reiniciar a mesa.

## Stack

- Node.js + Express
- Socket.IO
- HTML + CSS + JavaScript
