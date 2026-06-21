const jwt = require('jsonwebtoken');
const logger = require('../config/logger').child('authMiddleware');

function authMiddleware(req, res, next) {
  const token = req.cookies?.admin_token || req.headers.authorization?.split(" ")[1];

  if (!token) {
    logger.warn('Acceso API rechazado: token faltante', { trace_id: req.traceId, url: req.originalUrl, ip: req.ip });
    return res.status(401).json({ success: false, msg: 'No autorizado. Token faltante.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mi_secreto_super_seguro');
    req.admin_id = decoded.id;
    req.admin_username = decoded.username;
    next();
  } catch (err) {
    logger.warn('Acceso API rechazado: token inválido o expirado', { trace_id: req.traceId, url: req.originalUrl, error: err.message });
    return res.status(403).json({ success: false, msg: 'Token inválido o expirado.' });
  }
}

module.exports = authMiddleware;