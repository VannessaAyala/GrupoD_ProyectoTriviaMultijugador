const { query } = require('../database/database');
const logger = require('../config/logger').child('gameSocket');
const { publishEvent } = require('../messaging/publisher');
const { ROUTING_KEYS } = require('../messaging/eventTypes');
const { getRoom, saveRoom, deleteRoom, withRoomLock } = require('./roomStore');

// El estado de cada sala (jugadores, pregunta actual, puntajes...) YA NO vive
// acá en memoria: vive en Redis (ver roomStore.js), para que sea visible
// desde cualquiera de los 5 nodos del clúster, sin importar a cuál se haya
// conectado cada jugador.
//
// Lo único que sigue siendo local a este proceso es el `setInterval` del
// cronómetro de cada pregunta (un intervalo de JS no se puede guardar en
// Redis). Vive únicamente en el nodo donde está conectado el admin de esa
// sala, y cada segundo valida contra Redis si la pregunta ya fue revelada
// (por ejemplo, porque el último jugador respondió en OTRO nodo) para
// detenerse solo si corresponde.
const timers = new Map(); // roomCode -> intervalHandle (solo de este proceso)

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

function limpiarTimerLocal(roomCode) {
  if (timers.has(roomCode)) {
    clearInterval(timers.get(roomCode));
    timers.delete(roomCode);
  }
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

        await saveRoom(codigo, {
          sala_id,
          adminSocketId: socket.id,
          quiz_id,
          preguntas,
          currentQuestionIndex: -1,
          partida_id: null,
          players: new Map(),
          answeredThisQuestion: new Set(),
          timerStartedAt: null,
          tiempoLimiteMsActual: null,
          respuestaRevelada: false,
          estado: 'lobby'
        });

        socket.join(codigo);
        socket.roomCode = codigo;
        socket.isAdmin = true;

        logger.info('Sala de juego creada', { codigo, sala_id, quiz_id, admin_id, total_preguntas: preguntas.length, ip: ipSocket });

        socket.emit('room_created', { codigo, sala_id, totalPreguntas: preguntas.length });

        publishEvent(ROUTING_KEYS.salaCreada(codigo), {
          sala_id,
          codigo,
          quiz_id,
          admin_id,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        logger.error('Error al crear la sala', { socket_id: socket.id, quiz_id, admin_id, ip: ipSocket, error: err.message, stack: err.stack });
        socket.emit('error_sala', { mensaje: 'Error al crear la sala' });
      }
    });

    socket.on('join_room', async ({ roomCode, nickname }) => {
      const code = roomCode.toUpperCase().trim();
      const nick = nickname.trim();
      try {
        if (!nick || nick.length < 2 || nick.length > 50) {
          socket.emit('join_error', { mensaje: 'Nickname inválido' });
          return;
        }

        const resultado = await withRoomLock(code, async (roomState) => {
          if (!roomState) {
            return [{ tipo: 'sin_sala' }, null];
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
              return [{ tipo: 'partida_iniciada' }, null];
            }
            const { oldSocketId, player } = jugadorExistente;
            roomState.players.delete(oldSocketId);
            player.conectado = true;
            roomState.players.set(socket.id, player);
            return [{ tipo: 'reconectado', player }, roomState];
          }

          if (jugadorExistente) {
            return [{ tipo: 'nickname_en_uso' }, null];
          }

          return [{ tipo: 'nuevo', sala_id: roomState.sala_id }, roomState];
        });

        if (resultado.tipo === 'sin_sala') {
          logger.warn('Intento de unirse a sala inexistente', { socket_id: socket.id, codigo: code, nickname: nick, ip: ipSocket });
          socket.emit('join_error', { mensaje: 'Sala no encontrada' });
          return;
        }
        if (resultado.tipo === 'partida_iniciada') {
          socket.emit('join_error', { mensaje: 'La partida ya comenzó' });
          return;
        }
        if (resultado.tipo === 'nickname_en_uso') {
          socket.emit('join_error', { mensaje: 'Nickname en uso' });
          return;
        }

        if (resultado.tipo === 'reconectado') {
          const { player } = resultado;
          socket.join(code);
          socket.roomCode = code;
          socket.isAdmin = false;
          socket.jugador_id = player.jugador_id;

          await query('UPDATE jugadores SET socket_id = $1, conectado = true WHERE id = $2', [socket.id, player.jugador_id]);

          logger.info('Jugador reconectado a partida en curso', { codigo: code, nickname: nick, jugador_id: player.jugador_id, ip: ipSocket });

          socket.emit('join_success', { nickname: nick, roomCode: code });
          return;
        }

        // resultado.tipo === 'nuevo'
        const dbResult = await query(
          'INSERT INTO jugadores (sala_id, nickname, socket_id, puntaje) VALUES ($1, $2, $3, 0) RETURNING id',
          [resultado.sala_id, nick, socket.id]
        );
        const jugador_id = dbResult.rows[0].id;

        const playersArray = await withRoomLock(code, async (roomState) => {
          if (!roomState) return [{ players: [], adminSocketId: null }, null];
          roomState.players.set(socket.id, { nickname: nick, jugador_id, puntaje: 0, conectado: true });
          const arr = getPlayersArray(roomState);
          return [{ players: arr, adminSocketId: roomState.adminSocketId }, roomState];
        });

        socket.join(code);
        socket.roomCode = code;
        socket.isAdmin = false;
        socket.jugador_id = jugador_id;

        logger.info('Jugador se unió a la sala', { codigo: code, nickname: nick, jugador_id, sala_id: resultado.sala_id, total_jugadores: playersArray.players.length, ip: ipSocket });

        socket.emit('join_success', { nickname: nick, roomCode: code });

        io.to(code).emit('player_joined', { nickname: nick, players: playersArray.players });
        io.to(playersArray.adminSocketId).emit('room_update', { players: playersArray.players, totalJugadores: playersArray.players.length });

        publishEvent(ROUTING_KEYS.jugadorUnion(code), {
          sala_id: resultado.sala_id,
          codigo: code,
          jugador_id,
          nickname: nick,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        logger.error('Error al unirse a la sala', { socket_id: socket.id, roomCode, ip: ipSocket, error: err.message, stack: err.stack });
        socket.emit('join_error', { mensaje: 'Error al unirse' });
      }
    });

    socket.on('start_game', async ({ roomCode }) => {
      try {
        const datos = await withRoomLock(roomCode, async (roomState) => {
          if (!roomState || socket.id !== roomState.adminSocketId || roomState.estado !== 'lobby') return [null, null];
          if (roomState.players.size === 0) return [{ error: 'sin_jugadores' }, null];
          return [{
            sala_id: roomState.sala_id,
            jugadores: [...roomState.players.values()].map(p => p.nickname),
            totalJugadores: roomState.players.size
          }, roomState];
        });

        if (!datos) return;
        if (datos.error === 'sin_jugadores') {
          socket.emit('error_sala', { mensaje: 'No hay jugadores' });
          return;
        }

        const result = await query('INSERT INTO partidas (sala_id, pregunta_actual) VALUES ($1, 0) RETURNING id', [datos.sala_id]);
        const partida_id = result.rows[0].id;
        await query('UPDATE salas SET estado = $1 WHERE id = $2', ['jugando', datos.sala_id]);

        const roomStateFinal = await withRoomLock(roomCode, async (roomState) => {
          if (!roomState) return [null, null];
          roomState.partida_id = partida_id;
          roomState.estado = 'jugando';
          return [roomState, roomState];
        });

        logger.info('Partida iniciada', {
          codigo: roomCode,
          sala_id: datos.sala_id,
          partida_id,
          total_jugadores: datos.totalJugadores,
          jugadores: datos.jugadores
        });

        io.to(roomCode).emit('start_game', { totalPreguntas: roomStateFinal.preguntas.length });

        publishEvent(ROUTING_KEYS.partidaIniciada(roomCode), {
          sala_id: datos.sala_id,
          codigo: roomCode,
          partida_id,
          total_jugadores: datos.totalJugadores,
          evento: 'iniciada',
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        logger.error('Error al iniciar la partida', { roomCode, error: err.message, stack: err.stack });
      }
    });

    socket.on('next_question', async ({ roomCode }) => {
      try {
        const roomState = await getRoom(roomCode);
        if (!roomState || socket.id !== roomState.adminSocketId || roomState.estado !== 'jugando') return;

        // El cronómetro de la pregunta anterior (si existe) es local a este
        // nodo, porque el admin siempre dispara next_question desde el mismo
        // nodo al que está conectado.
        limpiarTimerLocal(roomCode);

        const idx = roomState.currentQuestionIndex + 1;

        if (idx >= roomState.preguntas.length) {
          socket.emit('no_more_questions', {});
          return;
        }

        const pregunta = roomState.preguntas[idx];

        await withRoomLock(roomCode, async (rs) => {
          if (!rs) return [null, null];
          rs.currentQuestionIndex = idx;
          rs.answeredThisQuestion = new Set();
          rs.tiempoLimiteMsActual = pregunta.tiempo_segundos * 1000;
          rs.timerStartedAt = Date.now();
          rs.respuestaRevelada = false;
          return [null, rs];
        });

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
        const interval = setInterval(async () => {
          try {
            // Puede que otro nodo ya haya revelado la respuesta (porque el
            // último jugador conectado a ÉL contestó antes de que acabara el
            // tiempo). En ese caso, este nodo solo necesita enterarse y parar.
            const freshState = await getRoom(roomCode);
            if (!freshState || freshState.currentQuestionIndex !== idx || freshState.respuestaRevelada) {
              limpiarTimerLocal(roomCode);
              return;
            }

            s--;
            io.to(roomCode).emit('timer', { segundos: s });

            if (s <= 0) {
              limpiarTimerLocal(roomCode);
              await revelarSiCorresponde(io, roomCode, pregunta, idx);
            }
          } catch (err) {
            logger.error('Error en el cronómetro de la pregunta', { roomCode, error: err.message });
          }
        }, 1000);
        timers.set(roomCode, interval);
      } catch (err) {
        logger.error('Error al avanzar pregunta', { roomCode, error: err.message, stack: err.stack });
      }
    });

    socket.on('submit_answer', async ({ roomCode, respuesta }) => {
      try {
        let datosDB = null;

        const resultado = await withRoomLock(roomCode, async (roomState) => {
          if (!roomState || roomState.estado !== 'jugando' || roomState.currentQuestionIndex < 0) return [null, null];

          const player = roomState.players.get(socket.id);
          if (!player || roomState.answeredThisQuestion.has(player.jugador_id)) return [null, null];
          if (!['A', 'B', 'C', 'D'].includes(respuesta)) return [null, null];

          roomState.answeredThisQuestion.add(player.jugador_id);

          const pregunta = roomState.preguntas[roomState.currentQuestionIndex];
          const t = Date.now() - roomState.timerStartedAt;
          const correct = respuesta === pregunta.correcta;
          const pts = correct ? calcularPuntos(t, roomState.tiempoLimiteMsActual) : 0;

          player.puntaje += pts;
          roomState.players.set(socket.id, player);

          const conectados = [...roomState.players.values()].filter(p => p.conectado).length;
          const respondidos = [...roomState.answeredThisQuestion].filter(jid =>
            [...roomState.players.values()].some(p => p.jugador_id === jid && p.conectado)
          ).length;

          let leaderboard = null;
          if (respondidos >= conectados && !roomState.respuestaRevelada) {
            roomState.respuestaRevelada = true;
            leaderboard = getLeaderboard(roomState);
          }

          datosDB = {
            partida_id: roomState.partida_id,
            jugador_id: player.jugador_id,
            pregunta_id: pregunta.id,
            sala_id: roomState.sala_id,
            respuesta,
            correct,
            pts,
            t,
            tiempoLimiteMsActual: roomState.tiempoLimiteMsActual,
            nickname: player.nickname
          };

          return [{
            correct,
            pts,
            puntajeTotal: player.puntaje,
            respondidos,
            conectados,
            leaderboard,
            respuestaCorrecta: pregunta.correcta,
            adminSocketId: roomState.adminSocketId
          }, roomState];
        });

        if (!resultado || !datosDB) return;

        await query(
          'INSERT INTO respuestas (partida_id, jugador_id, pregunta_id, respuesta_dada, es_correcta, puntos_ganados, tiempo_respuesta_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [datosDB.partida_id, datosDB.jugador_id, datosDB.pregunta_id, datosDB.respuesta, datosDB.correct, datosDB.pts, datosDB.t]
        );
        await query('UPDATE jugadores SET puntaje = $1 WHERE id = $2', [resultado.puntajeTotal, datosDB.jugador_id]);

        logger.trace('Respuesta de jugador registrada', {
          codigo: roomCode,
          jugador_id: datosDB.jugador_id,
          nickname: datosDB.nickname,
          pregunta_id: datosDB.pregunta_id,
          respuesta: datosDB.respuesta,
          correcta: resultado.respuestaCorrecta,
          es_correcta: datosDB.correct,
          puntos_ganados: datosDB.pts,
          tiempo_respuesta_ms: datosDB.t,
          ip: ipSocket
        });

        socket.emit('answer_result', { esCorrecta: resultado.correct, puntosGanados: resultado.pts, puntajeTotal: resultado.puntajeTotal });

        publishEvent(ROUTING_KEYS.respuesta(roomCode), {
          sala_id: datosDB.sala_id,
          codigo: roomCode,
          partida_id: datosDB.partida_id,
          jugador_id: datosDB.jugador_id,
          nickname: datosDB.nickname,
          pregunta_id: datosDB.pregunta_id,
          respuesta_dada: datosDB.respuesta,
          es_correcta: datosDB.correct,
          puntos_ganados: datosDB.pts,
          tiempo_respuesta_ms: datosDB.t,
          tiempo_limite_ms: datosDB.tiempoLimiteMsActual,
          timestamp: new Date().toISOString()
        });

        io.to(resultado.adminSocketId).emit('answers_update', { respondidos: resultado.respondidos, total: resultado.conectados, ultimoNickname: datosDB.nickname });

        if (resultado.leaderboard) {
          // Puede que el timer siga corriendo en el nodo del admin (otro
          // proceso); él mismo se dará cuenta en su próximo tick (máx. 1s)
          // gracias a `respuestaRevelada`. Si el timer está en ESTE nodo, se
          // limpia de una vez para no esperar ese tick.
          limpiarTimerLocal(roomCode);
          io.to(roomCode).emit('question_result', { respuestaCorrecta: resultado.respuestaCorrecta, leaderboard: resultado.leaderboard });
        }
      } catch (err) {
        logger.error('Error al procesar respuesta', { roomCode, socket_id: socket.id, error: err.message, stack: err.stack });
      }
    });

    socket.on('game_finished', async ({ roomCode }) => {
      try {
        const roomState = await getRoom(roomCode);
        if (roomState && socket.id === roomState.adminSocketId) await terminarPartida(io, roomCode, roomState);
      } catch (err) {
        logger.error('Error al finalizar la partida', { roomCode, error: err.message, stack: err.stack });
      }
    });

    socket.on('get_leaderboard', async ({ roomCode }) => {
      const roomState = await getRoom(roomCode);
      if (roomState && socket.id === roomState.adminSocketId) socket.emit('leaderboard', { leaderboard: getLeaderboard(roomState) });
    });

    socket.on('disconnect', async () => {
      const roomCode = socket.roomCode;
      if (!roomCode) {
        logger.debug('Socket desconectado sin sala asociada', { socket_id: socket.id, ip: ipSocket });
        return;
      }

      try {
        if (socket.isAdmin) {
          const roomState = await getRoom(roomCode);
          if (!roomState) return;
          logger.warn('Administrador de sala desconectado', { codigo: roomCode, sala_id: roomState.sala_id, ip: ipSocket });
          limpiarTimerLocal(roomCode);
          io.to(roomCode).emit('admin_disconnected', { mensaje: 'Admin desconectado' });
          return;
        }

        const datos = await withRoomLock(roomCode, async (roomState) => {
          if (!roomState) return [null, null];
          const player = roomState.players.get(socket.id);
          if (!player) return [null, null];
          player.conectado = false;
          roomState.players.set(socket.id, player);
          return [{ player, playersArray: getPlayersArray(roomState), adminSocketId: roomState.adminSocketId }, roomState];
        });

        if (!datos) return;

        await query('UPDATE jugadores SET conectado = false WHERE id = $1', [datos.player.jugador_id]);
        logger.info('Jugador desconectado de la sala', { codigo: roomCode, nickname: datos.player.nickname, jugador_id: datos.player.jugador_id, puntaje_al_salir: datos.player.puntaje, ip: ipSocket });

        io.to(datos.adminSocketId).emit('room_update', { players: datos.playersArray, totalJugadores: datos.playersArray.length });
        io.to(roomCode).emit('player_left', { nickname: datos.player.nickname, players: datos.playersArray });
      } catch (err) {
        logger.error('Error al procesar desconexión', { roomCode, socket_id: socket.id, error: err.message, stack: err.stack });
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

// Usado desde el cronómetro cuando se agota el tiempo (a diferencia de
// submit_answer, acá SÍ puede haber una condición de carrera con el propio
// jugador contestando justo en el límite, por eso también pasa por el lock).
async function revelarSiCorresponde(io, roomCode, preguntaEsperada, idxEsperado) {
  const leaderboard = await withRoomLock(roomCode, async (roomState) => {
    if (!roomState || roomState.respuestaRevelada || roomState.currentQuestionIndex !== idxEsperado) {
      return [null, null];
    }
    roomState.respuestaRevelada = true;
    return [getLeaderboard(roomState), roomState];
  });

  if (leaderboard) {
    io.to(roomCode).emit('question_result', { respuestaCorrecta: preguntaEsperada.correcta, leaderboard });
  }
}

async function terminarPartida(io, roomCode, roomStateInicial) {
  try {
    limpiarTimerLocal(roomCode);

    const roomStateActual = (await getRoom(roomCode)) || roomStateInicial;

    await query('UPDATE salas SET estado = $1 WHERE id = $2', ['terminada', roomStateActual.sala_id]);
    await query('UPDATE partidas SET terminada_en = NOW() WHERE id = $1', [roomStateActual.partida_id]);

    const leaderboard = getLeaderboard(roomStateActual);

    logger.info('Partida finalizada', {
      codigo: roomCode,
      sala_id: roomStateActual.sala_id,
      partida_id: roomStateActual.partida_id,
      total_jugadores: roomStateActual.players.size,
      ganador: leaderboard[0]?.nickname || 'sin jugadores'
    });

    io.to(roomCode).emit('game_finished', { leaderboard });

    publishEvent(ROUTING_KEYS.partidaTerminada(roomCode), {
      sala_id: roomStateActual.sala_id,
      codigo: roomCode,
      partida_id: roomStateActual.partida_id,
      total_jugadores: roomStateActual.players.size,
      ganador: leaderboard[0]?.nickname || null,
      evento: 'terminada',
      timestamp: new Date().toISOString()
    });

    setTimeout(() => { deleteRoom(roomCode).catch(() => {}); }, 30000);
  } catch (err) {
    logger.error('Error al terminar la partida', { roomCode, error: err.message, stack: err.stack });
  }
}

module.exports = { initGameSocket };
