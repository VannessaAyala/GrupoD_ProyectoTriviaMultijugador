DROP TABLE IF EXISTS respuestas CASCADE;
DROP TABLE IF EXISTS jugadores CASCADE;
DROP TABLE IF EXISTS partidas CASCADE;
DROP TABLE IF EXISTS salas CASCADE;
DROP TABLE IF EXISTS preguntas CASCADE;
DROP TABLE IF EXISTS quizzes CASCADE;
DROP TABLE IF EXISTS admins CASCADE;
 
CREATE TABLE admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW()
);
 
CREATE TABLE quizzes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  creado_en TIMESTAMP DEFAULT NOW()
);
 
CREATE TABLE preguntas (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  opcion_a VARCHAR(255) NOT NULL,
  opcion_b VARCHAR(255) NOT NULL,
  opcion_c VARCHAR(255) NOT NULL,
  opcion_d VARCHAR(255) NOT NULL,
  correcta CHAR(1) NOT NULL CHECK (correcta IN ('A','B','C','D')),
  categoria VARCHAR(50) DEFAULT 'General',
  dificultad VARCHAR(10) DEFAULT 'media' CHECK (dificultad IN ('facil','media','dificil')),
  tiempo_segundos INTEGER DEFAULT 20
);
 
CREATE TABLE salas (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(10) UNIQUE NOT NULL,
  admin_id INTEGER REFERENCES admins(id),
  quiz_id INTEGER REFERENCES quizzes(id),
  estado VARCHAR(20) DEFAULT 'lobby' CHECK (estado IN ('lobby','jugando','terminada')),
  creada_en TIMESTAMP DEFAULT NOW()
);
 
CREATE TABLE partidas (
  id SERIAL PRIMARY KEY,
  sala_id INTEGER REFERENCES salas(id) ON DELETE CASCADE,
  iniciada_en TIMESTAMP DEFAULT NOW(),
  terminada_en TIMESTAMP,
  pregunta_actual INTEGER DEFAULT 0
);
 
CREATE TABLE jugadores (
  id SERIAL PRIMARY KEY,
  sala_id INTEGER REFERENCES salas(id) ON DELETE CASCADE,
  nickname VARCHAR(50) NOT NULL,
  socket_id VARCHAR(100),
  puntaje INTEGER DEFAULT 0,
  conectado BOOLEAN DEFAULT true,
  unido_en TIMESTAMP DEFAULT NOW()
);
 
CREATE TABLE respuestas (
  id SERIAL PRIMARY KEY,
  partida_id INTEGER REFERENCES partidas(id) ON DELETE CASCADE,
  jugador_id INTEGER REFERENCES jugadores(id) ON DELETE CASCADE,
  pregunta_id INTEGER REFERENCES preguntas(id),
  respuesta_dada CHAR(1),
  es_correcta BOOLEAN,
  puntos_ganados INTEGER DEFAULT 0,
  tiempo_respuesta_ms INTEGER,
  respondida_en TIMESTAMP DEFAULT NOW()
);
 
INSERT INTO admins (username, password_hash) VALUES
('admin', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');
 
INSERT INTO quizzes (nombre, descripcion) VALUES
('Cultura General', 'Preguntas variadas de conocimiento general'),
('Ciencia y Tecnologia', 'Preguntas de ciencia, tecnologia e informatica'),
('Historia Universal', 'Eventos y personajes historicos importantes');
 
INSERT INTO preguntas (quiz_id, texto, opcion_a, opcion_b, opcion_c, opcion_d, correcta, categoria, dificultad, tiempo_segundos) VALUES
(1, 'Cual es el oceano mas grande del mundo?', 'Atlantico', 'Indico', 'Pacifico', 'Artico', 'C', 'Geografia', 'facil', 15),
(1, 'Cuantos paises tiene America del Sur?', '10', '12', '14', '16', 'B', 'Geografia', 'media', 20),
(1, 'Cual es el idioma mas hablado del mundo?', 'Ingles', 'Espanol', 'Mandarin', 'Hindi', 'C', 'Cultura', 'media', 20),
(1, 'Cuantos huesos tiene el cuerpo humano adulto?', '196', '206', '216', '226', 'B', 'Biologia', 'media', 20),
(1, 'Que pais tiene mas territorio en el mundo?', 'China', 'Canada', 'Estados Unidos', 'Rusia', 'D', 'Geografia', 'facil', 15),
(1, 'Cual es la montana mas alta del mundo?', 'K2', 'Mont Blanc', 'Everest', 'Aconcagua', 'C', 'Geografia', 'facil', 15),
(1, 'En que ano llego el hombre a la Luna?', '1965', '1967', '1969', '1971', 'C', 'Historia', 'facil', 15),
(1, 'Cuantos planetas tiene el sistema solar?', '7', '8', '9', '10', 'B', 'Astronomia', 'facil', 15),
(1, 'Cual es el animal mas rapido del mundo?', 'Leon', 'Guepardo', 'Halcon peregrino', 'Antilope', 'C', 'Biologia', 'media', 20),
(1, 'Que instrumento mide la temperatura?', 'Barometro', 'Higrometro', 'Termometro', 'Altimetro', 'C', 'Ciencia', 'facil', 15);
 
INSERT INTO preguntas (quiz_id, texto, opcion_a, opcion_b, opcion_c, opcion_d, correcta, categoria, dificultad, tiempo_segundos) VALUES
(2, 'Que significa CPU en informatica?', 'Computer Processing Unit', 'Central Processing Unit', 'Core Power Unit', 'Central Program Utility', 'B', 'Informatica', 'facil', 15),
(2, 'Quien invento el telefono?', 'Thomas Edison', 'Nikola Tesla', 'Alexander Graham Bell', 'Guglielmo Marconi', 'C', 'Historia', 'facil', 15),
(2, 'Cual es el lenguaje mas usado en web backend segun encuestas?', 'Java', 'Python', 'JavaScript', 'PHP', 'C', 'Programacion', 'media', 20),
(2, 'Que protocolo usa el navegador para hablar con servidores web?', 'FTP', 'SMTP', 'HTTP', 'SSH', 'C', 'Redes', 'facil', 15),
(2, 'Cuantos bits tiene un byte?', '4', '8', '16', '32', 'B', 'Informatica', 'facil', 15),
(2, 'Que empresa creo el sistema operativo Android?', 'Apple', 'Microsoft', 'Google', 'Samsung', 'C', 'Tecnologia', 'facil', 15),
(2, 'Que es SQL?', 'Un lenguaje orientado a objetos', 'Un sistema operativo', 'Un lenguaje para consultar bases de datos', 'Un protocolo de red', 'C', 'Bases de datos', 'media', 20),
(2, 'Cual es la formula quimica del agua?', 'HO', 'H2O', 'H2O2', 'OH', 'B', 'Quimica', 'facil', 15),
(2, 'Que significa RAM?', 'Random Access Memory', 'Read Access Module', 'Rapid Application Mode', 'Random Application Memory', 'A', 'Informatica', 'facil', 15),
(2, 'Cuanto es 2 elevado a la potencia 10?', '512', '1024', '2048', '256', 'B', 'Matematicas', 'media', 20);
 
INSERT INTO preguntas (quiz_id, texto, opcion_a, opcion_b, opcion_c, opcion_d, correcta, categoria, dificultad, tiempo_segundos) VALUES
(3, 'En que ano comenzo la Primera Guerra Mundial?', '1910', '1912', '1914', '1916', 'C', 'Historia', 'facil', 15),
(3, 'Quien fue el primer presidente de Estados Unidos?', 'Abraham Lincoln', 'Thomas Jefferson', 'Benjamin Franklin', 'George Washington', 'D', 'Historia', 'facil', 15),
(3, 'En que ano cayo el Muro de Berlin?', '1985', '1987', '1989', '1991', 'C', 'Historia', 'media', 20),
(3, 'Que civilizacion construyo Machu Picchu?', 'Azteca', 'Maya', 'Inca', 'Olmeca', 'C', 'Historia', 'facil', 15),
(3, 'En que ano Cristobal Colon llego a America?', '1488', '1490', '1492', '1494', 'C', 'Historia', 'facil', 15),
(3, 'Quien fue Napoleon Bonaparte?', 'Rey de Francia', 'Emperador de Francia', 'General ingles', 'Papa de Roma', 'B', 'Historia', 'media', 20),
(3, 'Cuantos anos duro la Segunda Guerra Mundial?', '4 anos', '5 anos', '6 anos', '7 anos', 'C', 'Historia', 'media', 20),
(3, 'En que pais se origino la Revolucion Industrial?', 'Francia', 'Alemania', 'Estados Unidos', 'Reino Unido', 'D', 'Historia', 'media', 20),
(3, 'Quien escribio El Capital?', 'Friedrich Engels', 'Karl Marx', 'Vladimir Lenin', 'Leon Trotsky', 'B', 'Politica', 'dificil', 25),
(3, 'En que ano se fondo la ONU?', '1943', '1945', '1947', '1949', 'B', 'Historia', 'media', 20);
