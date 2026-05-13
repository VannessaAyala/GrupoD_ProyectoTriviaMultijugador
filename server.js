const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Estado global del juego
let players = [];
let questionIndex = 0;
let gameRunning = false;
let timer = null;

const questions = [
    {
        pregunta: 'Capital de Ecuador?',
        opciones: ['Quito', 'Guayaquil', 'Cuenca', 'Loja'],
        correcta: 'Quito'
    },
    {
        pregunta: '2 + 2 = ?',
        opciones: ['2', '3', '4', '5'],
        correcta: '4'
    },
    {
        pregunta: '8 x 7 = ?',
        opciones: ['54', '56', '64', '72'],
        correcta: '56'
    }
];

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Funciones auxiliares
function getSafePlayers() {
    return players.map(p => ({
        nombre: String(p.nombre || 'Jugador'),
        puntos: Number(p.puntos || 0)
    }));
}

function broadcastPlayers() {
    const data = getSafePlayers();
    io.emit('update_players', data);
    io.emit('ranking', data);
}

// Gestión de conexiones Socket.io
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    socket.on('join_lobby', async (nombre) => {
        try {
            const cleanName = String(nombre || '').trim();
            if (!cleanName) return;

            let player = players.find(p => p.socketId === socket.id);
            if (!player) {
                player = { socketId: socket.id, nombre: cleanName, puntos: 0 };
                players.push(player);
                await db.insertarJugador(cleanName);
                console.log(`Jugador unido: ${cleanName}`);
            }
            broadcastPlayers();
        } catch (error) {
            console.error(error.message);
        }
    });

    socket.on('respuesta_usuario', async ({ respuesta }) => {
        try {
            const player = players.find(p => p.socketId === socket.id);
            if (!player) return;

            const question = questions[questionIndex];
            if (question && respuesta === question.correcta) {
                player.puntos += 100;
                await db.actualizarPuntos(player.nombre, player.puntos);
                console.log(`${player.nombre} +100`);
            }
            broadcastPlayers();
        } catch (error) {
            console.error(error.message);
        }
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.socketId !== socket.id);
        broadcastPlayers();
        console.log(`Usuario desconectado: ${socket.id}`);
    });
});

// Función de inicio de servidor (Base)
async function startServer() {
    try {
        await db.crearTablas();
        server.listen(3000, () => {
            console.log('HTTP Server ejecutándose en http://localhost:3000');
        });
    } catch (error) {
        console.error('Error al iniciar el servidor:', error.message);
    }
}

startServer();
