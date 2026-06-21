
const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}



function listarFechasDisponibles() {
  if (!fs.existsSync(LOGS_DIR)) return [hoyISO()];
  const fechas = fs.readdirSync(LOGS_DIR)
    .map(f => f.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/))
    .filter(Boolean)
    .map(m => m[1])
    .sort()
    .reverse();
  return fechas.length ? fechas : [hoyISO()];
}


function leerArchivoDelDia(fecha) {
  const archivo = path.join(LOGS_DIR, `app-${fecha}.log`);
  if (!fs.existsSync(archivo)) return [];

  const contenido = fs.readFileSync(archivo, 'utf8');
  const lineas = contenido.split('\n').filter(Boolean);

  const entradas = [];
  for (const linea of lineas) {
    try {
      entradas.push(JSON.parse(linea));
    } catch (e) {
      
    }
  }
  return entradas;
}



function filtrarLogs({ fecha, level, module: moduleName, q, usuario, sala, limit = 100, offset = 0 } = {}) {
  const fechaUsada = fecha || hoyISO();
  let entradas = leerArchivoDelDia(fechaUsada);

  if (level) {
    entradas = entradas.filter(e => e.level === level);
  }
  if (moduleName) {
    entradas = entradas.filter(e => e.module === moduleName);
  }

  
  
  if (usuario) {
    const uLower = usuario.toLowerCase();
    entradas = entradas.filter(e => {
      const campos = [e.actor_id, e.actor_name, e.nickname, e.username, e.nuevo_username]
        .filter(Boolean)
        .map(v => String(v).toLowerCase());
      return campos.some(c => c.includes(uLower));
    });
  }

  
  if (sala) {
    const salaUpper = sala.toUpperCase();
    entradas = entradas.filter(e => e.codigo === salaUpper || e.roomCode === salaUpper);
  }

  
  if (q) {
    const qLower = q.toLowerCase();
    entradas = entradas.filter(e => JSON.stringify(e).toLowerCase().includes(qLower));
  }

  
  entradas.reverse();

  const total = entradas.length;
  const pagina = entradas.slice(offset, offset + limit);

  return { fecha: fechaUsada, total, entradas: pagina };
}


function resumenPorNivel(fecha) {
  const fechaUsada = fecha || hoyISO();
  const entradas = leerArchivoDelDia(fechaUsada);
  const resumen = { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
  for (const e of entradas) {
    if (resumen[e.level] !== undefined) resumen[e.level]++;
  }
  return resumen;
}


function listarModulos(fecha) {
  const fechaUsada = fecha || hoyISO();
  const entradas = leerArchivoDelDia(fechaUsada);
  const set = new Set(entradas.map(e => e.module).filter(Boolean));
  return [...set].sort();
}



function listarUsuariosActivos(fecha) {
  const fechaUsada = fecha || hoyISO();
  const entradas = leerArchivoDelDia(fechaUsada);
  const usuarios = new Map(); 

  for (const e of entradas) {
    
    if (e.nickname) {
      const key = `jugador:${e.nickname}`;
      if (!usuarios.has(key)) {
        usuarios.set(key, { tipo: 'jugador', nombre: e.nickname, sala: e.codigo || null });
      }
    }
    
    if (e.actor_type === 'oauth_user' && e.actor_id) {
      const key = `oauth:${e.actor_id}`;
      if (!usuarios.has(key)) {
        usuarios.set(key, { tipo: 'oauth', nombre: e.actor_name || e.actor_id, email: e.actor_id });
      }
    }
    
    if (e.actor_type === 'admin' && e.actor_name) {
      const key = `admin:${e.actor_name}`;
      if (!usuarios.has(key)) {
        usuarios.set(key, { tipo: 'admin', nombre: e.actor_name });
      }
    }
    if (e.username) {
      const key = `admin:${e.username}`;
      if (!usuarios.has(key)) {
        usuarios.set(key, { tipo: 'admin', nombre: e.username });
      }
    }
  }

  return [...usuarios.entries()].map(([id, info]) => ({ id, ...info }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}


function listarSalasActivas(fecha) {
  const fechaUsada = fecha || hoyISO();
  const entradas = leerArchivoDelDia(fechaUsada);
  const salas = new Map();

  for (const e of entradas) {
    if (e.codigo && !salas.has(e.codigo)) {
      salas.set(e.codigo, { codigo: e.codigo, sala_id: e.sala_id || null });
    }
  }
  return [...salas.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

module.exports = {
  listarFechasDisponibles,
  filtrarLogs,
  resumenPorNivel,
  listarModulos,
  listarUsuariosActivos,
  listarSalasActivas,
  hoyISO
};