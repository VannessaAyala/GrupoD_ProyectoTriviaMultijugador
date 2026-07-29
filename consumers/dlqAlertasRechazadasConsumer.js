require('dotenv').config();
const { runConsumer } = require('./base/consumerRunner');
const { query } = require('../database/database');
const logger = require('../config/logger').child('consumer-dlq-alertas-rechazadas');

async function iniciar() {
  await runConsumer({
    queue: 'trivia.dlq.alertas_rechazadas',
    prefetch: 1,
    consumerTag: 'dlq-alertas-rechazadas-1',
    onMessage: async (payload, { ack }) => {
      await query(
        'INSERT INTO dlq_auditoria (cola_origen, payload) VALUES ($1,$2)',
        ['trivia.alertas.respuestas', JSON.stringify(payload)]
      );
      logger.warn('Mensaje rechazado de alertas registrado desde la DLQ', { payload });
      ack();
    }
  });
}

iniciar().catch((err) => {
  logger.fatal('No se pudo iniciar el consumidor de auditoría de la DLQ de alertas', { error: err.message, stack: err.stack });
  process.exit(1);
});
