const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

const SUITS = ['♣', '♥', '♠', '♦'];
const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const TRUCO_STEPS = [1, 3, 6, 9, 12];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, id: `${rank}${suit}` });
    }
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const deck = [...arr];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function nextRank(rank) {
  const idx = RANKS.indexOf(rank);
  return RANKS[(idx + 1) % RANKS.length];
}

function cardStrength(card, manilhaRank) {
  if (card.rank === manilhaRank) {
    const suitOrder = { '♣': 40, '♥': 41, '♠': 42, '♦': 43 };
    return suitOrder[card.suit];
  }
  return RANKS.indexOf(card.rank);
}

function seatOrderFrom(startSeat) {
  return [0, 1, 2, 3].map((n) => (startSeat + n) % 4);
}

class TrucoRoom {
  constructor(id) {
    this.id = id;
    this.players = []; // {socketId, name, seat, hand}
    this.scores = [0, 0];
    this.currentHand = null;
    this.started = false;
    this.dealerSeat = 0;
  }

  addPlayer(socketId, name) {
    if (this.players.length >= 4) return { ok: false, reason: 'Sala cheia (4 jogadores).' };
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, reason: 'Nome já em uso na sala.' };
    }
    const usedSeats = new Set(this.players.map((p) => p.seat));
    let seat = 0;
    while (usedSeats.has(seat)) seat += 1;
    const player = { socketId, name, seat, hand: [] };
    this.players.push(player);
    this.players.sort((a, b) => a.seat - b.seat);
    return { ok: true, player };
  }

  removePlayer(socketId) {
    this.players = this.players.filter((p) => p.socketId !== socketId);
    if (this.players.length < 4) {
      this.started = false;
      this.currentHand = null;
    }
  }

  getPlayerBySocket(socketId) {
    return this.players.find((p) => p.socketId === socketId);
  }

  teamBySeat(seat) {
    return seat % 2;
  }

  maybeStart() {
    if (this.players.length === 4 && !this.started) {
      this.started = true;
      this.startHand();
    }
  }

  startHand() {
    const deck = createDeck();
    const vira = deck.pop();
    const manilhaRank = nextRank(vira.rank);

    for (const player of this.players) {
      player.hand = [deck.pop(), deck.pop(), deck.pop()];
    }

    const handStarter = (this.dealerSeat + 1) % 4;

    this.currentHand = {
      vira,
      manilhaRank,
      tableCards: [],
      playedCardsByTrick: [[], [], []],
      currentTrick: 0,
      trickWins: [0, 0],
      trickWinners: [],
      turnSeat: handStarter,
      pointsAtStake: 1,
      trucoLevel: 0,
      pendingTruco: null, // {fromTeam,toTeam,nextLevel}
      status: 'playing',
      message: 'Mão iniciada.',
    };
  }

  evaluateCurrentTrick() {
    const hand = this.currentHand;
    const cards = hand.playedCardsByTrick[hand.currentTrick];
    if (cards.length < 4) return null;

    let winnerSeat = cards[0].seat;
    let best = cardStrength(cards[0].card, hand.manilhaRank);
    let tie = false;

    for (let i = 1; i < cards.length; i += 1) {
      const s = cardStrength(cards[i].card, hand.manilhaRank);
      if (s > best) {
        best = s;
        winnerSeat = cards[i].seat;
        tie = false;
      } else if (s === best) {
        tie = true;
      }
    }

    const winnerTeam = tie ? null : this.teamBySeat(winnerSeat);
    hand.trickWinners.push(winnerTeam);

    if (winnerTeam === null) {
      hand.message = `Vaza ${hand.currentTrick + 1} empatou (cangou).`;
      const previousWinner = hand.trickWinners.find((w) => w !== null);
      if (previousWinner !== undefined) {
        hand.trickWins[previousWinner] += 1;
      }
    } else {
      hand.trickWins[winnerTeam] += 1;
      hand.message = `Vaza ${hand.currentTrick + 1} para a dupla ${winnerTeam + 1}.`;
    }

    const ended = this.checkHandEnd();
    if (!ended) {
      hand.currentTrick += 1;
      hand.turnSeat = winnerTeam === null ? hand.turnSeat : winnerSeat;
      hand.tableCards = [];
    }
    return { ended };
  }

  checkHandEnd() {
    const hand = this.currentHand;
    const [a, b] = hand.trickWins;
    const doneByWins = a >= 2 || b >= 2;
    const doneByTricks = hand.currentTrick >= 2;
    if (!doneByWins && !doneByTricks) return false;

    const winnerTeam = a === b ? (hand.trickWinners.find((w) => w !== null) ?? 0) : (a > b ? 0 : 1);
    this.scores[winnerTeam] += hand.pointsAtStake;

    hand.status = 'finished';
    hand.message = `Dupla ${winnerTeam + 1} venceu a mão e ganhou ${hand.pointsAtStake} ponto(s).`;

    if (this.scores[winnerTeam] >= 12) {
      hand.message += ` Jogo encerrado! Dupla ${winnerTeam + 1} venceu por ${this.scores[winnerTeam]} pontos.`;
      this.started = false;
      return true;
    }

    this.dealerSeat = (this.dealerSeat + 1) % 4;
    setTimeout(() => {
      if (this.players.length === 4) this.startHand();
      io.to(this.id).emit('state', this.publicState());
    }, 1800);

    return true;
  }

  callTruco(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const hand = this.currentHand;
    if (!player || !hand || hand.status !== 'playing') return { ok: false, reason: 'Mão inativa.' };
    if (hand.pendingTruco) return { ok: false, reason: 'Já existe truco pendente.' };

    const nextLevel = hand.trucoLevel + 1;
    if (nextLevel >= TRUCO_STEPS.length) return { ok: false, reason: 'Aposta já no limite.' };

    const fromTeam = this.teamBySeat(player.seat);
    const toTeam = fromTeam === 0 ? 1 : 0;
    hand.pendingTruco = { fromTeam, toTeam, nextLevel, bySeat: player.seat };
    hand.message = `${player.name} pediu ${TRUCO_STEPS[nextLevel]}! A dupla adversária decide.`;
    return { ok: true };
  }

  respondTruco(socketId, accept) {
    const player = this.getPlayerBySocket(socketId);
    const hand = this.currentHand;
    if (!player || !hand || !hand.pendingTruco) return { ok: false, reason: 'Não há truco pendente.' };

    const team = this.teamBySeat(player.seat);
    if (team !== hand.pendingTruco.toTeam) return { ok: false, reason: 'Somente dupla adversária pode responder.' };

    if (!accept) {
      this.scores[hand.pendingTruco.fromTeam] += hand.pointsAtStake;
      hand.status = 'finished';
      hand.message = `${player.name} correu. Dupla ${hand.pendingTruco.fromTeam + 1} ganhou ${hand.pointsAtStake} ponto(s).`;
      hand.pendingTruco = null;

      if (this.scores[0] >= 12 || this.scores[1] >= 12) {
        const winner = this.scores[0] >= 12 ? 0 : 1;
        hand.message += ` Jogo encerrado! Dupla ${winner + 1} campeã.`;
        this.started = false;
        return { ok: true };
      }

      this.dealerSeat = (this.dealerSeat + 1) % 4;
      setTimeout(() => {
        if (this.players.length === 4) this.startHand();
        io.to(this.id).emit('state', this.publicState());
      }, 1800);
      return { ok: true };
    }

    hand.trucoLevel = hand.pendingTruco.nextLevel;
    hand.pointsAtStake = TRUCO_STEPS[hand.trucoLevel];
    hand.message = `Aposta aceita! Mão valendo ${hand.pointsAtStake}.`;
    hand.pendingTruco = null;
    return { ok: true };
  }

  playCard(socketId, cardId) {
    const player = this.getPlayerBySocket(socketId);
    const hand = this.currentHand;
    if (!player || !hand || hand.status !== 'playing') return { ok: false, reason: 'Mão inativa.' };
    if (hand.pendingTruco) return { ok: false, reason: 'Aguarde resposta do truco.' };
    if (player.seat !== hand.turnSeat) return { ok: false, reason: 'Não é sua vez.' };

    const cardIndex = player.hand.findIndex((c) => c.id === cardId);
    if (cardIndex === -1) return { ok: false, reason: 'Carta não encontrada.' };

    const [card] = player.hand.splice(cardIndex, 1);
    hand.playedCardsByTrick[hand.currentTrick].push({ seat: player.seat, card });
    hand.tableCards.push({ seat: player.seat, card, playerName: player.name });

    const order = seatOrderFrom(hand.turnSeat);
    const currentCards = hand.playedCardsByTrick[hand.currentTrick];
    if (currentCards.length < 4) {
      hand.turnSeat = order[currentCards.length];
      return { ok: true };
    }

    this.evaluateCurrentTrick();
    return { ok: true };
  }

  publicState() {
    return {
      id: this.id,
      started: this.started,
      players: this.players.map((p) => ({ socketId: p.socketId, name: p.name, seat: p.seat, team: this.teamBySeat(p.seat), cards: p.hand.length })),
      scores: this.scores,
      hand: this.currentHand
        ? {
            vira: this.currentHand.vira,
            manilhaRank: this.currentHand.manilhaRank,
            tableCards: this.currentHand.tableCards,
            currentTrick: this.currentHand.currentTrick,
            trickWins: this.currentHand.trickWins,
            turnSeat: this.currentHand.turnSeat,
            pointsAtStake: this.currentHand.pointsAtStake,
            pendingTruco: this.currentHand.pendingTruco,
            message: this.currentHand.message,
            status: this.currentHand.status,
          }
        : null,
    };
  }

  privateState(socketId) {
    const me = this.getPlayerBySocket(socketId);
    return {
      ...this.publicState(),
      me: me ? { name: me.name, seat: me.seat, team: this.teamBySeat(me.seat), hand: me.hand } : null,
    };
  }
}

const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new TrucoRoom(roomId));
  return rooms.get(roomId);
}

function emitRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const player of room.players) {
    io.to(player.socketId).emit('state', room.privateState(player.socketId));
  }
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, playerName }, ack = () => {}) => {
    if (!roomId || !playerName) {
      ack({ ok: false, reason: 'Informe sala e nome.' });
      return;
    }

    const cleanRoomId = String(roomId).trim().toUpperCase();
    const cleanName = String(playerName).trim().slice(0, 20);
    const room = getOrCreateRoom(cleanRoomId);

    const result = room.addPlayer(socket.id, cleanName);
    if (!result.ok) {
      ack(result);
      return;
    }

    socket.join(cleanRoomId);
    socket.data.roomId = cleanRoomId;
    ack({ ok: true, seat: result.player.seat });

    room.maybeStart();
    emitRoomState(cleanRoomId);
  });

  socket.on('playCard', ({ cardId }, ack = () => {}) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, reason: 'Sala não encontrada.' });

    const result = room.playCard(socket.id, cardId);
    ack(result);
    emitRoomState(roomId);
  });

  socket.on('callTruco', (_, ack = () => {}) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, reason: 'Sala não encontrada.' });

    const result = room.callTruco(socket.id);
    ack(result);
    emitRoomState(roomId);
  });

  socket.on('respondTruco', ({ accept }, ack = () => {}) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, reason: 'Sala não encontrada.' });

    const result = room.respondTruco(socket.id, Boolean(accept));
    ack(result);
    emitRoomState(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    room.removePlayer(socket.id);
    if (room.players.length === 0) {
      rooms.delete(roomId);
    } else {
      emitRoomState(roomId);
    }
  });
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Truco Paulista rodando em http://localhost:${PORT}`);
});
