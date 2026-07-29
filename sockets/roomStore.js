const crypto = require('crypto');
const { redisClient } = require('../config/redis');
const logger = require('../config/logger').child('roomStore');

// Las salas quedan huérfanas si nadie las cierra explícitamente (admin caído, etc).
// Se les pone un TTL en Redis para que no se acumulen para siempre.
const ROOM_TTL_SECONDS = 6 * 60 * 60; // 6 horas
const LOCK_TTL_MS = 5000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_WAIT_MS = 4000;

function roomKey(codigo) {
  return `room:${codigo}`;
}

function lockKey(codigo) {
  return `lock:room:${codigo}`;
}

/**
 * Convierte el roomState "de app" (con Map/Set, cómodos de usar en JS)
 * a un objeto plano serializable en JSON para guardarlo en Redis.
 */
function serializar(roomState) {
  return JSON.stringify({
    ...roomState,
    players: Array.from(roomState.players.entries()),
    answeredThisQuestion: Array.from(roomState.answeredThisQuestion)
  });
}

/**
 * Hace el proceso inverso: reconstruye Map/Set a partir de lo leído de Redis
 * para que el resto de gameSocket.js pueda seguir usando la misma API
 * (roomState.players.get(...), .set(...), etc).
 */
function deserializar(raw) {
  if (!raw) return null;
  const data = JSON.parse(raw);
  return {
    ...data,
    players: new Map(data.players),
    answeredThisQuestion: new Set(data.answeredThisQuestion)
  };
}

async function getRoom(codigo) {
  const raw = await redisClient.get(roomKey(codigo));
  return deserializar(raw);
}

async function saveRoom(codigo, roomState) {
  await redisClient.set(roomKey(codigo), serializar(roomState), 'EX', ROOM_TTL_SECONDS);
}

async function deleteRoom(codigo) {
  await redisClient.del(roomKey(codigo));
}

/**
 * Ejecuta `fn(roomState)` con un lock distribuido sobre la sala, para evitar
 * condiciones de carrera cuando dos nodos distintos tocan la misma sala al
 * mismo tiempo (p. ej. dos jugadores uniéndose a la vez desde nodos distintos).
 *
 * `fn` recibe el roomState actual (o null si no existe) y debe devolver:
 *   - el roomState modificado -> se guarda en Redis
 *   - null/undefined -> no se guarda nada (por ejemplo, si fn decidió abortar)
 *
 * El valor de retorno de `withRoomLock` es lo que `fn` haya devuelto a su vez
 * como segundo elemento de un array [resultado, nuevoRoomState], para poder
 * devolver datos al llamador (ej: si el nickname ya estaba en uso).
 */
async function withRoomLock(codigo, fn) {
  const token = crypto.randomUUID();
  const key = lockKey(codigo);

  const start = Date.now();
  let adquirido = false;
  while (Date.now() - start < LOCK_MAX_WAIT_MS) {
    const ok = await redisClient.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok) {
      adquirido = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }

  if (!adquirido) {
    logger.warn('No se pudo adquirir el lock de la sala a tiempo', { codigo });
    throw new Error('No se pudo adquirir el lock de la sala, intenta de nuevo');
  }

  try {
    const roomState = await getRoom(codigo);
    const [resultado, nuevoRoomState] = await fn(roomState);
    if (nuevoRoomState) {
      await saveRoom(codigo, nuevoRoomState);
    }
    return resultado;
  } finally {
    // Solo borra el lock si sigue siendo nuestro (evita borrar el lock de
    // otro proceso si el nuestro ya expiró por tardar demasiado).
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redisClient.eval(script, 1, key, token);
  }
}

module.exports = { getRoom, saveRoom, deleteRoom, withRoomLock };
