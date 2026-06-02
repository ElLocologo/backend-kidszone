/**
 * ⚠️ IMPORTANTE: Normaliza usuario a campos ESTÁNDAR en inglés.
 * Todos los campos nuevos deben usar SOLO estos nombres:
 * - name (NO nombre)
 * - role (NO rol)
 * - isActive (NO activo)
 * - children (NO hijos)
 * - createdAt (NO creadoEn)
 * 
 * Esta función soporta LEER datos legacy, pero siempre normaliza a estándar.
 */
const normalizeUser = (userData = {}) => {
  return {
    ...userData,
    // Normalizar a campos estándar (solo inglés)
    name: userData.name ?? userData.nombre ?? '',
    role: userData.role ?? userData.rol ?? '',
    isActive: userData.isActive ?? userData.activo ?? true,
    children: userData.children ?? userData.hijos ?? [],
    createdAt: userData.createdAt ?? userData.creadoEn ?? null,
  };
};

/**
 * ⚠️ IMPORTANTE: Crea usuario para Firestore usando SOLO campos estándar.
 * NO crea duplicados de campos. Usa una única versión de cada campo.
 */
const toFirestoreUser = (userData = {}) => {
  const normalized = normalizeUser(userData);
  return {
    ...userData,
    // Usar SOLO esta versión (campos estándar en inglés)
    name: normalized.name,
    role: normalized.role,
    isActive: normalized.isActive,
    children: normalized.children,
    createdAt: normalized.createdAt || new Date(),
  };
};

/**
 * Obtiene el rol del usuario (soporta legacy para leer ambas versiones)
 */
const getRole = (userData = {}) => userData.role ?? userData.rol;

/**
 * Obtiene el nombre del usuario (soporta legacy para leer ambas versiones)
 */
const getName = (userData = {}) => userData.name ?? userData.nombre;

/**
 * Obtiene los hijos del usuario (soporta legacy para leer ambas versiones)
 */
const getChildren = (userData = {}) => userData.children ?? userData.hijos ?? [];

module.exports = {
  normalizeUser,
  toFirestoreUser,
  getRole,
  getName,
  getChildren,
};
