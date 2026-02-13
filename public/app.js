const socket = io();

const el = {
  joinScreen: document.getElementById('joinScreen'),
  tableScreen: document.getElementById('tableScreen'),
  joinForm: document.getElementById('joinForm'),
  roomId: document.getElementById('roomId'),
  playerName: document.getElementById('playerName'),
  roomLabel: document.getElementById('roomLabel'),
  statusText: document.getElementById('statusText'),
  score0: document.getElementById('score0'),
  score1: document.getElementById('score1'),
  stake: document.getElementById('stake'),
  vira: document.getElementById('vira'),
  manilha: document.getElementById('manilha'),
  playersPanel: document.getElementById('playersPanel'),
  tableCards: document.getElementById('tableCards'),
  myHand: document.getElementById('myHand'),
  trucoPanel: document.getElementById('trucoPanel'),
};

let latestState = null;

function notify(message) {
  el.statusText.textContent = message;
}

el.joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const roomId = el.roomId.value.trim();
  const playerName = el.playerName.value.trim();

  socket.emit('joinRoom', { roomId, playerName }, (res) => {
    if (!res.ok) {
      notify(`Erro: ${res.reason}`);
      return;
    }
    el.joinScreen.classList.add('hidden');
    el.tableScreen.classList.remove('hidden');
    el.roomLabel.textContent = `Sala ${roomId.toUpperCase()}`;
  });
});

function createCardLabel(card) {
  return `${card.rank}${card.suit}`;
}

function renderPlayers(state) {
  const activeSeat = state.hand?.turnSeat;
  const list = state.players
    .map((p) => {
      const me = state.me?.seat === p.seat ? ' (você)' : '';
      const active = p.seat === activeSeat ? 'active' : '';
      return `<li class="${active}">Mesa ${p.seat + 1}: <strong>${p.name}${me}</strong><br/>Dupla ${p.team + 1} • ${p.cards} carta(s)</li>`;
    })
    .join('');

  el.playersPanel.innerHTML = `<h3>Jogadores</h3><ul>${list}</ul>`;
}

function renderTable(state) {
  el.tableCards.innerHTML = (state.hand?.tableCards || [])
    .map((entry) => `<div class="played-card"><strong>${entry.playerName}</strong><br/>${createCardLabel(entry.card)}</div>`)
    .join('');
}

function renderHand(state) {
  const canPlay = state.hand?.turnSeat === state.me?.seat && !state.hand?.pendingTruco && state.hand?.status === 'playing';
  const cards = (state.me?.hand || [])
    .map((card) => `
      <div class="hand-card">
        <strong>${createCardLabel(card)}</strong>
        <button ${canPlay ? '' : 'disabled'} data-card-id="${card.id}">Jogar</button>
      </div>
    `)
    .join('');

  el.myHand.innerHTML = cards || '<p>Sem cartas.</p>';

  el.myHand.querySelectorAll('button[data-card-id]').forEach((button) => {
    button.addEventListener('click', () => {
      socket.emit('playCard', { cardId: button.dataset.cardId }, (res) => {
        if (!res.ok) notify(`Erro: ${res.reason}`);
      });
    });
  });
}

function renderTruco(state) {
  const hand = state.hand;
  if (!hand) {
    el.trucoPanel.innerHTML = '';
    return;
  }

  const myTeam = state.me?.team;
  const pending = hand.pendingTruco;
  const canCall = hand.status === 'playing' && !pending && hand.turnSeat === state.me?.seat && hand.pointsAtStake < 12;

  let html = '';
  if (canCall) {
    html += '<button id="callTruco">Pedir aumento</button>';
  }

  if (pending && myTeam === pending.toTeam) {
    html += '<button id="acceptTruco">Aceitar</button>';
    html += '<button id="runTruco" class="secondary">Correr</button>';
  }

  el.trucoPanel.innerHTML = html;

  const callBtn = document.getElementById('callTruco');
  if (callBtn) {
    callBtn.addEventListener('click', () => {
      socket.emit('callTruco', {}, (res) => {
        if (!res.ok) notify(`Erro: ${res.reason}`);
      });
    });
  }

  const acceptBtn = document.getElementById('acceptTruco');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      socket.emit('respondTruco', { accept: true }, (res) => {
        if (!res.ok) notify(`Erro: ${res.reason}`);
      });
    });
  }

  const runBtn = document.getElementById('runTruco');
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      socket.emit('respondTruco', { accept: false }, (res) => {
        if (!res.ok) notify(`Erro: ${res.reason}`);
      });
    });
  }
}

function render(state) {
  latestState = state;
  el.score0.textContent = state.scores[0];
  el.score1.textContent = state.scores[1];
  el.stake.textContent = state.hand?.pointsAtStake ?? 1;
  el.vira.textContent = state.hand ? createCardLabel(state.hand.vira) : '-';
  el.manilha.textContent = state.hand?.manilhaRank || '-';
  notify(state.hand?.message || (state.started ? 'Aguardando início da mão...' : 'Aguardando 4 jogadores...'));

  renderPlayers(state);
  renderTable(state);
  renderHand(state);
  renderTruco(state);
}

socket.on('state', (state) => {
  render(state);
});

socket.on('connect_error', () => {
  notify('Falha de conexão com servidor.');
});
