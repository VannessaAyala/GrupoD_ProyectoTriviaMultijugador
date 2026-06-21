const { query } = require('../database/database');
const logger = require('../config/logger').child('gameSocket');

const roomStates = new Map();

function generarCodigoSala() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 6; i++) {
    codigo += chars[Math.floor(Math.random() * chars.length)];
  }
  return codigo;
}

function calcularPuntos(tiempoRespuestaMs, tiempoLimiteMs) {
  if (tiempoRespuestaMs >= tiempoLimiteMs) return 0;
  const factor = 1 - (tiempoRespuestaMs / tiempoLimiteMs);
  return Math.round(500 + 500 * factor);
}

function obtenerIpSocket(socket) {
  return socket.handshake?.address || socket.request?.connection?.remoteAddress || 'desconocida';
}

function initGameSocket(io) {
  io.on('connection', (socket) => {
    const ipSocket = obtenerIpSocket(socket);
    logger.debug('Nueva conexión socket establecida', { socket_id: socket.id, ip: ipSocket });

    socket.on('create_room', async ({ quiz_id, admin_id }) => {
      try {
        let codigo;
        let intentos = 0;
        do {
          codigo = generarCodigoSala();
          const existe = await query('SELECT id FROM salas WHERE codigo = $1 AND estado != $2', [codigo, 'terminada']);
          if (existe.rows.length === 0) break;
          intentos++;
        } while (intentos < 10);

        const result = await query(
          'INSERT INTO salas (codigo, admin_id, quiz_id, estado) VALUES ($1, $2, $3, $4) RETURNING id',
          [codigo, admin_id, quiz_id, 'lobby']
        );
        const sala_id = result.rows[0].id;

        const preguntasResult = await query(
          'SELECT id, texto, opcion_a, opcion_b, opcion_c, opcion_d, correcta, categoria, dificultad, tiempo_segundos FROM preguntas WHERE quiz_id = $1 ORDER BY id',
          [quiz_id]
        );
        const preguntas = preguntasResult.rows;

        if (preguntas.length === 0) {
          logger.warn('Intento de crear sala con quiz sin preguntas', { socket_id: socket.id, quiz_id, ip: ipSocket });
          socket.emit('error_sala', { mensaje: 'Este quiz no tiene preguntas' });
          return;
        }

        roomStates.set(codigo, {
          sala_id,
          adminSocketId: socket.id,
          quiz_id,
          preguntas,
          currentQuestionIndex: -1,
          partida_id: null,
          players: new Map(),
          answeredThisQuestion: new Set(),
          timerInterval: null,
          timerStartedAt: null,
          tiempoLimiteMsActual: null,
          estado: 'lobby'
        });

        socket.join(codigo);
        socket.roomCode = codigo;
        socket.isAdmin = true;

        logger.info('Sala de juego creada', { codigo, sala_id, quiz_id, admin_id, total_preguntas: preguntas.length, ip: ipSocket });

        socket.emit('room_created', { codigo, sala_id, totalPreguntas: preguntas.length });
      } catch (err) {
        logger.error('Error al crear la sala', { socket_id: socket.id, quiz_id, admin_id, ip: ipSocket, error: err.message, stack: err.stack });
        socket.emit('error_sala', { mensaje: 'Error al crear la sala' });
      }
    });

    socket.on('join_room', async ({ roomCode, nickname }) => {
      try {
        const code = roomCode.toUpperCase().trim();
        const nick = nickname.trim();

        if (!nick || nick.length < 2 || nick.length > 50) {
          socket.emit('join_error', { mensaje: 'Nickname inválido' });
          return;
        }

        const roomState = roomStates.get(code);
        if (!roomState) {
          logger.warn('Intento de unirse a sala inexistente', { socket_id: socket.id, codigo: code, nickname: nick, ip: ipSocket });
          socket.emit('join_error', { mensaje: 'Sala no encontrada' });
          return;
        }

        let jugadorExistente = null;
        for (const [oldSocketId, player] of roomState.players) {
          if (player.nickname.toLowerCase() === nick.toLowerCase()) {
            jugadorExistente = { oldSocketId, player };
            break;
          }
        }

        if (roomState.estado !== 'lobby') {
          if (!jugadorExistente) {
            socket.emit('join_error', { mensaje: 'La partida ya comenzó' });
            return;
          }

          const { oldSocketId, player } = jugadorExistente;
          roomState.players.delete(oldSocketId);
          player.conectado = true;
          roomState.players.set(socket.id, player);

          socket.join(code);
          socket.roomCode = code;
          socket.isAdmin = false;
          socket.jugador_id = player.jugador_id;

          await query('UPDATE jugadores SET socket_id = $1, conectado = true WHERE id = $2', [socket.id, player.jugador_id]);

          logger.info('Jugador reconectado a partida en curso', { codigo: code, nickname: nick, jugador_id: player.jugador_id, ip: ipSocket });

          socket.emit('join_success', { nickname: nick, roomCode: code });
          return;
        }

        if (jugadorExistente) {
          socket.emit('join_error', { mensaje: 'Nickname en uso' });
          return;
        }

        const result = await query(
          'INSERT INTO jugadores (sala_id, nickname, socket_id, puntaje) VALUES ($1, $2, $3, 0) RETURNING id',
          [roomState.sala_id, nick, socket.id]
        );
        const jugador_id = result.rows[0].id;

        roomState.players.set(socket.id, { nickname: nick, jugador_id, puntaje: 0, conectado: true });

        socket.join(code);
        socket.roomCode = code;
        socket.isAdmin = false;
        socket.jugador_id = jugador_id;

        logger.info('Jugador se unió a la sala', { codigo: code, nickname: nick, jugador_id, sala_id: roomState.sala_id, total_jugadores: roomState.players.size, ip: ipSocket });

        socket.emit('join_success', { nickname: nick, roomCode: code });

        const playersArray = getPlayersArray(roomState);
        io.to(code).emit('player_joined', { nickname: nick, players: playersArray });
        io.to(roomState.adminSocketId).emit('room_update', { players: playersArray, totalJugadores: playersArray.length });
      } catch (err) {
        logger.error('Error al unirse a la sala', { socket_id: socket.id, roomCode, ip: ipSocket, error: err.message, stack: err.stack });
        socket.emit('join_error', { mensaje: 'Error al unirse' });
      }
    });

    socket.on('start_game', async ({ roomCode }) => {
      try {
        const roomState = roomStates.get(roomCode);
        if (!roomState || socket.id !== roomState.adminSocketId || roomState.estado !== 'lobby') return;
        if (roomState.players.size === 0) {
          socket.emit('error_sala', { mensaje: 'No hay jugadores' });
          return;
        }

        const result = await query('INSERT INTO partidas (sala_id, pregunta_actual) VALUES ($1, 0) RETURNING id', [roomState.sala_id]);
        roomState.partida_id = result.rows[0].id;
        await query('UPDATE salas SET estado = $1 WHERE id = $2', ['jugando', roomState.sala_id]);
        roomState.estado = 'jugando';

        logger.info('Partida iniciada', {
          codigo: roomCode,
          sala_id: roomState.sala_id,
          partida_id: roomState.partida_id,
          total_jugadores: roomState.players.size,
          jugadores: [...roomState.players.values()].map(p => p.nickname)
        });

        io.to(roomCode).emit('start_game', { totalPreguntas: roomState.preguntas.length });
      } catch (err) {
        logger.error('Error al iniciar la partida', { roomCode, error: err.message, stack: err.stack });
      }
    });

    socket.on('next_question', async ({ roomCode }) => {
      try {
        const roomState = roomStates.get(roomCode);
        if (!roomState || socket.id !== roomState.adminSocketId || roomState.estado !== 'jugando') return;

        if (roomState.timerInterval) clearInterval(roomState.timerInterval);

        roomState.currentQuestionIndex++;
        const idx = roomState.currentQuestionIndex;

        if (idx >= roomState.preguntas.length) {
          socket.emit('no_more_questions', {});
          return;
        }

        const pregunta = roomState.preguntas[idx];
        roomState.answeredThisQuestion = new Set();
        roomState.tiempoLimiteMsActual = pregunta.tiempo_segundos * 1000;
        roomState.timerStartedAt = Date.now();

        await query('UPDATE partidas SET pregunta_actual = $1 WHERE id = $2', [idx + 1, roomState.partida_id]);

        logger.debug('Enviando pregunta a los jugadores', {
          codigo: roomCode,
          numero: idx + 1,
          total: roomState.preguntas.length,
          pregunta_id: pregunta.id,
          categoria: pregunta.categoria,
          dificultad: pregunta.dificultad
        });

        const pData = {
          numero: idx + 1,
          total: roomState.preguntas.length,
          texto: pregunta.texto,
          opciones: { A: pregunta.opcion_a, B: pregunta.opcion_b, C: pregunta.opcion_c, D: pregunta.opcion_d },
          categoria: pregunta.categoria,
          dificultad: pregunta.dificultad,
          tiempo_segundos: pregunta.tiempo_segundos
        };

        io.to(roomState.adminSocketId).emit('question', { ...pData, respuestaCorrecta: pregunta.correcta, pregunta_id: pregunta.id });
        socket.broadcast.to(roomCode).emit('question', pData);

        let s = pregunta.tiempo_segundos;
        roomState.timerInterval = setInterval(async () => {
          s--;
          io.to(roomCode).emit('timer', { segundos: s });
          if (s <= 0) {
            clearInterval(roomState.timerInterval);
            await revelarRespuesta(io, roomCode, roomState, pregunta);
          }
        }, 1000);
      } catch (err) {
        logger.error('Error al avanzar pregunta', { roomCode, error: err.message, stack: err.stack });
      }
    });

    socket.on('submit_answer', async ({ roomCode, respuesta }) => {
      try {
        const roomState = roomStates.get(roomCode);
        if (!roomState || roomState.estado !== 'jugando' || roomState.currentQuestionIndex < 0) return;

        const player = roomState.players.get(socket.id);
        if (!player || roomState.answeredThisQuestion.has(player.jugador_id)) return;
        if (!['A', 'B', 'C', 'D'].includes(respuesta)) return;

        roomState.answeredThisQuestion.add(player.jugador_id);

        const pregunta = roomState.preguntas[roomState.currentQuestionIndex];
        const t = Date.now() - roomState.timerStartedAt;
        const correct = respuesta === pregunta.correcta;
        const pts = correct ? calcularPuntos(t, roomState.tiempoLimiteMsActual) : 0;

        player.puntaje += pts;
        await query(
          'INSERT INTO respuestas (partida_id, jugador_id, pregunta_id, respuesta_dada, es_correcta, puntos_ganados, tiempo_respuesta_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [roomState.partida_id, player.jugador_id, pregunta.id, respuesta, correct, pts, t]
        );
        await query('UPDATE jugadores SET puntaje = $1 WHERE id = $2', [player.puntaje, player.jugador_id]);

        logger.trace('Respuesta de jugador registrada', {
          codigo: roomCode,
          jugador_id: player.jugador_id,
          nickname: player.nickname,
          pregunta_id: pregunta.id,
          pregunta_num: roomState.currentQuestionIndex + 1,
          respuesta,
          correcta: pregunta.correcta,
          es_correcta: correct,
          puntos_ganados: pts,
          tiempo_respuesta_ms: t,
          ip: ipSocket
        });

        socket.emit('answer_result', { esCorrecta: correct, puntosGanados: pts, puntajeTotal: player.puntaje });

        const conectados = [...roomState.players.values()].filter(p => p.conectado).length;
        const respondidos = [...roomState.answeredThisQuestion].filter(jid => [...roomState.players.values()].some(p => p.jugador_id === jid && p.conectado)).length;

        io.to(roomState.adminSocketId).emit('answers_update', { respondidos, total: conectados, ultimoNickname: player.nickname });

        if (respondidos >= conectados) {
          if (roomState.timerInterval) clearInterval(roomState.timerInterval);
          await revelarRespuesta(io, roomCode, roomState, pregunta);
        }
      } catch (err) {
        logger.error('Error al procesar respuesta', { roomCode, socket_id: socket.id, error: err.message, stack: err.stack });
      }
    });

    socket.on('game_finished', async ({ roomCode }) => {
      try {
        const roomState = roomStates.get(roomCode);
        if (roomState && socket.id === roomState.adminSocketId) await terminarPartida(io, roomCode, roomState);
      } catch (err) {
        logger.error('Error al finalizar la partida', { roomCode, error: err.message, stack: err.stack });
      }
    });

    socket.on('get_leaderboard', ({ roomCode }) => {
      const roomState = roomStates.get(roomCode);
      if (roomState && socket.id === roomState.adminSocketId) socket.emit('leaderboard', { leaderboard: getLeaderboard(roomState) });
    });

    socket.on('disconnect', async () => {
      const roomCode = socket.roomCode;
      if (!roomCode) {
        logger.debug('Socket desconectado sin sala asociada', { socket_id: socket.id, ip: ipSocket });
        return;
      }
      const roomState = roomStates.get(roomCode);
      if (!roomState) return;

      if (socket.isAdmin) {
        logger.warn('Administrador de sala desconectado', { codigo: roomCode, sala_id: roomState.sala_id, ip: ipSocket });
        io.to(roomCode).emit('admin_disconnected', { mensaje: 'Admin desconectado' });
      } else {
        const player = roomState.players.get(socket.id);
        if (player) {
          player.conectado = false;
          await query('UPDATE jugadores SET conectado = false WHERE id = $1', [player.jugador_id]);
          logger.info('Jugador desconectado de la sala', { codigo: roomCode, nickname: player.nickname, jugador_id: player.jugador_id, puntaje_al_salir: player.puntaje, ip: ipSocket });
          const playersArray = getPlayersArray(roomState);
          io.to(roomState.adminSocketId).emit('room_update', { players: playersArray, totalJugadores: playersArray.length });
          io.to(roomCode).emit('player_left', { nickname: player.nickname, players: playersArray });
        }
      }
    });
  });
}

function getLeaderboard(roomState) {
  const players = [];
  for (const [, player] of roomState.players) {
    players.push({ nickname: player.nickname, puntaje: player.puntaje, conectado: player.conectado });
  }
  players.sort((a, b) => b.puntaje - a.puntaje);
  return players.map((p, i) => ({ ...p, posicion: i + 1 }));
}

function getPlayersArray(roomState) {
  const players = [];
  for (const [, player] of roomState.players) {
    players.push({ nickname: player.nickname, puntaje: player.puntaje, conectado: player.conectado });
  }
  return players;
}

async function revelarRespuesta(io, roomCode, roomState, pregunta) {
  io.to(roomCode).emit('question_result', { respuestaCorrecta: pregunta.correcta, leaderboard: getLeaderboard(roomState) });
}

async function terminarPartida(io, roomCode, roomState) {
  try {
    if (roomState.timerInterval) clearInterval(roomState.timerInterval);
    await query('UPDATE salas SET estado = $1 WHERE id = $2', ['terminada', roomState.sala_id]);
    await query('UPDATE partidas SET terminada_en = NOW() WHERE id = $1', [roomState.partida_id]);

    logger.info('Partida finalizada', {
      codigo: roomCode,
      sala_id: roomState.sala_id,
      partida_id: roomState.partida_id,
      total_jugadores: roomState.players.size,
      ganador: getLeaderboard(roomState)[0]?.nickname || 'sin jugadores'
    });

    io.to(roomCode).emit('game_finished', { leaderboard: getLeaderboard(roomState) });
    setTimeout(() => roomStates.delete(roomCode), 30000);
  } catch (err) {
    logger.error('Error al terminar la partida', { roomCode, error: err.message, stack: err.stack });
  }
}


module.exports = { initGameSocket };