const express = require('express');
const passport = require('passport');
const logger = require('../config/logger').child('authRoutes');
const router = express.Router();

router.get('/google', (req, res, next) => {
  logger.info('Usuario inició autenticación con Google', { trace_id: req.traceId, ip: req.ip });
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});


router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err || !user) {
      logger.warn('Autenticación con Google fallida', {
        trace_id: req.traceId,
        ip: req.ip,
        motivo: err?.message || info?.message || 'desconocido'
      });
      return res.redirect('/');
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        logger.error('Error al establecer sesión tras login con Google', {
          trace_id: req.traceId,
          error: loginErr.message,
          stack: loginErr.stack
        });
        return res.redirect('/');
      }

      logger.info('Login con Google exitoso', {
        trace_id: req.traceId,
        email: user.emails?.[0]?.value,
        nombre: user.displayName,
        ip: req.ip
      });

      return res.redirect('/perfil');
    });
  })(req, res, next);
});

router.get('/logout', (req, res) => {
  const email = req.user?.emails?.[0]?.value;
  logger.info('Logout de usuario OAuth', { trace_id: req.traceId, email });
  req.logout(() => res.redirect('/'));
});

module.exports = router;