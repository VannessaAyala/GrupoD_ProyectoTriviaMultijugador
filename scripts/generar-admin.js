const bcrypt = require('bcrypt');
const { query } = require('../database/database');

async function generarAdmin() {
  const username = 'admin';
  const password = 'admin123';

  try {
    const hash = await bcrypt.hash(password, 10);
    console.log('Hash generado:', hash);
    console.log('\nEjecuta en PostgreSQL:');
    console.log(`UPDATE admins SET password_hash = '${hash}' WHERE username = '${username}';`);
    console.log('\nO inserta uno nuevo:');
    console.log(`INSERT INTO admins (username, password_hash) VALUES ('${username}', '${hash}');`);

    await query(
      'UPDATE admins SET password_hash = $1 WHERE username = $2',
      [hash, username]
    );
    console.log('\nHash actualizado en la base de datos');
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit(0);
}

generarAdmin();
