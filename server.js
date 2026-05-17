const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
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

const sessionMiddleware = session({
  secret: 'trivia_secret_key_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 4,
    httpOnly: true
  }
});

app.use(sessionMiddleware);

io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
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

const PORT = 3000;
server.listen(PORT, () => {
  console.log('Servidor corriendo en puerto ' + PORT);
  console.log('Admin: http://localhost:' + PORT + '/admin/login');
});
