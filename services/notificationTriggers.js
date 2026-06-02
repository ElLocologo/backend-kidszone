const { db } = require('../config/firebase');
const { getRole } = require('../utils/userCompat');
const { toJsDate, formatDateEs } = require('../utils/dateHelpers');

const MAX_BATCH = 400;

/**
 * FUNCIÓN CENTRALIZADA para crear notificaciones en lote (máx. 400 por commit).
 * ⚠️ IMPORTANTE: Todas las notificaciones deben crearse usando esta función
 * para mantener consistencia en estructura y sincronización.
 * 
 * @param {string[]} recipientIds - Array de UIDs de destinatarios
 * @param {object} params - Parámetros de la notificación
 * @param {string} params.type - Tipo: 'payment', 'event', 'attendance', 'activity', 'system'
 * @param {string} params.title - Título de la notificación
 * @param {string} params.message - Mensaje detallado
 * @param {string} [params.relatedId] - ID del documento relacionado (factura, evento, etc.)
 * @param {string} [params.createdBy] - UID del creador (default: 'system')
 */
async function createNotificationsForUsers(
  recipientIds,
  { type, title, message, relatedId, createdBy }
) {
  const uniq = [...new Set((recipientIds || []).filter(Boolean))];
  
  if (!uniq.length) {
    console.warn('[NOTIFICATIONS] createNotificationsForUsers: recipientIds vacío');
    return;
  }

  if (!type || !title || !message) {
    console.error('[NOTIFICATIONS] createNotificationsForUsers: Faltan parámetros requeridos', {
      type,
      title,
      message,
    });
    throw new Error('Parámetros requeridos: type, title, message');
  }

  let batch = db.batch();
  let ops = 0;

  console.log(`[NOTIFICATIONS] Creando ${uniq.length} notificación(es) de tipo "${type}"`);

  for (const recipientId of uniq) {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      recipientId,
      type: type || 'system',
      title,
      message,
      relatedId: relatedId || '',
      read: false,
      createdAt: new Date(),
      createdBy: createdBy || 'system',
    });
    ops += 1;

    if (ops >= MAX_BATCH) {
      await batch.commit();
      console.log(`[NOTIFICATIONS] Batch commit: ${ops} notificaciones`);
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    await batch.commit();
    console.log(`[NOTIFICATIONS] Final batch commit: ${ops} notificaciones`);
  }
  
  console.log(`[NOTIFICATIONS] ✅ Creadas ${uniq.length} notificación(es)`);
}

// Exportar para uso en otros módulos
exports.createNotificationsForUsers = createNotificationsForUsers;

async function collectUsersWithRoles(roleList) {
  const ids = new Set();
  for (const role of roleList) {
    const snap = await db.collection('usuarios').where('role', '==', role).get();
    snap.forEach((doc) => ids.add(doc.id));
  }
  return [...ids];
}

async function collectParentUidsForCourse(courseId) {
  const snap = await db
    .collection('students')
    .where('enrollment.courseId', '==', courseId)
    .get();

  const ids = new Set();
  const emailsNeedingLookup = new Set();

  snap.forEach((doc) => {
    const data = doc.data();
    if (data.parentId) {
      ids.add(data.parentId);
      return;
    }
    const email = (data.parentEmail || '').trim().toLowerCase();
    if (email) emailsNeedingLookup.add(email);
  });

  for (const email of emailsNeedingLookup) {
    const u = await db.collection('usuarios').where('email', '==', email).limit(5).get();
    const parentDoc = u.docs.find((d) => getRole(d.data()) === 'parent');
    if (parentDoc) ids.add(parentDoc.id);
  }

  return [...ids];
}

/**
 * Notifica sobre un nuevo evento en la agenda según su alcance
 * @param {object} schedule - Documento de schedule (con scope, courseId, title, date, etc.)
 * @param {string} scheduleId - ID del schedule
 * @param {string} createdByUid - UID del creador
 */
exports.notifyScheduleCreated = async (schedule, scheduleId, createdByUid) => {
  const scope = schedule.scope || 'institutional';
  const title = 'Nuevo evento en la agenda';
  const dateStr = schedule.date?.toDate
    ? schedule.date.toDate().toLocaleDateString('es-ES')
    : new Date(schedule.date).toLocaleDateString('es-ES');

  console.log(`[NOTIFICATIONS] notifyScheduleCreated: Evento "${schedule.title}" (scope: ${scope})`);

  if (scope === 'personal') {
    console.log('[NOTIFICATIONS] Evento personal - sin notificaciones');
    return;
  }

  if (scope === 'institutional') {
    const recipients = await collectUsersWithRoles(['teacher', 'parent']);
    const filtered = recipients.filter((id) => id !== createdByUid);
    console.log(`[NOTIFICATIONS] Notificando a ${filtered.length} usuarios (alcance institucional)`);
    await createNotificationsForUsers(filtered, {
      type: 'event',
      title,
      message: `"${schedule.title}" (${dateStr}). Alcance: institucional.`,
      relatedId: scheduleId,
      createdBy: createdByUid,
    });
    return;
  }

  if (scope === 'course' && schedule.courseId) {
    const parents = await collectParentUidsForCourse(schedule.courseId);
    const filtered = parents.filter((id) => id !== createdByUid);
    console.log(`[NOTIFICATIONS] Notificando a ${filtered.length} padres (curso: ${schedule.courseId})`);
    await createNotificationsForUsers(filtered, {
      type: 'event',
      title,
      message: `"${schedule.title}" (${dateStr}). Evento de tu curso.`,
      relatedId: scheduleId,
      createdBy: createdByUid,
    });
    return;
  }

  if (scope === 'teachers') {
    const recipients = await collectUsersWithRoles(['teacher']);
    const filtered = recipients.filter((id) => id !== createdByUid);
    console.log(`[NOTIFICATIONS] Notificando a ${filtered.length} docentes`);
    await createNotificationsForUsers(filtered, {
      type: 'event',
      title,
      message: `"${schedule.title}" (${dateStr}). Notificación para docentes.`,
      relatedId: scheduleId,
      createdBy: createdByUid,
    });
    return;
  }

  if (scope === 'parents') {
    const recipients = await collectUsersWithRoles(['parent']);
    const filtered = recipients.filter((id) => id !== createdByUid);
    console.log(`[NOTIFICATIONS] Notificando a ${filtered.length} padres`);
    await createNotificationsForUsers(filtered, {
      type: 'event',
      title,
      message: `"${schedule.title}" (${dateStr}). Notificación para padres.`,
      relatedId: scheduleId,
      createdBy: createdByUid,
    });
    return;
  }

  if (scope === 'grades' && schedule.gradeIds && schedule.gradeIds.length > 0) {
    const studentIds = new Set();
    const courseMap = new Map();

    for (const gradeId of schedule.gradeIds) {
      const coursesSnap = await db.collection('courses').where('gradeId', '==', gradeId).get();
      coursesSnap.forEach((doc) => {
        courseMap.set(doc.id, doc.data());
      });
    }

    for (const [courseId] of courseMap) {
      const parents = await collectParentUidsForCourse(courseId);
      parents.forEach((p) => studentIds.add(p));
    }

    const filtered = [...studentIds].filter((id) => id !== createdByUid);
    console.log(`[NOTIFICATIONS] Notificando a ${filtered.length} padres (grados: ${schedule.gradeIds.join(', ')})`);
    await createNotificationsForUsers(filtered, {
      type: 'event',
      title,
      message: `"${schedule.title}" (${dateStr}). Notificación para tu grado.`,
      relatedId: scheduleId,
      createdBy: createdByUid,
    });
    return;
  }

  if (scope === 'specificUsers' && schedule.userIds && schedule.userIds.length > 0) {
    const filtered = schedule.userIds.filter((id) => id !== createdByUid);
    console.log(`[NOTIFICATIONS] Notificando a ${filtered.length} usuarios específicos`);
    await createNotificationsForUsers(filtered, {
      type: 'event',
      title,
      message: `"${schedule.title}" (${dateStr}). Notificación personal.`,
      relatedId: scheduleId,
      createdBy: createdByUid,
    });
    return;
  }
};

exports.resolveParentUidForStudent = async (student) => {
  if (student.parentId) return student.parentId;
  const email = (student.parentEmail || '').trim().toLowerCase();
  if (!email) return null;
  const q = await db
    .collection('usuarios')
    .where('email', '==', email)
    .limit(3)
    .get();
  const parentDoc = q.docs.find((d) => getRole(d.data()) === 'parent');
  return parentDoc ? parentDoc.id : null;
};

/**
 * Notifica al padre cuando se crea una nueva factura
 * @param {string} billingId - ID de la factura
 * @param {object} billingData - Datos de la factura (studentName, studentId, month, year, totalAmount, dueDate)
 * @param {string|null} parentUid - UID del padre
 */
exports.notifyBillingCreated = async (billingId, billingData, parentUid) => {
  if (!parentUid) {
    console.warn('[NOTIFICATIONS] notifyBillingCreated: parentUid vacío');
    return;
  }

  try {
    const studentName = billingData.studentName || 'Tu estudiante';
    const dueStr = formatDateEs(billingData.dueDate);
    const total =
      typeof billingData.totalAmount === 'number'
        ? billingData.totalAmount
        : parseFloat(billingData.totalAmount || 0);

    const monthYear = billingData.month && billingData.year
      ? new Date(billingData.year, billingData.month - 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
      : 'pendiente';

    console.log(`[NOTIFICATIONS] notifyBillingCreated: Factura ${billingId} para ${studentName} (${monthYear})`);

    await createNotificationsForUsers([parentUid], {
      type: 'payment',
      title: 'Nueva factura disponible',
      message: `Factura de ${studentName} (${monthYear}): $${total.toFixed(2)}. Vence: ${dueStr}.`,
      relatedId: billingId,
      createdBy: 'system',
    });
  } catch (err) {
    console.error('[NOTIFICATIONS] Error en notifyBillingCreated:', err);
    throw err;
  }
};

/**
 * Notifica al padre cuando se registra un pago
 * @param {string} paymentId - ID del pago
 * @param {object} paymentData - Datos del pago (studentName, studentId, billingId, amount, method)
 * @param {string|null} parentUid - UID del padre
 */
exports.notifyPaymentReceived = async (paymentId, paymentData, parentUid) => {
  if (!parentUid) {
    console.warn('[NOTIFICATIONS] notifyPaymentReceived: parentUid vacío');
    return;
  }

  try {
    const studentName = paymentData.studentName || 'Tu estudiante';
    const amount =
      typeof paymentData.amount === 'number'
        ? paymentData.amount
        : parseFloat(paymentData.amount || 0);
    const method = paymentData.method || 'transferencia';

    console.log(`[NOTIFICATIONS] notifyPaymentReceived: Pago ${paymentId} de $${amount} para ${studentName}`);

    await createNotificationsForUsers([parentUid], {
      type: 'payment',
      title: 'Pago registrado exitosamente',
      message: `Se ha registrado un pago de $${amount.toFixed(2)} para ${studentName} (${method}).`,
      relatedId: paymentId,
      createdBy: 'system',
    });
  } catch (err) {
    console.error('[NOTIFICATIONS] Error en notifyPaymentReceived:', err);
    throw err;
  }
};
