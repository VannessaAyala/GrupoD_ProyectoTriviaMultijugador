// ======================================================
// ADMIN_CLIENT.JS
// Panel administrador TCP - Trivia Live
// ======================================================

const net = require('net');
const readline = require('readline');

// ======================================================
// CONFIG
// ======================================================

const PORT = 4000;
const HOST = 'localhost';

// ======================================================
// CLIENTE TCP
// ======================================================

const client = new net.Socket();

// ======================================================
// READLINE
// ======================================================

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ======================================================
// CONECTAR
// ======================================================

client.connect(PORT, HOST, () => {

    console.clear();

    console.log('======================================');
    console.log('🎮 TRIVIA LIVE - ADMIN PANEL');
    console.log('======================================');
    console.log('');
    console.log('Comandos disponibles:');
    console.log('');
    console.log('START      -> Iniciar partida');
    console.log('PLAYERS    -> Ver jugadores');
    console.log('STATUS     -> Ver estado');
    console.log('RESET      -> Reiniciar juego');
    console.log('HELP       -> Ver ayuda');
    console.log('EXIT       -> Salir');
    console.log('');
    console.log('======================================');
    console.log('');
});

// ======================================================
// RESPUESTAS SERVIDOR
// ======================================================

client.on('data', (data) => {

    console.log('');
    console.log('=========== SERVIDOR ===========');
    console.log(data.toString());
    console.log('================================');
    console.log('');
});

// ======================================================
// ERROR
// ======================================================

client.on('error', (err) => {

    console.log('');
    console.log('❌ ERROR TCP');
    console.log(err.message);
    console.log('');
});

// ======================================================
// CIERRE
// ======================================================

client.on('close', () => {

    console.log('');
    console.log('🔴 Conexión cerrada');
    console.log('');

    rl.close();

    process.exit();
});

// ======================================================
// COMANDOS
// ======================================================

rl.on('line', (input) => {

    const comando = input.trim().toUpperCase();

    if (!comando) return;

    switch (comando) {

        case 'HELP':

            console.log('');
            console.log('============= AYUDA =============');
            console.log('START      -> Iniciar partida');
            console.log('PLAYERS    -> Ver jugadores');
            console.log('STATUS     -> Estado del juego');
            console.log('RESET      -> Reiniciar partida');
            console.log('EXIT       -> Cerrar administrador');
            console.log('=================================');
            console.log('');

            break;

        case 'EXIT':

            console.log('');
            console.log('👋 Cerrando administrador...');
            console.log('');

            rl.close();

            client.destroy();

            break;

        default:

            client.write(comando);

            break;
    }
});