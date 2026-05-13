const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Gestión de conexiones Socket.io
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    socket.on('disconnect', () => {
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
