const { Pool } = require('pg');
const logger = require('../config/logger').child('database');

const isProduction = process.env.NODE_ENV === 'production';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:123@localhost:5432/trivia_db';

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000
});

pool.connect((err, client, release) => {
  if (err) {
    logger.fatal('No se pudo conectar a PostgreSQL', { error: err.message });
    return;
  }
  logger.info('Conectado a PostgreSQL correctamente');
  release();
});

pool.on('error', (err) => {
  logger.error('Error inesperado en el pool de PostgreSQL', { error: err.message });
});

async function query(text, params) {
  const inicio = Date.now();
  try {
    const result = await pool.query(text, params);
    const duracionMs = Date.now() - inicio;

    if (duracionMs > 200) {
      logger.warn('Query lenta detectada', { query: text, duration_ms: duracionMs, rows: result.rowCount });
    } else {
      logger.trace('Query ejecutada', { query: text, duration_ms: duracionMs, rows: result.rowCount });
    }

    return result;
  } catch (err) {
    logger.error('Error ejecutando query', { query: text, error: err.message });
    throw err;
  }
}

module.exports = { pool, query };
