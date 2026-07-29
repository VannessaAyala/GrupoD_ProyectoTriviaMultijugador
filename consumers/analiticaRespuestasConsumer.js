require('dotenv').config();
const { runConsumer } = require('./base/consumerRunner');
const { query } = require('../database/database');
const logger = require('../config/logger').child('consumer-analitica-respuestas');

const CONSUMER_ID = process.env.CONSUMER_ID || 'analitica-1';

function esRespuestaValida(payload) {
  return !!payload
    && typeof payload.sala_id === 'number'
    && typeof payload.jugador_id === 'number'
    && typeof payload.pregunta_id === 'number'
    && ['A', 'B', 'C', 'D', null].includes(payload.respuesta_dada)
    && typeof payload.tiempo_respuesta_ms === 'number'
    && payload.tiempo_respuesta_ms >= 0;
}

async function iniciar() {
  await runConsumer({
    queue: 'trivia.analitica.respuestas',
    prefetch: 5,
    consumerTag: `analitica-respuestas-${CONSUMER_ID}`,
    onMessage: async (payload, { ack, nack }) => {
      if (!esRespuestaValida(payload)) {
        logger.warn('Respuesta con formato inválido, se rechaza hacia la DLQ', { payload, consumerId: CONSUMER_ID });
        nack(false);
        return;
      }

      await query(
        `INSERT INTO eventos_analitica_respuestas
           (sala_codigo, sala_id, partida_id, jugador_id, pregunta_id, es_correcta, puntos_ganados, tiempo_respuesta_ms, tiempo_limite_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          payload.codigo,
          payload.sala_id,
          payload.partida_id,
          payload.jugador_id,
          payload.pregunta_id,
          payload.es_correcta,
          payload.puntos_ganados,
          payload.tiempo_respuesta_ms,
          payload.tiempo_limite_ms
        ]
      );

      logger.info('Evento de respuesta procesado y almacenado en analítica', {
        codigo: payload.codigo,
        jugador_id: payload.jugador_id,
        pregunta_id: payload.pregunta_id,
        consumerId: CONSUMER_ID
      });
      ack();
    }
  });
}

iniciar().catch((err) => {
  logger.fatal('No se pudo iniciar el consumidor de analítica de respuestas', { error: err.message, stack: err.stack });
  process.exit(1);
});
