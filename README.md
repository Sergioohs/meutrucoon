# Truco Paulista Pro (Multiplayer)

Um jogo de **Truco Paulista multiplayer em tempo real** para 4 jogadores (duplas), com mesa online via Socket.IO.

## Recursos

- Salas privadas por código.
- 4 assentos fixos e duplas automáticas (1&3 vs 2&4).
- Baralho espanhol simplificado (40 cartas) e cálculo de manilha via vira.
- Rodadas em até 3 vazas.
- Aposta progressiva de truco (1, 3, 6, 9, 12).
- Interface responsiva com estado em tempo real.

## Como rodar

```bash
npm install
npm start
```

Acesse: `http://localhost:3000`

## Fluxo

1. Abra 4 abas (ou 4 dispositivos).
2. Entre com nomes diferentes na mesma sala.
3. Jogue cartas na sua vez e use os botões de truco quando disponível.
4. Vence a dupla que fizer 12 pontos.

## Stack

- Node.js + Express
- Socket.IO
- HTML/CSS/JS (client-side)
