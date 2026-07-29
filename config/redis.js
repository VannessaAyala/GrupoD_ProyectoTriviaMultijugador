const Redis = require('ioredis');
const logger = require('./logger').child('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Cliente Redis de propósito general (roomStore, locks, etc).
 * Se reutiliza esta misma instancia en toda la app en vez de abrir
 * una conexión nueva por archivo.
 */
const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  }
});

redisClient.on('connect', () => logger.info('Conectado a Redis', { url: REDIS_URL }));
redisClient.on('error', (err) => logger.error('Error de conexión a Redis', { error: err.message }));

/**
 * El adaptador de Socket.IO y connect-redis necesitan sus PROPIAS
 * conexiones (no pueden compartir el cliente que hace comandos normales,
 * porque el modo pub/sub bloquea la conexión para otros comandos).
 * `duplicate()` crea una nueva conexión con la misma configuración.
 */
function crearClienteDuplicado() {
  return redisClient.duplicate();
}

module.exports = { redisClient, crearClienteDuplicado };
