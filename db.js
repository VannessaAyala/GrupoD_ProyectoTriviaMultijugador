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

async function crearTablas() {
    try {
        const db = await conectarDB();
        await db.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Jugadores')
            CREATE TABLE Jugadores (
                Id INT PRIMARY KEY IDENTITY(1,1),
                Nombre VARCHAR(50) UNIQUE NOT NULL,
                Puntos INT DEFAULT 0,
                FechaRegistro DATETIME DEFAULT GETDATE()
            );

            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Partidas')
            CREATE TABLE Partidas (
                Id INT PRIMARY KEY IDENTITY(1,1),
                CodigoSala VARCHAR(20),
                Estado VARCHAR(20),
                FechaInicio DATETIME DEFAULT GETDATE()
            );

            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Preguntas')
            CREATE TABLE Preguntas (
                Id INT PRIMARY KEY IDENTITY(1,1),
                Pregunta VARCHAR(300),
                Opcion1 VARCHAR(100),
                Opcion2 VARCHAR(100),
                Opcion3 VARCHAR(100),
                Opcion4 VARCHAR(100),
                Correcta VARCHAR(100)
            );

            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Respuestas')
            CREATE TABLE Respuestas (
                Id INT PRIMARY KEY IDENTITY(1,1),
                JugadorId INT,
                PreguntaId INT,
                Respuesta VARCHAR(100),
                Correcta BIT,
                Tiempo INT,
                Fecha DATETIME DEFAULT GETDATE()
            );
        `);
        console.log('Esquema de base de datos verificado');
    } catch (error) {
        console.error('Error al crear tablas:', error.message);
    }
}

async function insertarJugador(nombre) {
    try {
        const db = await conectarDB();
        const existe = await db.request()
            .input('nombre', sql.VarChar, nombre)
            .query('SELECT 1 FROM Jugadores WHERE Nombre = @nombre');

        if (existe.recordset.length === 0) {
            await db.request()
                .input('nombre', sql.VarChar, nombre)
                .query('INSERT INTO Jugadores (Nombre) VALUES (@nombre)');
            console.log(`Jugador registrado: ${nombre}`);
        }
    } catch (error) {
        console.error('Error al insertar jugador:', error.message);
    }
}

async function obtenerJugadores() {
    try {
        const db = await conectarDB();
        const result = await db.request().query('SELECT Nombre, Puntos FROM Jugadores ORDER BY Puntos DESC');
        return result.recordset;
    } catch (error) {
        console.error('Error al obtener jugadores:', error.message);
        return [];
    }
}

async function actualizarPuntos(nombre, puntos) {
    try {
        const db = await conectarDB();
        await db.request()
            .input('nombre', sql.VarChar, nombre)
            .input('puntos', sql.Int, puntos)
            .query('UPDATE Jugadores SET Puntos = @puntos WHERE Nombre = @nombre');
    } catch (error) {
        console.error('Error al actualizar puntos:', error.message);
    }
}

async function resetearPuntos() {
    try {
        const db = await conectarDB();
        await db.request().query('UPDATE Jugadores SET Puntos = 0');
        console.log('Puntajes reiniciados');
    } catch (error) {
        console.error('Error al resetear puntos:', error.message);
    }
}

module.exports = {
    conectarDB,
    crearTablas,
    insertarJugador,
    obtenerJugadores,
    actualizarPuntos,
    resetearPuntos
};
