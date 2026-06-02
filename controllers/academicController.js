const { db } = require('../config/firebase');
const { getRole, getName } = require('../utils/userCompat');

function getRequestRole(req) {
  const claims = req.user.customClaims || req.user.claims || {};
  return claims.role || req.user.role || '';
}

function currentYear() {
  return new Date().getFullYear();
}

function normalizeTime(t) {
  if (!t || typeof t !== 'string') return '';
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const h = String(Math.min(23, parseInt(m[1], 10))).padStart(2, '0');
  const min = String(Math.min(59, parseInt(m[2], 10))).padStart(2, '0');
  return `${h}:${min}`;
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * POST /api/academic/subjects
 */
const ALLOWED_GRADING_SCALES = ['numeric', 'letters', 'descriptive'];

exports.createSubject = async (req, res) => {
  try {
    const { name, gradeId, teacherId } = req.body;
    if (!name?.trim() || !gradeId || !teacherId) {
      return res.status(400).json({ error: 'Nombre, grado y docente son requeridos' });
    }

    const gradingScale = req.body.gradingScale || 'numeric';
    if (!ALLOWED_GRADING_SCALES.includes(gradingScale)) {
      return res.status(400).json({
        error: `gradingScale debe ser uno de: ${ALLOWED_GRADING_SCALES.join(', ')}`,
      });
    }

    const gradeDoc = await db.collection('grades').doc(gradeId).get();
    if (!gradeDoc.exists) {
      return res.status(404).json({ error: 'Grado no encontrado' });
    }
    const grade = gradeDoc.data();

    const teacherDoc = await db.collection('usuarios').doc(teacherId).get();
    if (!teacherDoc.exists || getRole(teacherDoc.data()) !== 'teacher') {
      return res.status(404).json({ error: 'Docente no válido' });
    }
    const teacher = teacherDoc.data();

    const year = currentYear();
    const row = {
      name: name.trim(),
      gradeId,
      gradeName: grade.name || '',
      teacherId,
      teacherName: getName(teacher) || '',
      academicYear: year,
      isActive: true,
      gradingScale,
      gradingNumericMin:
        req.body.gradingNumericMin !== undefined
          ? Number(req.body.gradingNumericMin)
          : 0,
      gradingNumericMax:
        req.body.gradingNumericMax !== undefined
          ? Number(req.body.gradingNumericMax)
          : 10,
      gradingLetterOptions: req.body.gradingLetterOptions ?? '',
      performanceCriteria: String(req.body.performanceCriteria ?? ''),
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.user?.uid || '',
    };

    const ref = await db.collection('subjects').add(row);
    return res.status(201).json({
      message: 'Materia creada',
      subject: { id: ref.id, ...row },
    });
  } catch (error) {
    console.error('[ACADEMIC subject create]', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * PATCH /api/academic/subjects/:subjectId
 */
exports.updateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const ref = db.collection('subjects').doc(subjectId);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Materia no encontrada' });
    }

    const updateData = { updatedAt: new Date() };
    const {
      name,
      teacherId,
      gradingScale,
      gradingNumericMin,
      gradingNumericMax,
      gradingLetterOptions,
      performanceCriteria,
      isActive,
    } = req.body;

    if (name !== undefined) updateData.name = String(name).trim();
    if (gradingScale !== undefined) {
      if (!ALLOWED_GRADING_SCALES.includes(gradingScale)) {
        return res.status(400).json({
          error: `gradingScale debe ser uno de: ${ALLOWED_GRADING_SCALES.join(', ')}`,
        });
      }
      updateData.gradingScale = gradingScale;
    }
    if (gradingNumericMin !== undefined) updateData.gradingNumericMin = Number(gradingNumericMin);
    if (gradingNumericMax !== undefined) updateData.gradingNumericMax = Number(gradingNumericMax);
    if (gradingLetterOptions !== undefined) updateData.gradingLetterOptions = gradingLetterOptions;
    if (performanceCriteria !== undefined) updateData.performanceCriteria = String(performanceCriteria || '');
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    if (teacherId !== undefined) {
      const teacherDoc = await db.collection('usuarios').doc(teacherId).get();
      if (!teacherDoc.exists || getRole(teacherDoc.data()) !== 'teacher') {
        return res.status(404).json({ error: 'Docente no válido' });
      }
      updateData.teacherId = teacherId;
      updateData.teacherName = getName(teacherDoc.data()) || '';
    }

    await ref.update(updateData);
    const fresh = await ref.get();
    return res.json({ message: 'Materia actualizada', subject: { id: fresh.id, ...fresh.data() } });
  } catch (error) {
    console.error('[ACADEMIC subject update]', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/academic/subjects?gradeId=
 */
exports.listSubjects = async (req, res) => {
  try {
    const role = getRequestRole(req);
    const uid = req.user.uid;
    const { gradeId } = req.query;
    const year = currentYear();

    let snapshot;
    if (role === 'teacher') {
      snapshot = await db.collection('subjects').where('teacherId', '==', uid).get();
    } else if (role === 'admin') {
      if (gradeId) {
        snapshot = await db.collection('subjects').where('gradeId', '==', gradeId).get();
      } else {
        snapshot = await db.collection('subjects').where('academicYear', '==', year).get();
      }
    } else {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const subjects = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.academicYear === year && data.isActive !== false) {
        subjects.push({ id: doc.id, ...data });
      }
    });

    subjects.sort((a, b) =>
      `${a.gradeName || ''}-${a.name || ''}`.localeCompare(
        `${b.gradeName || ''}-${b.name || ''}`,
        'es'
      )
    );

    return res.json({ count: subjects.length, subjects });
  } catch (error) {
    console.error('[ACADEMIC subjects list]', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/academic/subjects/:subjectId
 */
exports.deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subjectRef = db.collection('subjects').doc(subjectId);
    const subjectDoc = await subjectRef.get();
    if (!subjectDoc.exists) {
      return res.status(404).json({ error: 'Materia no encontrada' });
    }

    const slotsSnap = await db
      .collection('academicSlots')
      .where('subjectId', '==', subjectId)
      .limit(1)
      .get();

    if (!slotsSnap.empty) {
      return res.status(400).json({
        error:
          'Esta materia tiene bloques en el horario. Elimina primero esas franjas desde el curso correspondiente.',
      });
    }

    await subjectRef.delete();
    return res.json({ message: 'Materia eliminada' });
  } catch (error) {
    console.error('[ACADEMIC subject delete]', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/academic/slots
 */
exports.createSlot = async (req, res) => {
  try {
    const { courseId, subjectId, dayOfWeek, startTime, endTime } = req.body;
    if (!courseId || !subjectId || dayOfWeek === undefined || !startTime || !endTime) {
      return res
        .status(400)
        .json({ error: 'courseId, subjectId, dayOfWeek, startTime y endTime son requeridos' });
    }

    const dow = Number(dayOfWeek);
    if (!Number.isInteger(dow) || dow < 1 || dow > 5) {
      return res.status(400).json({ error: 'dayOfWeek debe ser 1 (lunes) a 5 (viernes)' });
    }

    const st = normalizeTime(startTime);
    const et = normalizeTime(endTime);
    if (!st || !et) {
      return res.status(400).json({ error: 'Formato de hora inválido (use HH:mm)' });
    }
    if (timeToMinutes(st) >= timeToMinutes(et)) {
      return res.status(400).json({ error: 'La hora de fin debe ser posterior al inicio' });
    }

    const courseDoc = await db.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }
    const course = courseDoc.data();
    if (course.isActive === false) {
      return res.status(400).json({ error: 'El curso no está activo' });
    }

    const subjectDoc = await db.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({ error: 'Materia no encontrada' });
    }
    const subject = subjectDoc.data();

    if (subject.gradeId !== course.gradeId) {
      return res.status(400).json({
        error: 'La materia debe pertenecer al mismo grado que el curso seleccionado',
      });
    }

    const year = course.academicYear || currentYear();

    const row = {
      courseId,
      courseName: course.name || '',
      gradeId: course.gradeId,
      gradeName: course.gradeName || '',
      subjectId,
      subjectName: subject.name || '',
      teacherId: subject.teacherId,
      teacherName: subject.teacherName || '',
      dayOfWeek: dow,
      startTime: st,
      endTime: et,
      academicYear: year,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.user?.uid || '',
    };

    const ref = await db.collection('academicSlots').add(row);
    return res.status(201).json({
      message: 'Franja horaria agregada',
      slot: { id: ref.id, ...row },
    });
  } catch (error) {
    console.error('[ACADEMIC slot create]', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/academic/slots/course/:courseId
 */
exports.listSlotsForCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseDoc = await db.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    const course = courseDoc.data();
    const year = course.academicYear || currentYear();

    const snapshot = await db.collection('academicSlots').where('courseId', '==', courseId).get();

    const slots = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.academicYear === year) {
        slots.push({ id: doc.id, ...data });
      }
    });

    slots.sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

    return res.json({ courseId, count: slots.length, slots });
  } catch (error) {
    console.error('[ACADEMIC slots by course]', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/academic/slots/:slotId
 */
exports.deleteSlot = async (req, res) => {
  try {
    const { slotId } = req.params;
    const ref = db.collection('academicSlots').doc(slotId);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Franja no encontrada' });
    }
    await ref.delete();
    return res.json({ message: 'Franja eliminada' });
  } catch (error) {
    console.error('[ACADEMIC slot delete]', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/academic/timetable/teacher
 */
exports.getTeacherTimetable = async (req, res) => {
  try {
    const role = getRequestRole(req);
    if (role !== 'teacher') {
      return res.status(403).json({ error: 'Solo disponible para docentes' });
    }
    const uid = req.user.uid;
    const year = currentYear();

    const snapshot = await db.collection('academicSlots').where('teacherId', '==', uid).get();

    const slots = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.academicYear === year) {
        slots.push({ id: doc.id, ...data });
      }
    });

    slots.sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

    return res.json({ count: slots.length, slots });
  } catch (error) {
    console.error('[ACADEMIC timetable teacher]', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/academic/timetable/parent/:studentId
 */
exports.getParentTimetable = async (req, res) => {
  try {
    const role = getRequestRole(req);
    if (role !== 'parent') {
      return res.status(403).json({ error: 'Solo disponible para padres/tutores' });
    }
    const uid = req.user.uid;
    const { studentId } = req.params;

    const studentDoc = await db.collection('students').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }
    const student = studentDoc.data();
    if (student.parentId !== uid) {
      return res.status(403).json({ error: 'No tienes acceso a este estudiante' });
    }

    const courseId = student.enrollment?.courseId;
    if (!courseId) {
      return res.json({
        count: 0,
        slots: [],
        message: 'El estudiante no tiene curso activo asignado',
      });
    }

    const courseDoc = await db.collection('courses').doc(courseId).get();
    const year = courseDoc.exists
      ? courseDoc.data().academicYear || currentYear()
      : currentYear();

    const snapshot = await db.collection('academicSlots').where('courseId', '==', courseId).get();

    const slots = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.academicYear === year) {
        slots.push({ id: doc.id, ...data });
      }
    });

    slots.sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

    return res.json({
      studentId,
      courseId,
      courseName: student.enrollment?.courseName || courseDoc.data()?.name || '',
      count: slots.length,
      slots,
    });
  } catch (error) {
    console.error('[ACADEMIC timetable parent]', error);
    return res.status(500).json({ error: error.message });
  }
};
