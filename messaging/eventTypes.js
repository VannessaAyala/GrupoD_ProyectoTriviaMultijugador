const ROUTING_KEYS = {
  salaCreada: (codigo) => `sala.${codigo}.creada`,
  jugadorUnion: (codigo) => `sala.${codigo}.jugador.union`,
  partidaIniciada: (codigo) => `sala.${codigo}.partida.iniciada`,
  partidaTerminada: (codigo) => `sala.${codigo}.partida.terminada`,
  respuesta: (codigo) => `sala.${codigo}.respuesta`
};

const DLQ_ROUTING_KEYS = {
  respuestaInvalida: 'dlq.respuesta.invalida',
  alertaRechazada: 'dlq.alerta.rechazada',
  salaAbandonada: 'dlq.sala.abandonada'
};

module.exports = { ROUTING_KEYS, DLQ_ROUTING_KEYS };
