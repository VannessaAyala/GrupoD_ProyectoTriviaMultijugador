const { EXCHANGE_EVENTOS, EXCHANGE_DLX, SALA_TTL_MS } = require('../config/rabbitmq');
const { DLQ_ROUTING_KEYS } = require('./eventTypes');

const QUEUES = [
  {
    name: 'trivia.analitica.respuestas',
    bindingKey: 'sala.*.respuesta',
    options: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': EXCHANGE_DLX,
        'x-dead-letter-routing-key': DLQ_ROUTING_KEYS.respuestaInvalida
      }
    }
  },
  {
    name: 'trivia.alertas.respuestas',
    bindingKey: 'sala.*.respuesta',
    options: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': EXCHANGE_DLX,
        'x-dead-letter-routing-key': DLQ_ROUTING_KEYS.alertaRechazada
      }
    }
  },
  {
    name: 'trivia.partidas.eventos',
    bindingKey: 'sala.*.partida.*',
    options: { durable: true }
  },
  {
    name: 'trivia.salas.espera_inicio',
    bindingKey: 'sala.*.creada',
    options: {
      durable: true,
      arguments: {
        'x-message-ttl': SALA_TTL_MS,
        'x-dead-letter-exchange': EXCHANGE_DLX,
        'x-dead-letter-routing-key': DLQ_ROUTING_KEYS.salaAbandonada
      }
    }
  }
];

const DLQ_QUEUES = [
  { name: 'trivia.dlq.respuestas_invalidas', bindingKey: DLQ_ROUTING_KEYS.respuestaInvalida },
  { name: 'trivia.dlq.alertas_rechazadas', bindingKey: DLQ_ROUTING_KEYS.alertaRechazada },
  { name: 'trivia.dlq.salas_abandonadas', bindingKey: DLQ_ROUTING_KEYS.salaAbandonada }
];

async function assertTopology(channel) {
  await channel.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGE_DLX, 'topic', { durable: true });

  for (const q of QUEUES) {
    await channel.assertQueue(q.name, q.options);
    await channel.bindQueue(q.name, EXCHANGE_EVENTOS, q.bindingKey);
  }

  for (const q of DLQ_QUEUES) {
    await channel.assertQueue(q.name, { durable: true });
    await channel.bindQueue(q.name, EXCHANGE_DLX, q.bindingKey);
  }
}

module.exports = { assertTopology, QUEUES, DLQ_QUEUES, EXCHANGE_EVENTOS, EXCHANGE_DLX };
