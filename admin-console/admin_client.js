const net = require('net');
const readline = require('readline');

const PORT = 4000;
const HOST = 'localhost';

const client = new net.Socket();

client.connect(PORT, HOST, () => {
    console.log('Admin conectado');
});