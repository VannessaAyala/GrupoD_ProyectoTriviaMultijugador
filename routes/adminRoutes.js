const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const jwt = require('jsonwebtoken');
const { query } = require('../database/database');
const logger = require('../config/logger').child('adminRoutes');
const logReader = require('../config/logReader');
const { listarUsuariosActivos, listarSalasActivas } = logReader;

const router = express.Router();


function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) {
    return res.redirect('/admin/login');
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mi_secreto_super_seguro');
    req.admin_id = decoded.id;
    req.admin_username = decoded.username;
    next();
  } catch (err) {
    logger.warn('Token de admin inválido o expirado', { trace_id: req.traceId, error: err.message });
    res.clearCookie('admin_token');
    return res.redirect('/admin/login');
  }
}

router.get('/login', (req, res) => {
  
  const token = req.cookies?.admin_token;
  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'mi_secreto_super_seguro');
      return res.redirect('/admin/dashboard');
    } catch (e) {
      res.clearCookie('admin_token');
    }
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'admin-login.html'));
});


router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({ success: false, mensaje: 'Completa todos los campos' });
    }

    const result = await query(
      'SELECT id, username, password_hash FROM admins WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      
      
      logger.warn('Intento de login fallido: usuario no existe', { trace_id: req.traceId, username, ip: req.ip });
      return res.json({ success: false, mensaje: 'Credenciales incorrectas' });
    }

    const admin = result.rows[0];
    const passwordOk = await bcrypt.compare(password, admin.password_hash);
    if (!passwordOk) {
      logger.warn('Intento de login fallido: contraseña incorrecta', { trace_id: req.traceId, username, admin_id: admin.id, ip: req.ip });
      return res.json({ success: false, mensaje: 'Credenciales incorrectas' });
    }

    
    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      process.env.JWT_SECRET || 'mi_secreto_super_seguro',
      { expiresIn: '4h' }
    );

    
    res.cookie('admin_token', token, {
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 4 
    });

    logger.info('Login de administrador exitoso', { trace_id: req.traceId, admin_id: admin.id, username: admin.username, ip: req.ip });

    res.json({ success: true, token, redirect: '/admin/dashboard' });
  } catch (err) {
    logger.error('Error en login de admin', { trace_id: req.traceId, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error del servidor' });
  }
});


router.get('/logout', (req, res) => {
  logger.info('Logout de administrador', { trace_id: req.traceId, admin_id: req.admin_id });
  res.clearCookie('admin_token');
  res.redirect('/admin/login');
});

router.get('/dashboard', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'admin-dashboard.html'));
});

router.get('/quizzes', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'admin-quizzes.html'));
});

router.get('/api/quizzes', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT q.id, q.nombre, q.descripcion, COUNT(p.id) as total_preguntas
       FROM quizzes q
       LEFT JOIN preguntas p ON p.quiz_id = q.id
       GROUP BY q.id, q.nombre, q.descripcion
       ORDER BY q.id`
    );
    res.json({ success: true, quizzes: result.rows });
  } catch (err) {
    logger.error('Error al listar quizzes', { trace_id: req.traceId, admin_id: req.admin_id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al cargar quizzes' });
  }
});

router.get('/api/me', requireAdmin, (req, res) => {
  res.json({
    success: true,
    admin_id: req.admin_id,
    username: req.admin_username
  });
});

router.post('/api/quizzes', requireAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, preguntas } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.json({ success: false, mensaje: 'El nombre del quiz es obligatorio' });
    }

    if (!preguntas || preguntas.length === 0) {
      return res.json({ success: false, mensaje: 'El quiz debe tener al menos una pregunta' });
    }

    for (let i = 0; i < preguntas.length; i++) {
      const p = preguntas[i];
      if (!p.texto || !p.opcion_a || !p.opcion_b || !p.opcion_c || !p.opcion_d) {
        return res.json({ success: false, mensaje: `Pregunta ${i + 1}: faltan opciones` });
      }
      if (!['A', 'B', 'C', 'D'].includes(p.correcta)) {
        return res.json({ success: false, mensaje: `Pregunta ${i + 1}: respuesta correcta inválida` });
      }
    }

    const quizResult = await query(
      'INSERT INTO quizzes (nombre, descripcion) VALUES ($1, $2) RETURNING id',
      [nombre.trim(), (descripcion || '').trim()]
    );
    const quiz_id = quizResult.rows[0].id;

    for (const p of preguntas) {
      await query(
        `INSERT INTO preguntas 
          (quiz_id, texto, opcion_a, opcion_b, opcion_c, opcion_d, correcta, categoria, dificultad, tiempo_segundos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          quiz_id,
          p.texto.trim(),
          p.opcion_a.trim(),
          p.opcion_b.trim(),
          p.opcion_c.trim(),
          p.opcion_d.trim(),
          p.correcta,
          (p.categoria || 'General').trim(),
          (p.dificultad || 'media'),
          parseInt(p.tiempo_segundos) || 20
        ]
      );
    }

    
    logger.info('Quiz creado', { trace_id: req.traceId, admin_id: req.admin_id, quiz_id, nombre: nombre.trim(), total_preguntas: preguntas.length });

    res.json({ success: true, quiz_id, total_preguntas: preguntas.length });
  } catch (err) {
    logger.error('Error al crear quiz', { trace_id: req.traceId, admin_id: req.admin_id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al guardar el quiz' });
  }
});

router.delete('/api/quizzes/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM quizzes WHERE id = $1', [id]);
    
    logger.warn('Quiz eliminado', { trace_id: req.traceId, admin_id: req.admin_id, quiz_id: id });
    res.json({ success: true });
  } catch (err) {
    logger.error('Error al eliminar quiz', { trace_id: req.traceId, admin_id: req.admin_id, quiz_id: req.params.id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al eliminar el quiz' });
  }
});

router.get('/api/admins', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, username, creado_en FROM admins ORDER BY id'
    );
    res.json({ success: true, admins: result.rows });
  } catch (err) {
    logger.error('Error al listar admins', { trace_id: req.traceId, admin_id: req.admin_id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al cargar admins' });
  }
});

router.post('/api/admins', requireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !username.trim()) {
      return res.json({ success: false, mensaje: 'Usuario obligatorio' });
    }
    if (!password || password.length < 6) {
      return res.json({ success: false, mensaje: 'Mínimo 6 caracteres' });
    }

    const userLimpio = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const existe = await query('SELECT id FROM admins WHERE username = $1', [userLimpio]);
    if (existe.rows.length > 0) {
      return res.json({ success: false, mensaje: 'Usuario ya existe' });
    }

    const hash = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
      [userLimpio, hash]
    );

    
    logger.info('Nuevo administrador creado', { trace_id: req.traceId, creado_por: req.admin_id, nuevo_username: userLimpio });

    res.json({ success: true, username: userLimpio });
  } catch (err) {
    logger.error('Error al crear admin', { trace_id: req.traceId, admin_id: req.admin_id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al crear el admin' });
  }
});

router.delete('/api/admins/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.admin_id) {
      return res.json({ success: false, mensaje: 'No puedes eliminarte' });
    }
    const total = await query('SELECT COUNT(*) as total FROM admins');
    if (parseInt(total.rows[0].total) <= 1) {
      return res.json({ success: false, mensaje: 'No puedes eliminar el único admin' });
    }
    await query('DELETE FROM admins WHERE id = $1', [id]);
    logger.warn('Administrador eliminado', { trace_id: req.traceId, eliminado_por: req.admin_id, admin_id_eliminado: id });
    res.json({ success: true });
  } catch (err) {
    logger.error('Error al eliminar admin', { trace_id: req.traceId, admin_id: req.admin_id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al eliminar el admin' });
  }
});

router.put('/api/admins/:id/password', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (parseInt(id) !== req.admin_id) {
      return res.json({ success: false, mensaje: 'No autorizado' });
    }
    if (!password || password.length < 6) {
      return res.json({ success: false, mensaje: 'Mínimo 6 caracteres' });
    }
    const hash = await bcrypt.hash(password, 10);
    await query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, id]);
    
    logger.info('Contraseña de administrador actualizada', { trace_id: req.traceId, admin_id: req.admin_id });
    res.json({ success: true });
  } catch (err) {
    logger.error('Error al cambiar password', { trace_id: req.traceId, admin_id: req.admin_id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al cambiar la contraseña' });
  }
});





router.get('/logs', requireAdmin, (req, res) => {
  logger.debug('Admin abrió el panel de logs', { trace_id: req.traceId, admin_id: req.admin_id });
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'admin-logs.html'));
});


router.get('/api/logs', requireAdmin, (req, res) => {
  try {
    const { fecha, level, module: moduleName, q, usuario, sala, limit, offset } = req.query;
    const resultado = logReader.filtrarLogs({
      fecha: fecha || undefined,
      level: level || undefined,
      module: moduleName || undefined,
      q: q || undefined,
      usuario: usuario || undefined,
      sala: sala || undefined,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    });
    res.json({ success: true, ...resultado });
  } catch (err) {
    logger.error('Error al leer logs desde el panel', { trace_id: req.traceId, admin_id: req.admin_id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al leer los logs' });
  }
});



router.get('/api/logs/meta', requireAdmin, (req, res) => {
  try {
    const fecha = req.query.fecha;
    res.json({
      success: true,
      fechas: logReader.listarFechasDisponibles(),
      modulos: logReader.listarModulos(fecha),
      resumen: logReader.resumenPorNivel(fecha),
      usuarios: listarUsuariosActivos(fecha),
      salas: listarSalasActivas(fecha)
    });
  } catch (err) {
    logger.error('Error al leer metadatos de logs', { trace_id: req.traceId, admin_id: req.admin_id, error: err.message, stack: err.stack });
    res.json({ success: false, mensaje: 'Error al leer metadatos' });
  }
});

module.exports = router;