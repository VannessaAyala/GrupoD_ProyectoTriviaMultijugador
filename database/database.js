const { Pool } = require('pg');

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
    console.error('Error conectando a PostgreSQL:', err.message);
    return;
  }
  console.log('Conectado a PostgreSQL');
  release();
});

async function query(text, params) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    console.error('Error en query:', text);
    throw err;
  }
}


module.exports = { pool, query };
