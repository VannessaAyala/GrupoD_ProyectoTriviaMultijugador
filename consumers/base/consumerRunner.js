const { getConnection } = require('../../messaging/connection');
const { assertTopology } = require('../../messaging/topology');
const { RECONNECT_DELAY_MS } = require('../../config/rabbitmq');
const logger = require('../../config/logger').child('rabbitmq-consumer');

async function runConsumer({ queue, prefetch = 1, consumerTag, onMessage }) {
  const connection = await getConnection();
  const channel = await connection.createChannel();
  await assertTopology(channel);
  await channel.prefetch(prefetch);

  let cerrado = false;

  channel.on('error', (err) => {
    logger.error('Error en el canal del consumidor', { queue, consumerTag, error: err.message });
  });

  channel.on('close', () => {
    if (cerrado) return;
    cerrado = true;
    logger.warn('Canal del consumidor cerrado, reintentando', { queue, consumerTag, reintentoEnMs: RECONNECT_DELAY_MS });
    setTimeout(() => {
      runConsumer({ queue, prefetch, consumerTag, onMessage }).catch((err) => {
        logger.fatal('No se pudo reiniciar el consumidor', { queue, consumerTag, error: err.message });
      });
    }, RECONNECT_DELAY_MS);
  });

  await channel.consume(
    queue,
    async (msg) => {
      if (!msg) return;

      let payload;
      try {
        payload = JSON.parse(msg.content.toString());
      } catch (err) {
        logger.error('Mensaje con formato no parseable, se envía a DLQ', { queue, consumerTag, error: err.message });
        channel.nack(msg, false, false);
        return;
      }

      try {
        await onMessage(payload, {
          ack: () => channel.ack(msg),
          nack: (requeue = false) => channel.nack(msg, false, requeue)
        }, msg);
      } catch (err) {
        logger.error('Fallo no controlado procesando mensaje, se envía a DLQ', { queue, consumerTag, error: err.message, stack: err.stack });
        channel.nack(msg, false, false);
      }
    },
    { consumerTag }
  );

  logger.info('Consumidor escuchando cola', { queue, consumerTag, prefetch });

  return channel;
}

module.exports = { runConsumer };
