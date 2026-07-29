require('dotenv').config();
const { runConsumer } = require('./base/consumerRunner');
const { query } = require('../database/database');
const logger = require('../config/logger').child('consumer-dlq-respuestas-invalidas');

async function iniciar() {
  await runConsumer({
    queue: 'trivia.dlq.respuestas_invalidas',
    prefetch: 1,
    consumerTag: 'dlq-respuestas-invalidas-1',
    onMessage: async (payload, { ack }) => {
      await query(
        'INSERT INTO dlq_auditoria (cola_origen, payload) VALUES ($1,$2)',
        ['trivia.analitica.respuestas', JSON.stringify(payload)]
      );
      logger.warn('Mensaje inválido de respuestas registrado desde la DLQ', { payload });
      ack();
    }
  });
}

iniciar().catch((err) => {
  logger.fatal('No se pudo iniciar el consumidor de auditoría de la DLQ de respuestas', { error: err.message, stack: err.stack });
  process.exit(1);
});
