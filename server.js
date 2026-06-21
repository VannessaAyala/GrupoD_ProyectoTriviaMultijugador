require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const adminRoutes = require('./routes/adminRoutes');
const { initGameSocket } = require('./sockets/gameSocket');
const session = require('express-session');
const passport = require('passport');
const authRoutes = require('./routes/authRoutes');
require('./config/passport');

const logger = require('./config/logger').child('server');
const requestLogger = require('./middleware/requestLogger');

const app = express();
const server = http.createServer(app);
app.use(session({ secret: process.env.SESSION_SECRET || 'secreto', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());
app.use('/auth', authRoutes);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); 

app.use(requestLogger);

function parseCookies(cookieString) {
  const list = {};
  if (!cookieString) return list;
  cookieString.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}

io.use((socket, next) => {
  try {
    const rawCookies = socket.request.headers.cookie;
    const cookies = parseCookies(rawCookies);
    const token = cookies.admin_token;

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mi_secreto_super_seguro');
      socket.request.admin = decoded;
    }
  } catch (err) {

    logger.debug('Socket conectado sin autenticación JWT', { error: err.message, socketId: socket.id });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/admin', adminRoutes);

app.get('/api/user', (req, res) => {
    if (req.user) {
        res.json({ 
            nickname: req.user.displayName, 
            email: req.user.emails[0].value,
            photo: req.user.photos && req.user.photos.length > 0 ? req.user.photos[0].value : null
        });
    } else {
        res.status(401).json({ error: 'No autenticado' });
    }
});

app.get('/perfil', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'perfil.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'login.html'));
});

app.get('/lobby', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'lobby.html'));
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


process.on('uncaughtException', (err) => {
  logger.fatal('Excepción no capturada', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.fatal('Promesa rechazada sin manejar', { reason: reason?.message || reason });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info('Servidor iniciado correctamente', {
    port: PORT,
    entorno: process.env.NODE_ENV || 'development',
    nivelLog: logger.level
  });
});

