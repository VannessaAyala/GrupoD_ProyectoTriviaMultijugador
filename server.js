require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');

const adminRoutes = require('./routes/adminRoutes');
const { initGameSocket } = require('./sockets/gameSocket');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Habilitar la lectura de cookies en el Servidor Express

// Parser manual de cookies rápido para Socket.io sin dependencias externas extras
function parseCookies(cookieString) {
  const list = {};
  if (!cookieString) return list;
  cookieString.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}

// Middleware de Socket.io para autenticar la conexión del Administrador usando JWT
io.use((socket, next) => {
  try {
    const rawCookies = socket.request.headers.cookie;
    const cookies = parseCookies(rawCookies);
    const token = cookies.admin_token;

    if (token) {
      // Validamos el JWT. Si es válido, guardamos la sesión decodificada en el socket.
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mi_secreto_super_seguro');
      socket.request.admin = decoded;
    }
  } catch (err) {
    console.log('Socket conectado sin autenticación JWT:', err.message);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/admin', adminRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'login.html'));
});

app.get('/player/lobby', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'lobby.html'));
});

app.get('/player/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'game.html'));
});

app.get('/player/results', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'results.html'));
});

initGameSocket(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Servidor corriendo en puerto ' + PORT);
});
