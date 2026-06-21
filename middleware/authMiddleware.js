const jwt = require('jsonwebtoken');

// Middleware adaptador que protege endpoints REST API usando JWT
function authMiddleware(req, res, next) {
  // Intentar extraer el token del header Authorization o de la cookie
  const token = req.cookies?.admin_token || req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, msg: 'No autorizado. Token faltante.' });
  }

  try {
    // Verificar y decodificar el token con el secreto del .env
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mi_secreto_super_seguro');
    req.admin_id = decoded.id;
    req.admin_username = decoded.username;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, msg: 'Token inválido o expirado.' });
  }
}

module.exports = authMiddleware;