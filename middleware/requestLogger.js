

const crypto = require('crypto');
const logger = require('../config/logger').child('http');

const CAMPOS_SENSIBLES = ['password', 'contraseña', 'token', 'jwt', 'password_hash', 'client_secret', 'access_token'];

function limpiarBody(body) {
  if (!body || typeof body !== 'object') return body;
  const copia = { ...body };
  for (const campo of CAMPOS_SENSIBLES) {
    if (campo in copia) copia[campo] = '***REDACTED***';
  }
  return copia;
}

function identificarActor(req) {
  if (req.admin_id) {
    return { actor_type: 'admin', actor_id: req.admin_id, actor_name: req.admin_username || null };
  }
  if (req.user) {
    const email = req.user.emails?.[0]?.value || null;
    return { actor_type: 'oauth_user', actor_id: email, actor_name: req.user.displayName || null };
  }
  return { actor_type: 'anonimo', actor_id: null, actor_name: null };
}

function requestLogger(req, res, next) {
  req.traceId = crypto.randomUUID();
  res.setHeader('X-Trace-Id', req.traceId);

  const inicio = Date.now();

  res.on('finish', () => {
    const duracionMs = Date.now() - inicio;

    const esEstatico = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?)$/i.test(req.path);
    if (esEstatico) return;

    const actor = identificarActor(req);

    const meta = {
      trace_id: req.traceId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: duracionMs,
      ip: req.ip || req.socket?.remoteAddress,
      ...actor
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      meta.body = limpiarBody(req.body);
    }

    const mensaje = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${duracionMs}ms)`;

    if (res.statusCode >= 500) {
      logger.error(mensaje, meta);
    } else if (res.statusCode >= 400) {
      logger.warn(mensaje, meta);
    } else {
      logger.info(mensaje, meta);
    }
  });

  next();
}

module.exports = requestLogger;