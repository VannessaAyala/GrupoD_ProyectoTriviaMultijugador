const express = require('express');
const http = require('http');
const path = require('path');
const net = require('net');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

app.use(express.static(path.join(__dirname, 'public')));

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

function sendQuestion() {
    if (!gameRunning) return;

    if (questionIndex >= questions.length) {
        gameRunning = false;
        clearInterval(timer);
        io.emit('game_over', getSafePlayers());
        console.log('Juego finalizado');
        return;
    }

    const question = questions[questionIndex];
    let time = 15;

    io.emit('enviar_pregunta', question);
    io.emit('timer', time);
    console.log(`Pregunta ${questionIndex + 1}`);

    timer = setInterval(() => {
        time--;
        io.emit('timer', time);

        if (time <= 0) {
            clearInterval(timer);
            questionIndex++;
            setTimeout(sendQuestion, 2000);
        }
    }, 1000);
}

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

const tcpServer = net.createServer((socket) => {
    console.log('Admin conectado');
    socket.write('ADMIN PANEL READY\n');

    socket.on('data', async (data) => {
        const command = data.toString().trim().toUpperCase();

        if (command === 'START') {
            if (gameRunning) {
                socket.write('Aviso: El juego ya esta iniciado\n');
                return;
            }
            questionIndex = 0;
            gameRunning = true;
            clearInterval(timer);
            players.forEach(p => p.puntos = 0);
            await db.resetearPuntos();
            broadcastPlayers();
            io.emit('game_started');
            socket.write('Juego iniciado\n');
            setTimeout(sendQuestion, 2000);
        } else if (command === 'PLAYERS') {
            if (players.length === 0) {
                socket.write('No hay jugadores conectados\n');
                return;
            }
            let text = '\n===== JUGADORES =====\n';
            players.forEach((p, i) => {
                text += `${i + 1}. ${p.nombre} (${p.puntos} pts)\n`;
            });
            text += '=====================\n';
            socket.write(text);
        } else if (command === 'STATUS') {
            socket.write(`
=========================
ESTADO DEL SERVIDOR
=========================
Juego activo: ${gameRunning ? 'SI' : 'NO'}
Jugadores: ${players.length}
Pregunta actual: ${questionIndex + 1}
=========================\n`);
        } else if (command === 'RESET') {
            gameRunning = false;
            questionIndex = 0;
            clearInterval(timer);
            players.forEach(p => p.puntos = 0);
            await db.resetearPuntos();
            broadcastPlayers();
            socket.write('Juego reiniciado\n');
        } else {
            socket.write('Error: Comando invalido\n');
        }
    });

    socket.on('close', () => console.log('Admin desconectado'));
});

async function startServer() {
    try {
        await db.crearTablas();
        server.listen(3000, () => {
            console.log('HTTP Server en http://localhost:3000');
        });
        tcpServer.listen(4000, () => {
            console.log('Admin TCP Server en puerto 4000');
        });
    } catch (error) {
        console.error('Error al iniciar el servidor:', error.message);
    }
}

startServer();
