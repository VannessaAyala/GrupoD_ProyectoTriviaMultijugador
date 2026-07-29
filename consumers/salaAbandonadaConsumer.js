require('dotenv').config();
const { runConsumer } = require('./base/consumerRunner');
const { query } = require('../database/database');
const logger = require('../config/logger').child('consumer-sala-abandonada');

async function iniciar() {
  await runConsumer({
    queue: 'trivia.dlq.salas_abandonadas',
    prefetch: 1,
    consumerTag: 'sala-abandonada-1',
    onMessage: async (payload, { ack, nack }) => {
      if (!payload || !payload.sala_id) {
        logger.warn('Mensaje de sala expirada sin sala_id', { payload });
        nack(false);
        return;
      }

      const resultado = await query('SELECT estado FROM salas WHERE id = $1', [payload.sala_id]);
      const sala = resultado.rows[0];

      if (!sala || sala.estado !== 'lobby') {
        logger.info('Sala expirada ya no está en lobby, no se marca como abandonada', {
          sala_id: payload.sala_id,
          codigo: payload.codigo,
          estadoActual: sala ? sala.estado : 'inexistente'
        });
        ack();
        return;
      }

      await query('UPDATE salas SET estado = $1 WHERE id = $2', ['abandonada', payload.sala_id]);
      await query('INSERT INTO salas_abandonadas_log (sala_id, sala_codigo) VALUES ($1,$2)', [payload.sala_id, payload.codigo]);

      logger.warn('Sala marcada como abandonada por expiración de TTL', { sala_id: payload.sala_id, codigo: payload.codigo });
      ack();
    }
  });
}

iniciar().catch((err) => {
  logger.fatal('No se pudo iniciar el consumidor de salas abandonadas', { error: err.message, stack: err.stack });
  process.exit(1);
});
