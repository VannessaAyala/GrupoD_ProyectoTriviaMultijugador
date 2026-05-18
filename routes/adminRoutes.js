const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const { query } = require('../database/database');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin_id) {
    return next();
  }
  res.redirect('/admin/login');
}

router.get('/login', (req, res) => {
  if (req.session && req.session.admin_id) {
    return res.redirect('/admin/dashboard');
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
      return res.json({ success: false, mensaje: 'Credenciales incorrectas' });
    }

    const admin = result.rows[0];
    const passwordOk = await bcrypt.compare(password, admin.password_hash);
    if (!passwordOk) {
      return res.json({ success: false, mensaje: 'Credenciales incorrectas' });
    }

    req.session.admin_id = admin.id;
    req.session.admin_username = admin.username;

    res.json({ success: true, redirect: '/admin/dashboard' });
  } catch (err) {
    console.error('Error login admin:', err.message);
    res.json({ success: false, mensaje: 'Error del servidor' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
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
    console.error('Error api/quizzes:', err.message);
    res.json({ success: false, mensaje: 'Error al cargar quizzes' });
  }
});

router.get('/api/me', requireAdmin, (req, res) => {
  res.json({
    success: true,
    admin_id: req.session.admin_id,
    username: req.session.admin_username
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

    res.json({ success: true, quiz_id, total_preguntas: preguntas.length });
  } catch (err) {
    console.error('Error crear quiz:', err.message);
    res.json({ success: false, mensaje: 'Error al guardar el quiz' });
  }
});

router.delete('/api/quizzes/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM quizzes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error eliminar quiz:', err.message);
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
    console.error('Error api/admins:', err.message);
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

    res.json({ success: true, username: userLimpio });
  } catch (err) {
    console.error('Error crear admin:', err.message);
    res.json({ success: false, mensaje: 'Error al crear el admin' });
  }
});

router.delete('/api/admins/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.session.admin_id) {
      return res.json({ success: false, mensaje: 'No puedes eliminarte' });
    }
    const total = await query('SELECT COUNT(*) as total FROM admins');
    if (parseInt(total.rows[0].total) <= 1) {
      return res.json({ success: false, mensaje: 'No puedes eliminar el único admin' });
    }
    await query('DELETE FROM admins WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error eliminar admin:', err.message);
    res.json({ success: false, mensaje: 'Error al eliminar el admin' });
  }
});

router.put('/api/admins/:id/password', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (parseInt(id) !== req.session.admin_id) {
      return res.json({ success: false, mensaje: 'No autorizado' });
    }
    if (!password || password.length < 6) {
      return res.json({ success: false, mensaje: 'Mínimo 6 caracteres' });
    }
    const hash = await bcrypt.hash(password, 10);
    await query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error cambiar password:', err.message);
    res.json({ success: false, mensaje: 'Error al cambiar la contraseña' });
  }
});

module.exports = router;
