const { db } = require('../config/firebase');
const { notifyScheduleCreated } = require('../services/notificationTriggers');

function getRequestRole(req) {
  const claims = req.user.customClaims || req.user.claims || {};
  return claims.role || req.user.role || '';
}

async function getTeacherCourseIds(uid) {
  const titular = await db
    .collection('courses')
    .where('titularTeacherId', '==', uid)
    .get();
  const secondary = await db
    .collection('courses')
    .where('secondaryTeachers', 'array-contains', uid)
    .get();
  const ids = new Set();
  titular.forEach((d) => ids.add(d.id));
  secondary.forEach((d) => ids.add(d.id));
  return ids;
}

async function getParentCourseIds(uid) {
  const snap = await db.collection('students').where('parentId', '==', uid).get();
  const ids = new Set();
  snap.forEach((doc) => {
    const cid = doc.data().enrollment?.courseId;
    if (cid) ids.add(cid);
  });
  return ids;
}

async function getParentGradeIds(uid) {
  const snap = await db.collection('students').where('parentId', '==', uid).get();
  const ids = new Set();
  snap.forEach((doc) => {
    const gid = doc.data().enrollment?.gradeId;
    if (gid) ids.add(gid);
  });
  return ids;
}

/** 
 * Verifica si un evento es visible para un usuario.
 * @param data - Documento del evento
 * @param role - Rol del usuario (admin, teacher, parent)
 * @param uid - UID del usuario
 * @param courseIds - Set de IDs de cursos del usuario
 * @param gradeIds - Set de IDs de grados del usuario (para padres)
 */
function scheduleVisible(data, role, uid, courseIds, gradeIds = new Set()) {
  const scope = data.scope || 'institutional';

  // Los admins pueden ver TODOS los eventos
  if (role === 'admin') {
    return true;
  }

  if (scope === 'personal') {
    return data.createdBy === uid;
  }

  if (scope === 'institutional') {
    return ['admin', 'teacher', 'parent'].includes(role);
  }

  if (scope === 'teachers') {
    return role === 'teacher';
  }

  if (scope === 'parents') {
    return role === 'parent';
  }

  if (scope === 'course') {
    const cid = data.courseId;
    if (!cid) return false;
    if (role === 'teacher' || role === 'parent') {
      return courseIds && courseIds.has(cid);
    }
  }

  if (scope === 'grades') {
    if (role === 'parent') {
      const eventGradeIds = data.gradeIds || [];
      return eventGradeIds.some(gid => gradeIds.has(gid));
    }
  }

  if (scope === 'specificUsers') {
    const userIds = data.userIds || [];
    return userIds.includes(uid);
  }

  return false;
}

function mapScheduleDoc(doc) {
  const data = doc.data();
  const dateVal = data.date;
  return {
    id: doc.id,
    ...data,
    date: dateVal?.toDate ? dateVal.toDate() : dateVal,
  };
}

async function fetchSchedulesInRange(startDate, endDate) {
  const snap = await db
    .collection('schedules')
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();

  return snap.docs.map(mapScheduleDoc);
}

async function fetchSchedulesForDay(dayStart, dayEnd) {
  const snap = await db
    .collection('schedules')
    .where('date', '>=', dayStart)
    .where('date', '<', dayEnd)
    .get();

  return snap.docs.map(mapScheduleDoc);
}

exports.createSchedule = async (req, res) => {
  try {
    const role = getRequestRole(req);
    const uid = req.user.uid;
    const {
      title,
      description,
      date,
      startTime,
      endTime,
      type,
      notes,
      scope: rawScope,
      courseId,
      gradeIds,
      userIds,
      notificationOnly,
    } = req.body;

    // Si es solo notificación, no se requieren horarios
    if (!notificationOnly && (!title || !date || !startTime || !endTime)) {
      return res.status(400).json({ error: 'Título, fecha y horarios son requeridos para eventos' });
    }

    if (!title) {
      return res.status(400).json({ error: 'El título es requerido' });
    }

    let scope = rawScope;

    // Validaciones según rol
    if (role === 'admin') {
      // Admin puede crear con cualquier alcance
      if (!scope) scope = 'institutional';
    } else if (role === 'teacher') {
      // Teachers solo pueden crear para sus cursos
      scope = 'course';
      if (!courseId) {
        return res
          .status(400)
          .json({ error: 'Los docentes deben indicar el curso del evento' });
      }
      const courseDoc = await db.collection('courses').doc(courseId).get();
      if (!courseDoc.exists) {
        return res.status(404).json({ error: 'Curso no encontrado' });
      }
      const course = courseDoc.data();
      const allowed =
        course.titularTeacherId === uid ||
        (course.secondaryTeachers && course.secondaryTeachers.includes(uid));
      if (!allowed) {
        return res.status(403).json({
          error: 'Solo puedes crear eventos para cursos donde impartes clase',
        });
      }
    } else if (role === 'parent') {
      scope = 'personal';
    } else {
      return res.status(403).json({ error: 'No tienes permiso para crear eventos' });
    }

    // Si es solo notificación, no crear evento en la colección schedules
    if (notificationOnly) {
      try {
        await notifyScheduleCreated(
          {
            title,
            description: description || '',
            scope,
            courseId: courseId || '',
            gradeIds: gradeIds || [],
            userIds: userIds || [],
            date: date ? new Date(date) : new Date(),
          },
          'notification-only',
          uid
        );
      } catch (notifyErr) {
        console.error('[NOTIFICATION] Error:', notifyErr);
        return res.status(500).json({ error: 'Error al enviar notificación: ' + notifyErr.message });
      }

      return res.status(201).json({
        message: 'Notificación enviada correctamente',
        scheduleId: null,
      });
    }

    // Crear evento normal
    const row = {
      title,
      description: description || '',
      date: new Date(date),
      startTime,
      endTime,
      type: type || 'event',
      notes: notes || '',
      scope,
      courseId: scope === 'course' ? courseId : '',
      gradeIds: scope === 'grades' ? (gradeIds || []) : [],
      userIds: scope === 'specificUsers' ? (userIds || []) : [],
      createdBy: uid,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const scheduleRef = await db.collection('schedules').add(row);

    try {
      await notifyScheduleCreated(
        { ...row, date: row.date },
        scheduleRef.id,
        uid
      );
    } catch (notifyErr) {
      console.error('[SCHEDULE] Notificación:', notifyErr);
    }

    return res.status(201).json({
      message: 'Horario creado correctamente',
      scheduleId: scheduleRef.id,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.getMonthlySchedule = async (req, res) => {
  try {
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ error: 'Mes y año requeridos' });
    }

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const role = getRequestRole(req);
    const uid = req.user.uid;

    let courseIds = new Set();
    let gradeIds = new Set();
    if (role === 'teacher') {
      courseIds = await getTeacherCourseIds(uid);
    } else if (role === 'parent') {
      courseIds = await getParentCourseIds(uid);
      gradeIds = await getParentGradeIds(uid);
    }

    const list = await fetchSchedulesInRange(startDate, endDate);

    const filtered = list.filter((item) =>
      scheduleVisible(item, role, uid, courseIds, gradeIds)
    );

    filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

    return res.json(filtered);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.getTodaySchedule = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const role = getRequestRole(req);
    const uid = req.user.uid;

    let courseIds = new Set();
    let gradeIds = new Set();
    if (role === 'teacher') {
      courseIds = await getTeacherCourseIds(uid);
    } else if (role === 'parent') {
      courseIds = await getParentCourseIds(uid);
      gradeIds = await getParentGradeIds(uid);
    }

    const list = await fetchSchedulesForDay(today, tomorrow);

    const filtered = list.filter((item) =>
      scheduleVisible(item, role, uid, courseIds, gradeIds)
    );

    filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

    return res.json(filtered);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.updateSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const role = getRequestRole(req);
    const uid = req.user.uid;

    const docRef = db.collection('schedules').doc(scheduleId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    const data = doc.data();
    const scope = data.scope || 'institutional';

    if (scope === 'personal' && data.createdBy !== uid && role !== 'admin') {
      return res.status(403).json({ error: 'No puedes editar este recordatorio' });
    }

    if (scope === 'institutional' && role !== 'admin') {
      return res.status(403).json({ error: 'Solo un administrador puede editar eventos institucionales' });
    }

    if (scope === 'course') {
      if (role !== 'admin' && role !== 'teacher') {
        return res.status(403).json({ error: 'No autorizado' });
      }
      if (role === 'teacher') {
        const tIds = await getTeacherCourseIds(uid);
        if (!tIds.has(data.courseId)) {
          return res.status(403).json({ error: 'No autorizado para este curso' });
        }
      }
    }

    const {
      title,
      description,
      date,
      startTime,
      endTime,
      type,
      notes,
    } = req.body;

    const updateData = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (date !== undefined) updateData.date = new Date(date);
    if (startTime !== undefined) updateData.startTime = startTime;
    if (endTime !== undefined) updateData.endTime = endTime;
    if (type !== undefined) updateData.type = type;
    if (notes !== undefined) updateData.notes = notes;

    await docRef.update(updateData);

    return res.json({ message: 'Horario actualizado correctamente' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.deleteSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const role = getRequestRole(req);
    const uid = req.user.uid;

    const docRef = db.collection('schedules').doc(scheduleId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    const data = doc.data();
    const scope = data.scope || 'institutional';

    if (scope === 'personal') {
      if (data.createdBy !== uid && role !== 'admin') {
        return res.status(403).json({ error: 'No puedes eliminar este recordatorio' });
      }
    } else if (scope === 'institutional') {
      if (role !== 'admin') {
        return res.status(403).json({ error: 'Solo un administrador puede eliminar este evento' });
      }
    } else if (scope === 'course') {
      if (role === 'admin') {
        /* ok */
      } else if (role === 'teacher') {
        const tIds = await getTeacherCourseIds(uid);
        if (!tIds.has(data.courseId)) {
          return res.status(403).json({ error: 'No autorizado' });
        }
      } else {
        return res.status(403).json({ error: 'No autorizado' });
      }
    }

    await docRef.delete();

    return res.json({ message: 'Horario eliminado correctamente' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
