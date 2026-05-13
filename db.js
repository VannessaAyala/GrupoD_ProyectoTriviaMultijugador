const sql = require('mssql');

const config = {
    user: 'sa',
    password: '1234',
    server: 'localhost',
    database: 'TriviaLiveDB',
    port: 1433,
    options: {
        trustServerCertificate: true,
        encrypt: false
    }
};

let pool = null;

async function conectarDB() {
    try {
        if (pool) return pool;
        pool = await sql.connect(config);
        console.log('SQL Server conectado');
        return pool;
    } catch (error) {
        console.error('Error al conectar a SQL Server:', error.message);
        throw error;
    }
}

module.exports = {
    conectarDB
};
