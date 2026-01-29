const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); // Папка с HTML/JS/CSS

/* Локации для разных режимов (расширь по своим файлам) */
const locationsByMode = {
  cities: [
    { lat: 53.9, lng: 27.5667, name: 'Минск' },
    // Добавь твои локации из cities.html
  ],
  memory: [
    { lat: 53.1462946, lng: 26.0717056, name: 'Памятник 1' },
    // Из memory.html
  ],
  // Добавь для museums, sport, study, countries
};

function getRandomLocation(mode) {
  const locations = locationsByMode[mode] || [];
  return locations[Math.floor(Math.random() * locations.length)];
}

/* Комнаты и очередь */
let queue = []; // Очередь игроков
let rooms = {}; // roomId → { mode, players: [socket1, socket2], currentRound: 1, rounds: [] }

io.on('connection', socket => {
  console.log('🟢 Player connected:', socket.id);

  socket.on('joinQueue', (mode) => {
    queue.push({ socket, mode });
    socket.emit('status', 'Ожидание оппонента...');

    // Проверяем пару с тем же mode
    const sameModePlayers = queue.filter(p => p.mode === mode);
    if (sameModePlayers.length >= 2) {
      const player1 = sameModePlayers[0];
      const player2 = sameModePlayers[1];
      queue = queue.filter(p => p !== player1 && p !== player2);

      const roomId = `room-${Date.now()}`;
      rooms[roomId] = {
        mode,
        players: [player1.socket.id, player2.socket.id],
        currentRound: 1,
        rounds: []
      };

      player1.socket.join(roomId);
      player2.socket.join(roomId);

      io.to(roomId).emit('gameStart', { roomId, mode });
      startRound(roomId);
    }
  });

  socket.on('sendGuess', ({ roomId, lat, lng }) => {
    const room = rooms[roomId];
    if (!room) return;

    const round = room.rounds[room.currentRound - 1];
    const playerKey = socket.id === room.players[0] ? 'player1' : 'player2';
    round.guesses[playerKey] = { lat, lng };

    if (round.guesses.player1 && round.guesses.player2) {
      // Рассчитываем расстояния и очки (используй твою Haversine)
      const realPos = round.location;
      const dist1 = calculateDistance(realPos.lat, realPos.lng, round.guesses.player1.lat, round.guesses.player1.lng);
      const dist2 = calculateDistance(realPos.lat, realPos.lng, round.guesses.player2.lat, round.guesses.player2.lng);
      const score1 = Math.max(5000 - Math.floor(dist1), 0);
      const score2 = Math.max(5000 - Math.floor(dist2), 0);

      io.to(roomId).emit('roundEnd', {
        realLocation: realPos,
        guesses: round.guesses,
        scores: { player1: score1, player2: score2 },
        distances: { player1: dist1, player2: dist2 }
      });

      if (room.currentRound < 5) {
        room.currentRound++;
        startRound(roomId);
      } else {
        io.to(roomId).emit('gameEnd', room.rounds);
        delete rooms[roomId];
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 Player disconnected:', socket.id);
    queue = queue.filter(p => p.socket !== socket);
    // Если в комнате — завершить игру
    for (const roomId in rooms) {
      if (rooms[roomId].players.includes(socket.id)) {
        io.to(roomId).emit('opponentDisconnected');
        delete rooms[roomId];
      }
    }
  });
});

function startRound(roomId) {
  const room = rooms[roomId];
  const location = getRandomLocation(room.mode);
  room.rounds.push({ location, guesses: {} });
  io.to(roomId).emit('newRound', { round: room.currentRound, location: { lat: location.lat, lng: location.lng } }); // Без name для угадывания
}

// Твоя функция расстояния (добавь из HTML)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Радиус Земли
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
