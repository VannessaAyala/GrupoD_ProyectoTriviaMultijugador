const logger = require('../config/logger').child('authOAuth');

module.exports = function (req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  logger.warn('Acceso denegado a ruta protegida (sin sesión OAuth)', {
    trace_id: req.traceId,
    url: req.originalUrl,
    ip: req.ip
  });
  res.redirect('/');
};