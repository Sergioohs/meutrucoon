const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
const MAX_LOG_LINES = 14;

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

function sanitizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
}

class TrucoRoom {
  constructor(id) {
    this.id = id;
    this.players = []; // {socketId, name, seat, hand}
    this.scores = [0, 0];
    this.currentHand = null;
    this.started = false;
    this.dealerSeat = 0;
    this.logs = ['Sala criada. Aguardando jogadores...'];
    this.matchWinner = null;
    this.pendingNextHandTimeout = null;
  }

  pushLog(text) {
    this.logs.push(text);
    if (this.logs.length > MAX_LOG_LINES) this.logs = this.logs.slice(-MAX_LOG_LINES);
  }

  addPlayer(socketId, name) {
    if (this.players.length >= 4) return { ok: false, reason: 'Sala cheia (4 jogadores).' };

    const cleanName = sanitizeName(name);
    if (!cleanName) return { ok: false, reason: 'Nome inválido.' };
    if (this.players.some((p) => p.name.toLowerCase() === cleanName.toLowerCase())) {
      return { ok: false, reason: 'Nome já em uso na sala.' };
    }

    const usedSeats = new Set(this.players.map((p) => p.seat));
    let seat = 0;
    while (usedSeats.has(seat)) seat += 1;

    const player = { socketId, name: cleanName, seat, hand: [] };
    this.players.push(player);
    this.players.sort((a, b) => a.seat - b.seat);
    this.pushLog(`${cleanName} entrou na sala (Mesa ${seat + 1}).`);
    return { ok: true, player };
  }

  removePlayer(socketId) {
    const leaving = this.getPlayerBySocket(socketId);
    this.players = this.players.filter((p) => p.socketId !== socketId);

    if (leaving) this.pushLog(`${leaving.name} saiu da sala.`);

    if (this.pendingNextHandTimeout) {
      clearTimeout(this.pendingNextHandTimeout);
      this.pendingNextHandTimeout = null;
    }

    if (this.players.length < 4) {
      this.started = false;
      this.currentHand = null;
      this.matchWinner = null;
      for (const player of this.players) player.hand = [];
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
      this.scores = [0, 0];
      this.matchWinner = null;
      this.pushLog('Partida iniciada. Boa sorte!');
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
      pendingTruco: null,
      status: 'playing',
      message: 'Nova mão iniciada.',
    };

    this.pushLog(`Nova mão: vira ${vira.rank}${vira.suit}; manilha é ${manilhaRank}.`);
  }

  scheduleNextHand(onStateChange) {
    if (this.pendingNextHandTimeout) clearTimeout(this.pendingNextHandTimeout);
    this.pendingNextHandTimeout = setTimeout(() => {
      this.pendingNextHandTimeout = null;
      if (this.players.length === 4 && this.started) this.startHand();
      onStateChange();
    }, 1800);
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
      this.pushLog(hand.message);
      const previousWinner = hand.trickWinners.find((w) => w !== null);
      if (previousWinner !== undefined) hand.trickWins[previousWinner] += 1;
    } else {
      hand.trickWins[winnerTeam] += 1;
      hand.message = `Vaza ${hand.currentTrick + 1} para a dupla ${winnerTeam + 1}.`;
      this.pushLog(hand.message);
    }

    return this.checkHandEnd(winnerSeat, winnerTeam);
  }

  checkHandEnd(winnerSeat, winnerTeam) {
    const hand = this.currentHand;
    const [a, b] = hand.trickWins;
    const doneByWins = a >= 2 || b >= 2;
    const doneByTricks = hand.currentTrick >= 2;
    if (!doneByWins && !doneByTricks) {
      hand.currentTrick += 1;
      hand.turnSeat = winnerTeam === null ? hand.turnSeat : winnerSeat;
      hand.tableCards = [];
      return false;
    }

    const handWinner = a === b ? (hand.trickWinners.find((w) => w !== null) ?? 0) : (a > b ? 0 : 1);
    this.scores[handWinner] += hand.pointsAtStake;

    hand.status = 'finished';
    hand.message = `Dupla ${handWinner + 1} venceu a mão (+${hand.pointsAtStake}).`;
    this.pushLog(`${hand.message} Placar: ${this.scores[0]} x ${this.scores[1]}.`);

    if (this.scores[handWinner] >= 12) {
      this.matchWinner = handWinner;
      this.started = false;
      hand.message = `Fim da partida! Dupla ${handWinner + 1} campeã (${this.scores[0]} x ${this.scores[1]}).`;
      this.pushLog(hand.message);
      return true;
    }

    this.dealerSeat = (this.dealerSeat + 1) % 4;
    return true;
  }

  callTruco(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const hand = this.currentHand;
    if (!player || !hand || hand.status !== 'playing') return { ok: false, reason: 'Mão inativa.' };
    if (hand.pendingTruco) return { ok: false, reason: 'Já existe truco pendente.' };
    if (player.seat !== hand.turnSeat) return { ok: false, reason: 'Somente jogador da vez pode pedir truco.' };

    const nextLevel = hand.trucoLevel + 1;
    if (nextLevel >= TRUCO_STEPS.length) return { ok: false, reason: 'Aposta já no limite.' };

    const fromTeam = this.teamBySeat(player.seat);
    const toTeam = fromTeam === 0 ? 1 : 0;
    hand.pendingTruco = { fromTeam, toTeam, nextLevel, bySeat: player.seat };
    hand.message = `${player.name} pediu aumento para ${TRUCO_STEPS[nextLevel]}!`;
    this.pushLog(hand.message);
    return { ok: true };
  }

  respondTruco(socketId, accept) {
    const player = this.getPlayerBySocket(socketId);
    const hand = this.currentHand;
    if (!player || !hand || !hand.pendingTruco) return { ok: false, reason: 'Não há truco pendente.' };

    const team = this.teamBySeat(player.seat);
    if (team !== hand.pendingTruco.toTeam) return { ok: false, reason: 'Somente dupla adversária responde.' };

    if (!accept) {
      this.scores[hand.pendingTruco.fromTeam] += hand.pointsAtStake;
      hand.status = 'finished';
      hand.message = `${player.name} correu. Dupla ${hand.pendingTruco.fromTeam + 1} ganhou ${hand.pointsAtStake}.`;
      this.pushLog(hand.message);
      hand.pendingTruco = null;

      if (this.scores[0] >= 12 || this.scores[1] >= 12) {
        const winner = this.scores[0] >= 12 ? 0 : 1;
        this.matchWinner = winner;
        this.started = false;
        hand.message = `Fim da partida! Dupla ${winner + 1} campeã (${this.scores[0]} x ${this.scores[1]}).`;
        this.pushLog(hand.message);
      } else {
        this.dealerSeat = (this.dealerSeat + 1) % 4;
      }
      return { ok: true, handEnded: true };
    }

    hand.trucoLevel = hand.pendingTruco.nextLevel;
    hand.pointsAtStake = TRUCO_STEPS[hand.trucoLevel];
    hand.message = `Aposta aceita! Mão valendo ${hand.pointsAtStake}.`;
    this.pushLog(hand.message);
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
    this.pushLog(`${player.name} jogou ${card.rank}${card.suit}.`);

    const seats = [0, 1, 2, 3].map((n) => (hand.turnSeat + n) % 4);
    const currentCards = hand.playedCardsByTrick[hand.currentTrick];
    if (currentCards.length < 4) {
      hand.turnSeat = seats[currentCards.length];
      return { ok: true, handEnded: false };
    }

    const ended = this.evaluateCurrentTrick();
    return { ok: true, handEnded: ended };
  }

  resetMatch() {
    this.scores = [0, 0];
    this.currentHand = null;
    this.matchWinner = null;
    this.started = false;
    this.dealerSeat = 0;
    for (const player of this.players) player.hand = [];
    this.pushLog('Partida reiniciada pela sala.');
    this.maybeStart();
  }

  publicState() {
    return {
      id: this.id,
      started: this.started,
      players: this.players
        .map((p) => ({ socketId: p.socketId, name: p.name, seat: p.seat, team: this.teamBySeat(p.seat), cards: p.hand.length }))
        .sort((a, b) => a.seat - b.seat),
      scores: this.scores,
      logs: this.logs,
      matchWinner: this.matchWinner,
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
    if (!roomId || !playerName) return ack({ ok: false, reason: 'Informe sala e nome.' });

    const cleanRoomId = String(roomId).trim().toUpperCase().slice(0, 10);
    const room = getOrCreateRoom(cleanRoomId);
    const result = room.addPlayer(socket.id, playerName);
    if (!result.ok) return ack(result);

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
    if (result.ok && result.handEnded && room.started) room.scheduleNextHand(() => emitRoomState(roomId));
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
    if (result.ok && result.handEnded && room.started) room.scheduleNextHand(() => emitRoomState(roomId));
  });

  socket.on('resetMatch', (_, ack = () => {}) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return ack({ ok: false, reason: 'Sala não encontrada.' });

    room.resetMatch();
    ack({ ok: true });
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
