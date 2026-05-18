const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trivia_db',
  user: 'postgres',
  password: '123',
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