const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

/* 🔹 Локации (ВАШИ) */
const locations = [
  { lat: 53.1462946, lng: 26.0717056, name: 'Барановичский госуниверситет' },
  { lat: 53.8946001, lng: 27.5447976, name: 'БГПУ им. Танка' },
  { lat: 53.9210342, lng: 27.5584425, name: 'БГУ' },
  { lat: 53.9188117, lng: 27.5937053, name: 'БГУИР' },
  { lat: 55.1777349, lng: 30.2264154, name: 'ВГУ им. Машерова' }
];

function randomLocation() {
  return locations[Math.floor(Math.random() * locations.length)];
}

/* 🔹 Комнаты */
let waitingPlayer = null;
let rooms = {}; // roomId → { players, location, results }

io.on('connection', socket => {
  console.log('🟢 Player connected:', socket.id);

  socket.on('findGame', () => {

    // Если никто не ждёт — ставим в ожидание
    if (!waitingPlayer) {
      waitingPlayer = socket;
      socket.emit('status', 'Ожидание второго игрока...');
      return;
    }

    // Создаём комнату
    const roomId = `room-${waitingPlayer.id}-${socket.id}`;
    const location = randomLocation();

    rooms[roomId] = {
      location,
      results: {}
    };

    waitingPlayer.join(roomId);
    socket.join(roomId);

    io.to(roomId).emit('gameStart', {
      roomId,
      location
    });

    waitingPlayer = null;
  });

  socket.on('sendResult', ({ roomId, score, distance }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].results[socket.id] = { score, distance };

    if (Object.keys(rooms[roomId].results).length === 2) {
      io.to(roomId).emit('gameResult', rooms[roomId].results);
      delete rooms[roomId];
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 Player disconnected:', socket.id);
    if (waitingPlayer === socket) waitingPlayer = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
