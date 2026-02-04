const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Локации для режима cities (расширь по необходимости)
const locationsByMode = {
  cities: [
    { lat: 53.88042, lng: 27.4855477, name: 'Минск' },
    { lat: 53.6676981, lng: 23.9069996, name: 'Гродно' },
    { lat: 52.0805018, lng: 23.7169662, name: 'Брест' },
    { lat: 52.4317027, lng: 30.9938685, name: 'Гомель' },
    { lat: 53.8980519, lng: 30.3340392, name: 'Могилёв' },
    { lat: 55.1924057, lng: 30.2067509, name: 'Витебск' },
    { lat: 55.4846103, lng: 28.7775038, name: 'Полоцк' },
    { lat: 54.1010124, lng: 28.3285245, name: 'Жодино' },
    { lat: 52.8163544, lng: 27.5591826, name: 'Солигорск' },
    { lat: 53.1319188, lng: 26.019032, name: 'Барановичи' },
    // ... добавь остальные из твоего cities.html
  ],
  // Добавь другие режимы позже
};

function getRandomLocation(mode) {
  const locations = locationsByMode[mode] || [];
  if (locations.length === 0) return { lat: 53.9, lng: 27.5667, name: 'Минск (заглушка)' };
  return locations[Math.floor(Math.random() * locations.length)];
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // км
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

let queue = [];
let rooms = {}; // roomId → { mode, players: [socketId1, socketId2], currentRound: 1, rounds: [], guesses: {}, timerTimeout: null }

io.on('connection', socket => {
  console.log('🟢 Player connected:', socket.id);

  socket.on('joinQueue', (mode) => {
    queue.push({ socket, mode });
    socket.emit('status', 'Ожидание оппонента...');

    const sameMode = queue.filter(p => p.mode === mode);
    if (sameMode.length >= 2) {
      const p1 = sameMode[0];
      const p2 = sameMode[1];
      queue = queue.filter(p => p !== p1 && p !== p2);

      const roomId = `room-${Date.now()}`;
      rooms[roomId] = {
        mode,
        players: [p1.socket.id, p2.socket.id],
        currentRound: 1,
        rounds: [],
        guesses: {},
        timerTimeout: null
      };

      p1.socket.join(roomId);
      p2.socket.join(roomId);

      io.to(roomId).emit('gameStart', { roomId, mode });
      startNewRound(roomId);
    }
  });

  socket.on('sendGuess', ({ roomId, lat, lng }) => {
    const room = rooms[roomId];
    if (!room) return;

    const round = room.currentRound;
    room.guesses[round] = room.guesses[round] || {};
    room.guesses[round][socket.id] = { lat, lng };

    // Первый угадал → запускаем таймер 30 сек
    if (Object.keys(room.guesses[round]).length === 1) {
      io.to(roomId).emit('startTimer');
      room.timerTimeout = setTimeout(() => endRound(roomId), 30000);
    }

    // Оба угадали → завершаем раунд немедленно
    if (Object.keys(room.guesses[round]).length === 2) {
      clearTimeout(room.timerTimeout);
      endRound(roomId);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 Player disconnected:', socket.id);
    queue = queue.filter(p => p.socket.id !== socket.id);

    for (const roomId in rooms) {
      if (rooms[roomId].players.includes(socket.id)) {
        io.to(roomId).emit('opponentDisconnected');
        clearTimeout(rooms[roomId].timerTimeout);
        delete rooms[roomId];
      }
    }
  });
});

function startNewRound(roomId) {
  const room = rooms[roomId];
  const location = getRandomLocation(room.mode);
  room.rounds.push(location);
  room.guesses[room.currentRound] = {};
  io.to(roomId).emit('newRound', {
    round: room.currentRound,
    location: { lat: location.lat, lng: location.lng }
  });
}

function endRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const round = room.currentRound;
  const guesses = room.guesses[round] || {};
  const realPos = room.rounds[round - 1];

  const results = {};
  for (const playerId in guesses) {
    const g = guesses[playerId];
    const dist = calculateDistance(realPos.lat, realPos.lng, g.lat, g.lng);
    const score = Math.max(0, 5000 - Math.floor(dist * 10)); // твоя формула, адаптируй
    results[playerId] = { dist: Math.round(dist), score };
  }

  const playerIds = Object.keys(results);
  const winner = results[playerIds[0]].score >= results[playerIds[1]].score ? playerIds[0] : playerIds[1];

  io.to(roomId).emit('roundEnd', {
    realLocation: realPos,
    guesses,
    results,
    winner
  });

  if (round < 5) {
    room.currentRound++;
    startNewRound(roomId);
  } else {
    const totalScores = {};
    for (let r = 1; r <= 5; r++) {
      const res = room.results?.[r] || {};
      for (const pid in res) {
        totalScores[pid] = (totalScores[pid] || 0) + res[pid].score;
      }
    }
    const finalWinner = Object.keys(totalScores).reduce((a, b) => totalScores[a] > totalScores[b] ? a : b);
    io.to(roomId).emit('gameEnd', { totalScores, finalWinner });
    delete rooms[roomId];
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
