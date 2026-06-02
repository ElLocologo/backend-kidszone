const { auth, db } = require('../config/firebase');
const { normalizeUser, toFirestoreUser } = require('../utils/userCompat');

/**
 * Login - Obtener custom token de Firebase
 * POST /api/auth/login
 * Body: { email, password }
 * Nota: El frontend debe validar credenciales con Firebase SDK
 * Este endpoint genera un custom token para el usuario autenticado
 */
exports.login = async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const uid = req.body.uid; // El frontend envía el UID después de autenticar

    if (!email || !uid) {
      return res.status(400).json({ error: 'Email y uid son requeridos' });
    }

    console.log(`[AUTH] Generando custom token para: ${email}`);

    // Obtener datos del usuario en Firestore
    const userDoc = await db.collection('usuarios').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado en base de datos' });
    }

    const userData = userDoc.data();
    const userNormalized = {
      id: uid,
      email: userData.email,
      ...normalizeUser(userData),
    };

    if (!userNormalized.name) {
      return res.status(400).json({ error: 'El usuario no tiene nombre registrado' });
    }

    if (!userNormalized.role) {
      return res.status(400).json({ error: 'El usuario no tiene rol asignado' });
    }

    // Generar custom token con claims (rol, etc.)
    const customToken = await auth.createCustomToken(uid, {
      role: userNormalized.role,
      email: userNormalized.email,
    });

    console.log(`[AUTH] Custom token generado para: ${uid}`);

    return res.json({
      success: true,
      token: customToken,
      user: userNormalized,
    });
  } catch (error) {
    console.error('[AUTH LOGIN] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Registro de usuario (para padres)
 * POST /api/auth/register
 * Body: { email, password, name }
 * 
 * NOTA: Esta función es para uso administrativo.
 * En producción, el frontend debe usar Firebase SDK directamente:
 * 
 * import { createUserWithEmailAndPassword } from 'firebase/auth';
 * await createUserWithEmailAndPassword(auth, email, password);
 */
exports.registerParent = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, contraseña y nombre son requeridos' });
    }

    console.log(`[AUTH] Registrando nuevo padre: ${email}`);

    // Crear usuario en Firebase Authentication
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
    });

    // Crear perfil en Firestore (datos de negocio; credenciales en Firebase Auth)
    await db.collection('usuarios').doc(userRecord.uid).set(toFirestoreUser({
      id: userRecord.uid,
      email,
      name,
      role: 'parent',
      isActive: true,
      children: [],
      createdAt: new Date(),
    }));

    console.log(`[AUTH] Padre registrado: ${userRecord.uid}`);

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado correctamente',
      userId: userRecord.uid,
      email,
    });
  } catch (error) {
    console.error('[AUTH REGISTER] Error:', error);
    
    // Firebase devuelve errores específicos
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({ error: 'Email inválido' });
    }
    if (error.code === 'auth/weak-password') {
      return res.status(400).json({ error: 'La contraseña es muy débil' });
    }
    
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener datos del usuario autenticado
 * GET /api/auth/me
 * Requiere: Authorization header con token válido
 */
exports.getCurrentUser = async (req, res) => {
  try {
    const uid = req.user.uid; // Del middleware verifyFirebaseToken

    const userDoc = await db.collection('usuarios').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    return res.json({ user: { id: uid, ...normalizeUser(userDoc.data()) } });
  } catch (error) {
    console.error('[AUTH GET USER] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
