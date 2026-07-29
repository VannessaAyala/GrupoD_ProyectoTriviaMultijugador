const { getConnection } = require('./connection');
const { assertTopology, EXCHANGE_EVENTOS } = require('./topology');
const logger = require('../config/logger').child('rabbitmq-publisher');

let channelPromise = null;

async function getPublisherChannel() {
  if (channelPromise) return channelPromise;

  channelPromise = (async () => {
    const connection = await getConnection();
    const channel = await connection.createConfirmChannel();
    await assertTopology(channel);

    channel.on('error', (err) => {
      logger.error('Error en el canal de publicación', { error: err.message });
      channelPromise = null;
    });

    channel.on('close', () => {
      logger.warn('Canal de publicación cerrado');
      channelPromise = null;
    });

    return channel;
  })();

  return channelPromise;
}

async function publishEvent(routingKey, payload) {
  try {
    const channel = await getPublisherChannel();
    const buffer = Buffer.from(JSON.stringify(payload));

    return await new Promise((resolve) => {
      channel.publish(
        EXCHANGE_EVENTOS,
        routingKey,
        buffer,
        { persistent: true, contentType: 'application/json' },
        (err) => {
          if (err) {
            logger.error('Mensaje no confirmado por el broker', { routingKey, error: err.message });
            resolve(false);
          } else {
            logger.debug('Evento publicado en RabbitMQ', { routingKey });
            resolve(true);
          }
        }
      );
    });
  } catch (err) {
    logger.error('No se pudo publicar el evento, el juego continúa sin verse afectado', { routingKey, error: err.message });
    return false;
  }
}

module.exports = { publishEvent, getPublisherChannel };
