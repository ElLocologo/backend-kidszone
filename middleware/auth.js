const { auth } = require('../config/firebase');
const jwt = require('jsonwebtoken');

// Middleware para verificar token Firebase
const verifyFirebaseToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    console.log('[AUTH] Token recibido en header');

    // Intentar decodificar como custom token (sin verificar firma)
    try {
      const decoded = jwt.decode(token);
      console.log('[AUTH] Token decodificado como JWT:', decoded);
      
      if (decoded && (decoded.uid || decoded.sub)) {
        req.user = {
          uid: decoded.uid || decoded.sub,
          claims: decoded.claims || {},
          ...decoded
        };
        console.log('[AUTH] Usuario establecido desde custom token:', req.user.uid);
        return next();
      }
    } catch (e) {
      console.log('[AUTH] No es un JWT válido, intentando como ID token de Firebase');
    }

    // Intentar como ID token de Firebase
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    console.log('[AUTH] Token verificado como ID token de Firebase');
    next();
  } catch (error) {
    console.error('[AUTH] Error al verificar token:', error.message);
    return res.status(401).json({ error: 'Token inválido', details: error.message });
  }
};

// Factory function para crear middlewares de verificación de rol
const verifyRole = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      // El rol puede estar en diferentes lugares según el tipo de token
      const claims = req.user.customClaims || req.user.claims || {};
      const role = claims.role || req.user.role;
      
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ 
          error: `Rol '${role}' no permitido. Se requiere: ${allowedRoles.join(' o ')}`
        });
      }
      next();
    } catch (error) {
      console.error('[ROLE] Error al verificar rol:', error);
      return res.status(403).json({ error: 'Error al verificar rol', details: error.message });
    }
  };
};

// Middlewares predefinidos
const verifyAdmin = verifyRole(['admin']);
const verifyTeacher = verifyRole(['teacher', 'admin']);
const verifyParent = verifyRole(['parent']);

module.exports = {
  verifyFirebaseToken,
  verifyAdmin,
  verifyTeacher,
  verifyParent,
  verifyRole, // Exportar la factory también si se necesita custom roles
};
