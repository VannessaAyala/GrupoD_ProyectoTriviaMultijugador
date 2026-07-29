require('dotenv').config();
const { runConsumer } = require('./base/consumerRunner');
const { query } = require('../database/database');
const logger = require('../config/logger').child('consumer-alertas-respuestas');

const CONSUMER_ID = process.env.CONSUMER_ID || 'alertas-1';
const UMBRAL_TARDANZA = 0.85;
const RACHA_MINIMA = 3;
const PROCESAMIENTO_DELAY_MS = 800;

const rachaErroresPorJugador = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evaluarAlerta(payload) {
  const jugadorId = payload.jugador_id;
  const rachaPrevia = rachaErroresPorJugador.get(jugadorId) || 0;
  const nuevaRacha = payload.es_correcta ? 0 : rachaPrevia + 1;
  rachaErroresPorJugador.set(jugadorId, nuevaRacha);

  const esTardia = payload.tiempo_limite_ms > 0
    && (payload.tiempo_respuesta_ms / payload.tiempo_limite_ms) >= UMBRAL_TARDANZA;
  const esRachaErrores = nuevaRacha >= RACHA_MINIMA;

  if (esTardia) return { aplica: true, tipo: 'respuesta_tardia' };
  if (esRachaErrores) return { aplica: true, tipo: 'racha_errores' };
  return { aplica: false, tipo: null };
}

async function iniciar() {
  await runConsumer({
    queue: 'trivia.alertas.respuestas',
    prefetch: 3,
    consumerTag: `alertas-respuestas-${CONSUMER_ID}`,
    onMessage: async (payload, { ack, nack }) => {
      await delay(PROCESAMIENTO_DELAY_MS);

      if (typeof payload.jugador_id !== 'number' || typeof payload.tiempo_respuesta_ms !== 'number') {
        logger.warn('Evento de respuesta con datos insuficientes para evaluar alerta', { payload, consumerId: CONSUMER_ID });
        nack(false);
        return;
      }

      const evaluacion = evaluarAlerta(payload);

      if (!evaluacion.aplica) {
        logger.debug('Respuesta no cumple condiciones de alerta, se rechaza hacia la DLQ', {
          codigo: payload.codigo,
          jugador_id: payload.jugador_id,
          consumerId: CONSUMER_ID
        });
        nack(false);
        return;
      }

      await query(
        `INSERT INTO alertas_jugador (sala_codigo, sala_id, jugador_id, tipo, detalle) VALUES ($1,$2,$3,$4,$5)`,
        [payload.codigo, payload.sala_id, payload.jugador_id, evaluacion.tipo, JSON.stringify(payload)]
      );

      logger.warn('Alerta de jugador generada', {
        codigo: payload.codigo,
        jugador_id: payload.jugador_id,
        tipo: evaluacion.tipo,
        consumerId: CONSUMER_ID
      });
      ack();
    }
  });
}

iniciar().catch((err) => {
  logger.fatal('No se pudo iniciar el consumidor de alertas de respuestas', { error: err.message, stack: err.stack });
  process.exit(1);
});
