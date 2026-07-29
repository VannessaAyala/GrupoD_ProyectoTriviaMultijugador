ALTER TABLE salas DROP CONSTRAINT IF EXISTS salas_estado_check;
ALTER TABLE salas ADD CONSTRAINT salas_estado_check CHECK (estado IN ('lobby','jugando','terminada','abandonada'));

CREATE TABLE IF NOT EXISTS eventos_analitica_respuestas (
  id SERIAL PRIMARY KEY,
  sala_codigo VARCHAR(10),
  sala_id INTEGER,
  partida_id INTEGER,
  jugador_id INTEGER,
  pregunta_id INTEGER,
  es_correcta BOOLEAN,
  puntos_ganados INTEGER,
  tiempo_respuesta_ms INTEGER,
  tiempo_limite_ms INTEGER,
  procesado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alertas_jugador (
  id SERIAL PRIMARY KEY,
  sala_codigo VARCHAR(10),
  sala_id INTEGER,
  jugador_id INTEGER,
  tipo VARCHAR(30),
  detalle JSONB,
  creada_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partidas_eventos_log (
  id SERIAL PRIMARY KEY,
  sala_codigo VARCHAR(10),
  sala_id INTEGER,
  partida_id INTEGER,
  evento VARCHAR(30),
  consumer_id VARCHAR(50),
  detalle JSONB,
  procesado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salas_abandonadas_log (
  id SERIAL PRIMARY KEY,
  sala_id INTEGER,
  sala_codigo VARCHAR(10),
  marcada_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dlq_auditoria (
  id SERIAL PRIMARY KEY,
  cola_origen VARCHAR(100),
  payload JSONB,
  recibido_en TIMESTAMP DEFAULT NOW()
);
