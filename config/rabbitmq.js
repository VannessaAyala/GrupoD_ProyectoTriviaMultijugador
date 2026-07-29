const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://trivia:trivia123@localhost:5672';
const EXCHANGE_EVENTOS = 'trivia.eventos';
const EXCHANGE_DLX = 'trivia.dlx';
const SALA_TTL_MS = parseInt(process.env.SALA_TTL_MS || '120000', 10);
const RECONNECT_DELAY_MS = parseInt(process.env.RABBITMQ_RECONNECT_MS || '5000', 10);

module.exports = {
  RABBITMQ_URL,
  EXCHANGE_EVENTOS,
  EXCHANGE_DLX,
  SALA_TTL_MS,
  RECONNECT_DELAY_MS
};
