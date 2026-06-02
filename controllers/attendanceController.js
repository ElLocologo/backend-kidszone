const { db } = require('../config/firebase');
const { getName } = require('../utils/userCompat');
const { toDateMs, getDayBounds } = require('../utils/dateHelpers');

async function findAttendanceDocsSameDay(studentId, courseId, dateInput) {
  const { dayStartMs, dayEndMs } = getDayBounds(dateInput);
  const snap = await db.collection('attendance').where('studentId', '==', studentId).get();

  return snap.docs.filter((doc) => {
    const data = doc.data();
    if (data.courseId !== courseId) return false;
    const t = toDateMs(data.date);
    return t >= dayStartMs && t < dayEndMs;
  });
}

/**
 * Solo se persisten inasistencias (ausencia, retardo, justificado).
 * "presente" elimina cualquier registro del día para ese alumno y curso.
 * POST /api/attendance
 */
exports.createAttendance = async (req, res) => {
  try {
    const { studentId, courseId, date, status, notes } = req.body;
    const teacherId = req.user.uid;

    if (!studentId || !courseId || !date || !status) {
      return res.status(400).json({
        error: 'studentId, courseId, date y status son requeridos'
      });
    }

    const validStatuses = ['present', 'absent', 'late', 'excused'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const studentDoc = await db.collection('students').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    const student = studentDoc.data();
    if (!student.enrollment || student.enrollment.courseId !== courseId) {
      return res.status(400).json({
        error: 'El estudiante no pertenece a este curso'
      });
    }

    const courseDoc = await db.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    const course = courseDoc.data();
    const isAuthorized =
      course.titularTeacherId === teacherId ||
      (course.secondaryTeachers && course.secondaryTeachers.includes(teacherId));

    if (!isAuthorized) {
      return res.status(403).json({
        error: 'No tienes permisos para registrar asistencia en este curso'
      });
    }

    const teacherDoc = await db.collection('usuarios').doc(teacherId).get();
    if (!teacherDoc.exists) {
      return res.status(404).json({ error: 'Usuario (docente) no encontrado' });
    }

    const teacher = teacherDoc.data();

    const existingSameDay = await findAttendanceDocsSameDay(
      studentId,
      courseId,
      date
    );

    if (status === 'present') {
      const batch = db.batch();
      existingSameDay.forEach((d) => batch.delete(d.ref));
      if (existingSameDay.length) {
        await batch.commit();
      }
      return res.status(200).json({
        success: true,
        message: 'Sin registro de inasistencia',
        action: 'cleared',
        removedCount: existingSameDay.length,
      });
    }

    const attendanceRef = db.collection('attendance').doc();
    const attendanceData = {
      id: attendanceRef.id,
      studentId,
      courseId,
      gradeId: student.enrollment.gradeId,
      date: new Date(date),
      status,
      teacherId,
      teacherName: getName(teacher) || '',
      notes: notes || '',
      justification: status === 'excused',
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: teacherId,
    };

    const batch = db.batch();
    existingSameDay.forEach((d) => batch.delete(d.ref));
    batch.set(attendanceRef, attendanceData);
    await batch.commit();

    console.log(
      `[ATTENDANCE] Inasistencia registrada: estudiante=${studentId}, curso=${courseId}`
    );

    return res.status(201).json({
      success: true,
      message: 'Inasistencia registrada',
      attendanceId: attendanceRef.id,
      data: attendanceData,
    });
  } catch (error) {
    console.error('[ATTENDANCE CREATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener asistencia de un estudiante
 * GET /api/attendance/student/:studentId
 */
exports.getStudentAttendance = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { courseId, startDate, endDate } = req.query;

    const snapshot = await db
      .collection('attendance')
      .where('studentId', '==', studentId)
      .get();

    let attendance = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (courseId) {
      attendance = attendance.filter((a) => a.courseId === courseId);
    }

    if (startDate && endDate) {
      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      attendance = attendance.filter((a) => {
        const t = toDateMs(a.date);
        return t >= startMs && t <= endMs;
      });
    }

    attendance.sort(
      (a, b) => toDateMs(b.date) - toDateMs(a.date)
    );

    return res.status(200).json({
      studentId,
      count: attendance.length,
      attendance
    });
  } catch (error) {
    console.error('[ATTENDANCE GET STUDENT] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener asistencias de un curso por docente
 * GET /api/attendance/course/:courseId
 */
exports.getAttendanceByTeacher = async (req, res) => {
  try {
    const { courseId } = req.params;
    const teacherId = req.user.uid;
    const { date } = req.query;

    // Validar que el docente pertenece al curso
    const courseDoc = await db.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    const course = courseDoc.data();
    const isAuthorized = course.titularTeacherId === teacherId 
                        || (course.secondaryTeachers && course.secondaryTeachers.includes(teacherId));
    
    if (!isAuthorized) {
      return res.status(403).json({
        error: 'No tienes permisos para ver asistencias de este curso'
      });
    }

    const snapshot = await db
      .collection('attendance')
      .where('courseId', '==', courseId)
      .get();

    let records = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (date) {
      const { dayStartMs: startMs, dayEndMs: endMs } = getDayBounds(date);
      records = records.filter((r) => {
        const t = toDateMs(r.date);
        return t >= startMs && t < endMs;
      });
    }

    records.sort(
      (a, b) => toDateMs(b.date) - toDateMs(a.date)
    );

    return res.status(200).json({
      courseId,
      teacherId,
      count: records.length,
      records
    });
  } catch (error) {
    console.error('[ATTENDANCE BY TEACHER] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Historial de inasistencias del curso (todos los docentes del curso)
 * GET /api/attendance/course/:courseId/absences
 */
exports.getCourseAbsenceHistory = async (req, res) => {
  try {
    const { courseId } = req.params;
    const teacherId = req.user.uid;

    const courseDoc = await db.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    const course = courseDoc.data();
    const isAuthorized =
      course.titularTeacherId === teacherId ||
      (course.secondaryTeachers && course.secondaryTeachers.includes(teacherId));

    if (!isAuthorized) {
      return res.status(403).json({
        error: 'No tienes permisos para ver las inasistencias de este curso',
      });
    }

    const snapshot = await db
      .collection('attendance')
      .where('courseId', '==', courseId)
      .get();

    let records = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    records = records.filter((r) => r.status && r.status !== 'present');

    records.sort(
      (a, b) => toDateMs(b.date) - toDateMs(a.date)
    );

    const studentIds = [...new Set(records.map((r) => r.studentId))];
    const names = {};
    await Promise.all(
      studentIds.map(async (sid) => {
        const sd = await db.collection('students').doc(sid).get();
        if (sd.exists) {
          const d = sd.data();
          names[sid] = `${d.name || ''} ${d.lastName || ''}`.trim();
        }
      })
    );

    const enriched = records.map((r) => {
      const d = r.date;
      const dateVal = d && typeof d.toDate === 'function' ? d.toDate() : d;
      return {
        ...r,
        date: dateVal,
        studentName: names[r.studentId] || '',
      };
    });

    return res.status(200).json({
      courseId,
      count: enriched.length,
      records: enriched,
    });
  } catch (error) {
    console.error('[ATTENDANCE HISTORY] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener asistencias de todos los estudiantes en una fecha
 * GET /api/attendance/date/:date
 */
exports.getAttendanceByDate = async (req, res) => {
  try {
    const { date } = req.params;
    const { courseId } = req.query;

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEndMs = dayStart.getTime() + 86400000;
    const dayStartMs = dayStart.getTime();

    let snapshot;
    if (courseId) {
      snapshot = await db
        .collection('attendance')
        .where('courseId', '==', courseId)
        .get();
    } else {
      snapshot = await db
        .collection('attendance')
        .where('date', '>=', dayStart)
        .where('date', '<', new Date(dayEndMs))
        .get();
    }

    let attendance = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (courseId) {
      attendance = attendance.filter((a) => {
        const t = toDateMs(a.date);
        return t >= dayStartMs && t < dayEndMs;
      });
    }

    attendance.sort(
      (a, b) => toDateMs(b.date) - toDateMs(a.date)
    );

    return res.status(200).json({
      date,
      count: attendance.length,
      attendance
    });
  } catch (error) {
    console.error('[ATTENDANCE BY DATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Actualizar registro de asistencia
 * PATCH /api/attendance/:id
 */
exports.updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, justification } = req.body;
    const teacherId = req.user.uid;

    // Obtener registro
    const attendanceDoc = await db.collection('attendance').doc(id).get();
    if (!attendanceDoc.exists) {
      return res.status(404).json({ error: 'Registro de asistencia no encontrado' });
    }

    const attendance = attendanceDoc.data();

    // Validar permisos: solo docentes del curso pueden actualizar
    const courseDoc = await db.collection('courses').doc(attendance.courseId).get();
    const course = courseDoc.data();
    const isAuthorized = course.titularTeacherId === teacherId 
                        || (course.secondaryTeachers && course.secondaryTeachers.includes(teacherId));
    
    if (!isAuthorized) {
      return res.status(403).json({
        error: 'No tienes permisos para actualizar este registro'
      });
    }

    // Preparar datos a actualizar
    if (status === 'present') {
      await db.collection('attendance').doc(id).delete();
      return res.status(200).json({
        success: true,
        message: 'Registro eliminado (asistencia)',
        attendanceId: id,
      });
    }

    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (justification !== undefined) updateData.justification = justification;

    updateData.updatedAt = new Date();
    updateData.updatedBy = teacherId;

    await db.collection('attendance').doc(id).update(updateData);

    console.log(`[ATTENDANCE] Registro actualizado: ${id}`);

    return res.status(200).json({
      success: true,
      message: 'Registro de asistencia actualizado',
      attendanceId: id
    });
  } catch (error) {
    console.error('[ATTENDANCE UPDATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Eliminar registro de asistencia
 * DELETE /api/attendance/:id
 */
exports.deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.uid;

    // Obtener registro
    const attendanceDoc = await db.collection('attendance').doc(id).get();
    if (!attendanceDoc.exists) {
      return res.status(404).json({ error: 'Registro de asistencia no encontrado' });
    }

    const attendance = attendanceDoc.data();

    // Validar permisos
    const courseDoc = await db.collection('courses').doc(attendance.courseId).get();
    const course = courseDoc.data();
    const isAuthorized = course.titularTeacherId === teacherId 
                        || (course.secondaryTeachers && course.secondaryTeachers.includes(teacherId));
    
    if (!isAuthorized) {
      return res.status(403).json({
        error: 'No tienes permisos para eliminar este registro'
      });
    }

    // Eliminar
    await db.collection('attendance').doc(id).delete();

    console.log(`[ATTENDANCE] Registro eliminado: ${id}`);

    return res.status(200).json({
      success: true,
      message: 'Registro de asistencia eliminado',
      attendanceId: id
    });
  } catch (error) {
    console.error('[ATTENDANCE DELETE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
