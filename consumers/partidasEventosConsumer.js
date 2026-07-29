require('dotenv').config();
const { runConsumer } = require('./base/consumerRunner');
const { query } = require('../database/database');
const logger = require('../config/logger').child('consumer-partidas-eventos');

const CONSUMER_ID = process.env.CONSUMER_ID || 'partidas-1';

async function iniciar() {
  await runConsumer({
    queue: 'trivia.partidas.eventos',
    prefetch: 1,
    consumerTag: `partidas-eventos-${CONSUMER_ID}`,
    onMessage: async (payload, { ack, nack }) => {
      if (!payload || !payload.codigo || !payload.evento) {
        logger.warn('Evento de partida sin datos mínimos', { payload, consumerId: CONSUMER_ID });
        nack(false);
        return;
      }

      await query(
        `INSERT INTO partidas_eventos_log (sala_codigo, sala_id, partida_id, evento, consumer_id, detalle) VALUES ($1,$2,$3,$4,$5,$6)`,
        [payload.codigo, payload.sala_id, payload.partida_id, payload.evento, CONSUMER_ID, JSON.stringify(payload)]
      );

      logger.info('Evento de partida procesado', {
        codigo: payload.codigo,
        evento: payload.evento,
        consumerId: CONSUMER_ID
      });
      ack();
    }
  });
}

iniciar().catch((err) => {
  logger.fatal('No se pudo iniciar el consumidor de eventos de partida', { error: err.message, stack: err.stack });
  process.exit(1);
});
