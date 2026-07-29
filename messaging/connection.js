const amqp = require('amqplib');
const logger = require('../config/logger').child('rabbitmq-connection');
const { RABBITMQ_URL, RECONNECT_DELAY_MS } = require('../config/rabbitmq');

let connection = null;
let connecting = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ocultarCredenciales(url) {
  return url.replace(/\/\/.*@/, '//***@');
}

async function connectWithRetry() {
  for (;;) {
    try {
      const conn = await amqp.connect(RABBITMQ_URL);
      logger.info('Conexión establecida con RabbitMQ', { url: ocultarCredenciales(RABBITMQ_URL) });
      return conn;
    } catch (err) {
      logger.error('No se pudo conectar a RabbitMQ, reintentando', { error: err.message, reintentoEnMs: RECONNECT_DELAY_MS });
      await delay(RECONNECT_DELAY_MS);
    }
  }
}

async function getConnection() {
  if (connection) return connection;
  if (connecting) return connecting;

  connecting = connectWithRetry().then((conn) => {
    connection = conn;
    connecting = null;

    conn.on('error', (err) => {
      logger.error('Error en la conexión de RabbitMQ', { error: err.message });
    });

    conn.on('close', () => {
      logger.warn('Conexión con RabbitMQ cerrada');
      connection = null;
    });

    return conn;
  });

  return connecting;
}

module.exports = { getConnection };
