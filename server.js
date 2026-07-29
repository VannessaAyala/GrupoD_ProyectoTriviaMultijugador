require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { RedisStore } = require('connect-redis');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const os = require('os');
const adminRoutes = require('./routes/adminRoutes');
const { initGameSocket } = require('./sockets/gameSocket');
const session = require('express-session');
const passport = require('passport');
const authRoutes = require('./routes/authRoutes');
require('./config/passport');
const { redisClient, crearClienteDuplicado } = require('./config/redis');

const logger = require('./config/logger').child('server');
const requestLogger = require('./middleware/requestLogger');

// ANTES estos handlers estaban registrados recién en la línea ~150, después
// de armar toda la app (sesión, Socket.IO, adaptador de Redis, rutas...).
// Cualquier excepción síncrona lanzada ANTES de esa línea (por ejemplo, al
// construir el RedisStore, el adaptador de Socket.IO, etc.) no tenía ningún
// handler todavía y tumbaba el proceso con Node imprimiendo el stack trace
// "crudo" a stderr. Los registramos ACÁ ARRIBA, antes de que se ejecute nada
// más, para garantizar que cualquier falla durante el arranque quede logueada.
//
// Además: antes, `exitOnError: false` en winston + este handler que solo
// hacía logger.fatal(...) SIN cerrar el proceso, significaba que ante una
// excepción no capturada el proceso quedaba "vivo" para siempre, nunca
// escuchando en el puerto, y Docker nunca lo reiniciaba (el healthcheck lo
// marcaba "unhealthy" pero el contenedor seguía "Up" indefinidamente). Ahora
// SÍ cerramos el proceso después de loguear, para que Docker lo reinicie y
// el fallo sea visible en vez de un cuelgue silencioso.
process.on('uncaughtException', (err) => {
  logger.fatal('Excepción no capturada — cerrando el proceso', { error: err.message, stack: err.stack });
  console.error('EXCEPCIÓN NO CAPTURADA:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal('Promesa rechazada sin manejar — cerrando el proceso', {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
  console.error('PROMESA RECHAZADA SIN MANEJAR:', reason);
  process.exit(1);
});

const app = express();
const server = http.createServer(app);

// Antes las sesiones vivían en memoria (MemoryStore por defecto), lo que
// obligaba a que un mismo cliente SIEMPRE cayera en el mismo nodo (de ahí el
// ip_hash en Nginx). Con las sesiones en Redis, cualquiera de los 5 nodos
// puede leer la sesión de cualquier usuario, sin importar cuál la creó.
app.use(session({
  store: new RedisStore({ client: redisClient, prefix: 'sesion:' }),
  secret: process.env.SESSION_SECRET || 'secreto',
  resave: false,
  saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());
app.use('/auth', authRoutes);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Adaptador de Socket.IO sobre Redis: permite que io.to(sala).emit(...) o
// io.to(socketId).emit(...) lleguen a sockets conectados a OTROS nodos del
// clúster (no solo a los conectados a este proceso).
const pubClient = crearClienteDuplicado();
const subClient = crearClienteDuplicado();
io.adapter(createAdapter(pubClient, subClient));
pubClient.on('error', (err) => logger.error('Error en cliente Redis (pub) del adaptador Socket.IO', { error: err.message }));
subClient.on('error', (err) => logger.error('Error en cliente Redis (sub) del adaptador Socket.IO', { error: err.message }));
// ANTES solo se logueaban los errores de estos dos clientes duplicados, nunca
// su conexión exitosa — así que si alguno se quedaba colgado intentando
// conectar (o autenticar) no había forma de verlo en los logs: el único
// "Conectado a Redis" que aparecía era el del cliente principal (config/redis.js),
// no el de estos dos. Agregamos 'ready' para que quede visible.
pubClient.on('ready', () => logger.info('Cliente Redis (pub) del adaptador Socket.IO listo'));
subClient.on('ready', () => logger.info('Cliente Redis (sub) del adaptador Socket.IO listo'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); 

app.use(requestLogger);

// Identifica qué nodo del clúster atendió cada solicitud.
// Útil para verificar la distribución de carga del balanceador (Nginx),
// igual que en el laboratorio del servidor-base.
const NODE_NAME = process.env.NODE_NAME || os.hostname();
app.use((req, res, next) => {
  res.set('X-Node-Name', NODE_NAME);
  next();
});

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

// Ruta de verificación de salud del nodo.
// La usan el healthcheck de Docker y el balanceador Nginx.
app.get('/health', (req, res) => {
  res.status(200).json({
    estado: 'OK',
    nodo: NODE_NAME,
    contenedor: os.hostname(),
    timestamp: new Date().toISOString()
  });
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

// ANTES: si server.listen() fallaba (puerto inválido, permisos, etc.),
// http.Server emite un evento 'error' — sin un listener propio para ese
// evento, Node lo trata como una excepción no capturada. Como el handler de
// 'uncaughtException' de arriba solo logueaba y (antes de este fix) no
// cerraba el proceso, un fallo en listen() quedaba invisible: el contenedor
// seguía "Up", nunca escuchaba el puerto, y no había ningún mensaje de error
// explicando por qué. Este listener hace visible ese caso puntual.
const PORT = process.env.PORT || 3000;
server.on('error', (err) => {
  logger.fatal('Error al intentar escuchar en el puerto', { port: PORT, error: err.message, code: err.code });
  console.error('ERROR AL ESCUCHAR EN EL PUERTO:', err);
  process.exit(1);
});

// Watchdog de arranque: si en 20s no llegamos a "Servidor iniciado
// correctamente", algo se quedó colgado ANTES de server.listen() (por
// ejemplo, algo síncrono al armar la sesión/Socket.IO/adaptador de Redis).
// El resto del arranque es síncrono salvo I/O real, así que no debería
// tardar más que milisegundos — si el watchdog llega a dispararse, es la
// señal más clara de dónde mirar.
let arrancoOk = false;
const watchdogArranque = setTimeout(() => {
  if (!arrancoOk) {
    logger.fatal('El servidor no terminó de arrancar en 20s — probable cuelgue antes de server.listen()');
    console.error('WATCHDOG: el servidor no llegó a escuchar en el puerto después de 20s.');
  }
}, 20000);
watchdogArranque.unref();

server.listen(PORT, () => {
  arrancoOk = true;
  clearTimeout(watchdogArranque);
  logger.info('Servidor iniciado correctamente', {
    port: PORT,
    entorno: process.env.NODE_ENV || 'development',
    nivelLog: logger.level
  });
});

