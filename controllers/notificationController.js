const { db } = require('../config/firebase');
const { toJsDate } = require('../utils/dateHelpers');
const { createNotificationsForUsers } = require('../services/notificationTriggers');

/**
 * Crear una notificación individual (wrapper que usa el sistema centralizado)
 * IMPORTANTE: Siempre usar createNotificationsForUsers para mantener consistencia
 */
exports.createNotification = async (req, res) => {
  try {
    const { recipientId, type, title, message, relatedId } = req.body;

    // Validación de campos requeridos
    if (!recipientId || !type || !title || !message) {
      return res.status(400).json({ 
        error: 'Destinatario, tipo, título y mensaje son requeridos' 
      });
    }

    // Validación de tipo válido
    const validTypes = ['payment', 'event', 'attendance', 'activity', 'system'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ 
        error: `Tipo inválido. Debe ser uno de: ${validTypes.join(', ')}` 
      });
    }

    // Usar el sistema centralizado de creación de notificaciones
    await createNotificationsForUsers([recipientId], {
      type,
      title,
      message,
      relatedId: relatedId || '',
      createdBy: req.user.uid,
    });

    return res.status(201).json({
      message: 'Notificación creada correctamente',
      note: 'Notificación creada a través del sistema centralizado',
    });
  } catch (error) {
    console.error('[NOTIFICATION] Error en createNotification:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Obtener notificaciones del usuario
exports.getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { unreadOnly } = req.query;

    const notificationsSnapshot = await db
      .collection('notifications')
      .where('recipientId', '==', userId)
      .get();

    let notifications = notificationsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: toJsDate(data.createdAt),
      };
    });

    if (unreadOnly === 'true') {
      notifications = notifications.filter((n) => n.read === false);
    }

    notifications.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.getTime() : 0;
      const tb = b.createdAt ? b.createdAt.getTime() : 0;
      return tb - ta;
    });

    notifications = notifications.slice(0, 50);

    return res.json(notifications);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Marcar como leída
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    await db.collection('notifications').doc(notificationId).update({
      read: true,
      readAt: new Date(),
    });

    return res.json({ message: 'Notificación marcada como leída' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Marcar todas como leídas
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.uid;

    const notificationsSnapshot = await db
      .collection('notifications')
      .where('recipientId', '==', userId)
      .get();

    const unreadDocs = notificationsSnapshot.docs.filter(
      (doc) => doc.data().read === false
    );

    if (unreadDocs.length === 0) {
      return res.json({ message: 'No hay notificaciones pendientes' });
    }

    const batch = db.batch();
    unreadDocs.forEach((doc) => {
      batch.update(doc.ref, { read: true, readAt: new Date() });
    });

    await batch.commit();

    return res.json({ message: 'Todas las notificaciones marcadas como leídas' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener contador de notificaciones no leídas
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.uid;

    const unreadSnapshot = await db
      .collection('notifications')
      .where('recipientId', '==', userId)
      .get();

    const unreadCount = unreadSnapshot.docs.filter(
      (doc) => doc.data().read === false
    ).length;

    return res.json({
      unreadCount,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Eliminar notificación
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    await db.collection('notifications').doc(notificationId).delete();

    return res.json({ message: 'Notificación eliminada' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Enviar notificación masiva (solo admin)
exports.sendBulkNotification = async (req, res) => {
  try {
    const { recipientIds, type, title, message, relatedId } = req.body;

    if (!recipientIds || !Array.isArray(recipientIds) || !type || !title || !message) {
      return res.status(400).json({ error: 'Destinatarios, tipo, título y mensaje son requeridos' });
    }

    await createNotificationsForUsers(recipientIds, {
      type,
      title,
      message,
      relatedId: relatedId || '',
      createdBy: req.user.uid,
    });

    return res.status(201).json({
      message: `${recipientIds.length} notificaciones enviadas correctamente`,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
