const { db } = require('../config/firebase');
const { getRole, getName } = require('../utils/userCompat');

function getRequestRole(req) {
  const claims = req.user.customClaims || req.user.claims || {};
  return claims.role || req.user.role || '';
}

function currentYear() {
  return new Date().getFullYear();
}

function safePeriodKey(periodKey) {
  return String(periodKey || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 32);
}

function markbookDocId(studentId, subjectId, academicYear, periodKey) {
  return `mb_${studentId}_${subjectId}_${academicYear}_${safePeriodKey(periodKey)}`;
}

function reportDocId(studentId, academicYear, periodKey) {
  return `rep_${studentId}_${academicYear}_${safePeriodKey(periodKey)}`;
}

function parseLetterOptions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  return String(raw)
    .split(/[,;|]/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function validateGradeValue(subject, value) {
  const v = String(value ?? '').trim();
  if (!v) return 'La calificación no puede estar vacía';

  const scale = subject.gradingScale || 'numeric';

  if (scale === 'numeric') {
    const n = Number(String(v).replace(',', '.'));
    const min = subject.gradingNumericMin ?? 0;
    const max = subject.gradingNumericMax ?? 10;
    if (Number.isNaN(n)) return 'Debe ser un número válido';
    if (n < min || n > max) return `El valor debe estar entre ${min} y ${max}`;
    return null;
  }

  if (scale === 'letters') {
    const upper = v.toUpperCase();
    const opts = parseLetterOptions(subject.gradingLetterOptions);
    if (opts.length && !opts.includes(upper)) {
      return `Usa uno de los valores permitidos: ${opts.join(', ')}`;
    }
    return null;
  }

  if (scale === 'descriptive') {
    if (v.length > 2000) return 'Texto demasiado largo';
    return null;
  }

  return null;
}

async function loadSubject(subjectId) {
  const doc = await db.collection('subjects').doc(subjectId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function assertTeacherOwnsSubjectForCourse(uid, courseId, subject) {
  if (!subject || subject.teacherId !== uid) {
    return 'No impartes esta materia';
  }
  const courseDoc = await db.collection('courses').doc(courseId).get();
  if (!courseDoc.exists) return 'Curso no encontrado';
  const course = courseDoc.data();
  if (course.isActive === false) return 'El curso no está activo';
  if (subject.gradeId !== course.gradeId) {
    return 'La materia no corresponde al grado de este curso';
  }
  return null;
}

async function studentsInCourse(courseId) {
  const snap = await db
    .collection('students')
    .where('enrollment.courseId', '==', courseId)
    .get();

  const list = [];
  snap.forEach((d) => {
    const data = d.data();
    if (data.enrollment?.status === 'active') {
      list.push({ id: d.id, ...data });
    }
  });
  list.sort((a, b) =>
    `${a.name || ''} ${a.lastName || ''}`.localeCompare(`${b.name || ''} ${b.lastName || ''}`, 'es')
  );
  return list;
}

/**
 * GET /api/report-cards/teacher/markbook?courseId=&subjectId=&periodKey=
 */
exports.getTeacherMarkbookContext = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'teacher') {
      return res.status(403).json({ error: 'Solo docentes pueden usar esta vista' });
    }
    const uid = req.user.uid;
    const { courseId, subjectId, periodKey } = req.query;
    if (!courseId || !subjectId || !periodKey) {
      return res.status(400).json({ error: 'courseId, subjectId y periodKey son requeridos' });
    }

    const subject = await loadSubject(subjectId);
    const err = await assertTeacherOwnsSubjectForCourse(uid, courseId, subject);
    if (err) return res.status(403).json({ error: err });

    const year = subject.academicYear || currentYear();
    const students = await studentsInCourse(courseId);

    const entries = {};
    await Promise.all(
      students.map(async (st) => {
        const eid = markbookDocId(st.id, subjectId, year, periodKey);
        const edoc = await db.collection('markbookEntries').doc(eid).get();
        entries[st.id] = edoc.exists ? { id: eid, ...edoc.data() } : null;
      })
    );

    return res.json({
      courseId,
      subject,
      periodKey: String(periodKey).trim(),
      academicYear: year,
      students,
      entries,
    });
  } catch (e) {
    console.error('[MARKBOOK context]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * POST /api/report-cards/teacher/markbook
 * Body: { courseId, subjectId, periodKey, grades: [{ studentId, value }] }
 */
exports.saveTeacherMarkbookDrafts = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'teacher') {
      return res.status(403).json({ error: 'Solo docentes pueden registrar calificaciones' });
    }
    const uid = req.user.uid;
    const { courseId, subjectId, periodKey, grades } = req.body;
    if (!courseId || !subjectId || !periodKey || !Array.isArray(grades)) {
      return res.status(400).json({ error: 'courseId, subjectId, periodKey y grades[] son requeridos' });
    }

    const subject = await loadSubject(subjectId);
    const authErr = await assertTeacherOwnsSubjectForCourse(uid, courseId, subject);
    if (authErr) return res.status(403).json({ error: authErr });

    const year = subject.academicYear || currentYear();
    const studentIds = new Set((await studentsInCourse(courseId)).map((s) => s.id));

    const errors = [];
    let saved = 0;

    for (const row of grades) {
      const { studentId, value } = row;
      if (!studentId || !studentIds.has(studentId)) {
        errors.push({ studentId, error: 'Estudiante no pertenece a este curso' });
        continue;
      }

      const eid = markbookDocId(studentId, subjectId, year, periodKey);
      const ref = db.collection('markbookEntries').doc(eid);
      const existing = await ref.get();

      if (existing.exists && existing.data().status === 'submitted') {
        errors.push({
          studentId,
          error:
            'Esta calificación ya fue enviada. Solicita una corrección al administrador si necesitas cambiarla.',
        });
        continue;
      }

      const valErr = validateGradeValue(subject, value);
      if (valErr) {
        errors.push({ studentId, error: valErr });
        continue;
      }

      const payload = {
        id: eid,
        studentId,
        subjectId,
        courseId,
        periodKey: String(periodKey).trim(),
        academicYear: year,
        value: String(value).trim(),
        gradingScaleSnapshot: subject.gradingScale || 'numeric',
        performanceCriteriaSnapshot: subject.performanceCriteria || '',
        subjectName: subject.name || '',
        teacherId: subject.teacherId,
        teacherName: subject.teacherName || '',
        status: 'draft',
        updatedAt: new Date(),
      };

      if (!existing.exists) {
        payload.createdAt = new Date();
        payload.createdByTeacherId = uid;
      }

      await ref.set(payload, { merge: true });
      saved += 1;
    }

    return res.json({ message: 'Guardado en borrador', saved, errors });
  } catch (e) {
    console.error('[MARKBOOK save drafts]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * POST /api/report-cards/teacher/markbook/submit
 * Body: { courseId, subjectId, periodKey }
 */
exports.submitTeacherMarkbook = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'teacher') {
      return res.status(403).json({ error: 'Solo docentes pueden enviar calificaciones' });
    }
    const uid = req.user.uid;
    const { courseId, subjectId, periodKey } = req.body;
    if (!courseId || !subjectId || !periodKey) {
      return res.status(400).json({ error: 'courseId, subjectId y periodKey son requeridos' });
    }

    const subject = await loadSubject(subjectId);
    const authErr = await assertTeacherOwnsSubjectForCourse(uid, courseId, subject);
    if (authErr) return res.status(403).json({ error: authErr });

    const year = subject.academicYear || currentYear();
    const students = await studentsInCourse(courseId);

    let submitted = 0;
    const skipped = [];

    for (const st of students) {
      const eid = markbookDocId(st.id, subjectId, year, periodKey);
      const ref = db.collection('markbookEntries').doc(eid);
      const snap = await ref.get();
      if (!snap.exists) {
        skipped.push({ studentId: st.id, reason: 'Sin calificación registrada' });
        continue;
      }
      const data = snap.data();
      if (data.status === 'submitted') {
        skipped.push({ studentId: st.id, reason: 'Ya enviada' });
        continue;
      }
      if (!data.value) {
        skipped.push({ studentId: st.id, reason: 'Sin valor' });
        continue;
      }
      await ref.update({
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date(),
      });
      submitted += 1;
    }

    return res.json({
      message: 'Calificaciones enviadas al registro (bloqueadas para edición docente)',
      submitted,
      skipped,
    });
  } catch (e) {
    console.error('[MARKBOOK submit]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * POST /api/report-cards/teacher/correction-requests
 */
exports.createCorrectionRequest = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'teacher') {
      return res.status(403).json({ error: 'Solo docentes pueden solicitar correcciones' });
    }
    const uid = req.user.uid;
    const { markbookEntryId, reason, proposedValue } = req.body;
    if (!markbookEntryId || !reason?.trim()) {
      return res.status(400).json({ error: 'markbookEntryId y motivo son requeridos' });
    }
    if (proposedValue === undefined || proposedValue === null || String(proposedValue).trim() === '') {
      return res.status(400).json({ error: 'Indica el valor corregido propuesto' });
    }

    const entryRef = db.collection('markbookEntries').doc(markbookEntryId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      return res.status(404).json({ error: 'Registro de calificación no encontrado' });
    }
    const entry = entrySnap.data();
    if (entry.status !== 'submitted') {
      return res.status(400).json({ error: 'Solo se puede solicitar corrección sobre notas ya enviadas' });
    }

    const subject = await loadSubject(entry.subjectId);
    if (!subject || subject.teacherId !== uid) {
      return res.status(403).json({ error: 'No corresponde solicitar corrección sobre esta entrada' });
    }

    const valErr = validateGradeValue(subject, proposedValue);
    if (valErr) return res.status(400).json({ error: valErr });

    const pending = await db
      .collection('gradeCorrectionRequests')
      .where('markbookEntryId', '==', markbookEntryId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!pending.empty) {
      return res.status(400).json({ error: 'Ya existe una solicitud pendiente para esta calificación' });
    }

    const reqRef = await db.collection('gradeCorrectionRequests').add({
      markbookEntryId,
      studentId: entry.studentId,
      subjectId: entry.subjectId,
      courseId: entry.courseId,
      periodKey: entry.periodKey,
      academicYear: entry.academicYear,
      teacherId: uid,
      reason: String(reason).trim(),
      proposedValue: String(proposedValue).trim(),
      status: 'pending',
      createdAt: new Date(),
    });

    return res.status(201).json({ message: 'Solicitud registrada', requestId: reqRef.id });
  } catch (e) {
    console.error('[CORRECTION create]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * GET /api/report-cards/teacher/correction-requests
 */
exports.listTeacherCorrectionRequests = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'teacher') {
      return res.status(403).json({ error: 'Solo docentes' });
    }
    const uid = req.user.uid;
    const snap = await db.collection('gradeCorrectionRequests').where('teacherId', '==', uid).get();
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return res.json({ count: list.length, requests: list });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

/**
 * GET /api/report-cards/admin/correction-requests?status=pending
 */
exports.listAdminCorrectionRequests = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const snap = await db.collection('gradeCorrectionRequests').where('status', '==', status).get();
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return res.json({ count: list.length, requests: list });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

/**
 * GET /api/report-cards/admin/reports
 * Devuelve todos los boletines generados con información básica
 */
exports.listAdminReports = async (req, res) => {
  try {
    const snap = await db.collection('reportCards').get();
    const list = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: d.id,
        studentId: data.studentId,
        studentName: data.studentName || '',
        gradeId: data.gradeId || '',
        courseId: data.courseId || '',
        courseName: data.courseName || '',
        periodKey: data.periodKey || '',
        academicYear: data.academicYear || new Date().getFullYear(),
        published: data.published || false,
        items: data.items || [],
        generatedAt: data.generatedAt,
        publishedAt: data.publishedAt,
      });
    });
    // Ordenar por fecha de generación descendente
    list.sort((a, b) => {
      const aTime = b.generatedAt?.seconds || 0;
      const bTime = a.generatedAt?.seconds || 0;
      return aTime - bTime;
    });
    return res.json(list);
  } catch (e) {
    console.error('[REPORT list]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * POST /api/report-cards/admin/correction-requests/:requestId/resolve
 * Body: { approve: boolean, adminComment?, appliedValue? } — si approve, appliedValue o proposedValue
 */
exports.resolveCorrectionRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { approve, adminComment, appliedValue } = req.body;
    const reqRef = db.collection('gradeCorrectionRequests').doc(requestId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const reqData = reqSnap.data();
    if (reqData.status !== 'pending') {
      return res.status(400).json({ error: 'La solicitud ya fue procesada' });
    }

    const adminUid = req.user.uid;
    const now = new Date();

    if (approve === true) {
      const valueToApply =
        appliedValue !== undefined && appliedValue !== null
          ? String(appliedValue).trim()
          : reqData.proposedValue;

      const subject = await loadSubject(reqData.subjectId);
      const valErr = validateGradeValue(subject, valueToApply);
      if (valErr) return res.status(400).json({ error: valErr });

      const entryRef = db.collection('markbookEntries').doc(reqData.markbookEntryId);
      await entryRef.update({
        value: valueToApply,
        updatedAt: now,
        lastCorrectedByAdminId: adminUid,
        lastCorrectedAt: now,
      });

      await reqRef.update({
        status: 'approved',
        adminComment: adminComment || '',
        resolvedValue: valueToApply,
        resolvedAt: now,
        resolvedBy: adminUid,
      });

      return res.json({ message: 'Solicitud aprobada y calificación actualizada' });
    }

    await reqRef.update({
      status: 'rejected',
      adminComment: adminComment || '',
      resolvedAt: now,
      resolvedBy: adminUid,
    });
    return res.json({ message: 'Solicitud rechazada' });
  } catch (e) {
    console.error('[CORRECTION resolve]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * PATCH /api/report-cards/admin/markbook/:entryId
 * Body: { value }
 */
exports.adminUpdateMarkbook = async (req, res) => {
  try {
    const { entryId } = req.params;
    const { value } = req.body;
    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'value es requerido' });
    }

    const ref = db.collection('markbookEntries').doc(entryId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Entrada no encontrada' });
    const entry = snap.data();
    const subject = await loadSubject(entry.subjectId);
    if (!subject) return res.status(400).json({ error: 'Materia no encontrada' });

    const valErr = validateGradeValue(subject, value);
    if (valErr) return res.status(400).json({ error: valErr });

    await ref.update({
      value: String(value).trim(),
      updatedAt: new Date(),
      lastCorrectedByAdminId: req.user.uid,
      lastCorrectedAt: new Date(),
    });

    return res.json({ message: 'Calificación actualizada por administración' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

/**
 * POST /api/report-cards/admin/reports/generate
 * Body: { studentId, periodKey, academicYear? }
 */
exports.generateReportCard = async (req, res) => {
  try {
    const { studentId, periodKey } = req.body;
    if (!studentId || !periodKey) {
      return res.status(400).json({ error: 'studentId y periodKey son requeridos' });
    }

    const year =
      req.body.academicYear !== undefined && req.body.academicYear !== ''
        ? Number(req.body.academicYear)
        : currentYear();
    if (Number.isNaN(year)) return res.status(400).json({ error: 'Año académico inválido' });

    const stDoc = await db.collection('students').doc(studentId).get();
    if (!stDoc.exists) return res.status(404).json({ error: 'Estudiante no encontrado' });
    const student = stDoc.data();
    const courseId = student.enrollment?.courseId;
    if (!courseId || student.enrollment?.status !== 'active') {
      return res.status(400).json({ error: 'El estudiante no tiene matrícula activa en un curso' });
    }

    const courseDoc = await db.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) return res.status(404).json({ error: 'Curso no encontrado' });
    const course = courseDoc.data();
    const gradeId = course.gradeId;
    const reportYear = course.academicYear && !Number.isNaN(Number(course.academicYear))
      ? Number(course.academicYear)
      : year;

    const subjectsSnap = await db
      .collection('subjects')
      .where('gradeId', '==', gradeId)
      .where('academicYear', '==', reportYear)
      .get();

    const subjects = [];
    subjectsSnap.forEach((d) => {
      const s = d.data();
      if (s.isActive !== false) subjects.push({ id: d.id, ...s });
    });
    subjects.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));

    const pk = String(periodKey).trim();
    const items = [];

    for (const subj of subjects) {
      const eid = markbookDocId(studentId, subj.id, reportYear, pk);
      const entrySnap = await db.collection('markbookEntries').doc(eid).get();
      let value = '—';
      let fromSubmitted = false;
      if (entrySnap.exists) {
        const ed = entrySnap.data();
        if (ed.status === 'submitted' && ed.value) {
          value = ed.value;
          fromSubmitted = true;
        } else if (ed.status === 'draft' && ed.value) {
          value = `${ed.value} (borrador)`;
        }
      }
      items.push({
        subjectId: subj.id,
        subjectName: subj.name || '',
        value,
        gradingScale: subj.gradingScale || 'numeric',
        performanceCriteria: subj.performanceCriteria || '',
        teacherName: subj.teacherName || '',
        includedFromSubmitted: fromSubmitted,
      });
    }

    const rid = reportDocId(studentId, reportYear, pk);
    const reportPayload = {
      id: rid,
      studentId,
      studentName: `${student.name || ''} ${student.lastName || ''}`.trim(),
      gradeId,
      periodKey: pk,
      academicYear: reportYear,
      courseId,
      courseName: course.name || student.enrollment?.courseName || '',
      gradeName: course.gradeName || student.enrollment?.gradeName || '',
      items,
      generatedAt: new Date(),
      generatedBy: req.user.uid,
      published: false,
      publishedAt: null,
    };

    await db.collection('reportCards').doc(rid).set(reportPayload);

    return res.status(201).json({
      message: 'Boletín generado (borrador institucional). Revísalo y publícalo para que lo vean los padres.',
      report: reportPayload,
    });
  } catch (e) {
    console.error('[REPORT generate]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * POST /api/report-cards/admin/reports/:reportId/publish
 */
exports.publishReportCard = async (req, res) => {
  try {
    const { reportId } = req.params;
    const ref = db.collection('reportCards').doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Boletín no encontrado' });

    await ref.update({
      published: true,
      publishedAt: new Date(),
      publishedBy: req.user.uid,
    });

    return res.json({ message: 'Boletín publicado. Los padres pueden visualizarlo.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

/**
 * GET /api/report-cards/admin/reports/student/:studentId?academicYear=
 */
exports.getAdminReportForStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const year =
      req.query.academicYear !== undefined && req.query.academicYear !== ''
        ? Number(req.query.academicYear)
        : currentYear();

    const snap = await db.collection('reportCards').where('studentId', '==', studentId).get();
    const list = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.academicYear === year) {
        list.push({ id: d.id, ...data });
      }
    });
    list.sort((a, b) => String(b.periodKey || '').localeCompare(String(a.periodKey || '')));

    return res.json({ count: list.length, reports: list });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

/**
 * GET /api/report-cards/parent/:studentId?periodKey=&academicYear=
 */
exports.getParentReportCard = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'parent') {
      return res.status(403).json({ error: 'Solo padres/tutores pueden ver boletines aquí' });
    }
    const uid = req.user.uid;
    const { studentId } = req.params;
    const { periodKey, academicYear } = req.query;

    const stDoc = await db.collection('students').doc(studentId).get();
    if (!stDoc.exists) return res.status(404).json({ error: 'Estudiante no encontrado' });
    const student = stDoc.data();
    if (student.parentId !== uid) {
      return res.status(403).json({ error: 'No tienes acceso a este estudiante' });
    }

    const year =
      academicYear !== undefined && academicYear !== '' ? Number(academicYear) : currentYear();
    if (Number.isNaN(year)) return res.status(400).json({ error: 'Año inválido' });

    if (periodKey) {
      const rid = reportDocId(studentId, year, periodKey);
      const rep = await db.collection('reportCards').doc(rid).get();
      if (!rep.exists) {
        return res.status(404).json({ error: 'No hay boletín generado para este período' });
      }
      const data = rep.data();
      if (!data.published) {
        return res.status(403).json({ error: 'El boletín aún no está publicado por la institución' });
      }
      return res.json({ report: { id: rep.id, ...data } });
    }

    const snap = await db.collection('reportCards').where('studentId', '==', studentId).get();
    const published = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.published === true) {
        published.push({
          id: d.id,
          periodKey: data.periodKey,
          academicYear: data.academicYear,
          generatedAt: data.generatedAt,
          publishedAt: data.publishedAt,
        });
      }
    });
    published.sort((a, b) => {
      const ya = Number(b.academicYear) - Number(a.academicYear);
      if (ya !== 0) return ya;
      return String(b.periodKey || '').localeCompare(String(a.periodKey || ''));
    });

    return res.json({ studentId, academicYear: year, reports: published });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

/**
 * GET /api/report-cards/teacher/director-courses
 * Obtener los cursos donde el maestro es director/titular
 */
exports.getTeacherDirectorCourses = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'teacher') {
      return res.status(403).json({ error: 'Solo docentes' });
    }
    const uid = req.user.uid;
    const year = currentYear();

    // Buscar cursos donde este maestro es titularTeacherId
    const snap = await db
      .collection('courses')
      .where('titularTeacherId', '==', uid)
      .where('academicYear', '==', year)
      .get();

    const courses = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.isActive !== false) {
        courses.push({
          id: d.id,
          name: data.name || '',
          gradeName: data.gradeName || '',
          gradeId: data.gradeId || '',
          enrolledCount: data.enrolledCount || 0,
        });
      }
    });
    courses.sort((a, b) => a.name.localeCompare(b.name, 'es'));

    return res.json({ courses, count: courses.length });
  } catch (e) {
    console.error('[DIRECTOR COURSES]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * GET /api/report-cards/teacher/course/:courseId/reports?periodKey=
 * Obtener boletines de los estudiantes de un curso (solo si es director)
 */
exports.getTeacherCourseReportCards = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'teacher') {
      return res.status(403).json({ error: 'Solo docentes' });
    }
    const uid = req.user.uid;
    const { courseId } = req.params;
    const { periodKey } = req.query;

    // Verificar que este maestro es titular del curso
    const courseDoc = await db.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }
    const course = courseDoc.data();
    if (course.titularTeacherId !== uid) {
      return res.status(403).json({ error: 'No eres director de este curso' });
    }

    // Obtener estudiantes del curso
    const students = await studentsInCourse(courseId);
    if (!students.length) {
      return res.json({ courseId, courseName: course.name, reports: [] });
    }

    const year = course.academicYear || currentYear();
    const pk = periodKey ? String(periodKey).trim() : null;

    // Buscar boletines de los estudiantes
    const allReports = [];
    for (const student of students) {
      if (pk) {
        // Buscar período específico
        const rid = reportDocId(student.id, year, pk);
        const rep = await db.collection('reportCards').doc(rid).get();
        if (rep.exists) {
          const data = rep.data();
          allReports.push({
            id: rep.id,
            studentId: student.id,
            studentName: `${student.name || ''} ${student.lastName || ''}`.trim(),
            periodKey: data.periodKey,
            academicYear: data.academicYear,
            published: data.published || false,
            sentToParents: data.sentToParents || false,
            generatedAt: data.generatedAt,
            publishedAt: data.publishedAt,
            sentAt: data.sentToParentsAt,
          });
        }
      } else {
        // Todos los períodos para este estudiante
        const snap = await db
          .collection('reportCards')
          .where('studentId', '==', student.id)
          .where('academicYear', '==', year)
          .get();
        snap.forEach((d) => {
          const data = d.data();
          allReports.push({
            id: d.id,
            studentId: student.id,
            studentName: `${student.name || ''} ${student.lastName || ''}`.trim(),
            periodKey: data.periodKey,
            academicYear: data.academicYear,
            published: data.published || false,
            sentToParents: data.sentToParents || false,
            generatedAt: data.generatedAt,
            publishedAt: data.publishedAt,
            sentAt: data.sentToParentsAt,
          });
        });
      }
    }

    allReports.sort((a, b) => {
      const nameComp = a.studentName.localeCompare(b.studentName, 'es');
      if (nameComp !== 0) return nameComp;
      return String(b.periodKey || '').localeCompare(String(a.periodKey || ''));
    });

    return res.json({
      courseId,
      courseName: course.name || '',
      reports: allReports,
      count: allReports.length,
    });
  } catch (e) {
    console.error('[COURSE REPORTS teacher]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * GET /api/report-cards/admin/reports/search?courseId=&studentCedula=&studentName=&periodKey=&year=
 * Búsqueda avanzada de boletines para admin
 */
exports.searchReportCards = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores' });
    }

    const { courseId, studentCedula, studentName, periodKey, year } = req.query;
    const academicYear = year ? Number(year) : currentYear();

    // Obtener todos los boletines del año académico
    const snap = await db
      .collection('reportCards')
      .where('academicYear', '==', academicYear)
      .get();

    let reports = [];
    snap.forEach((d) => {
      reports.push({ id: d.id, ...d.data() });
    });

    // Filtrar por courseId si se proporciona
    if (courseId && courseId.trim()) {
      reports = reports.filter((r) => r.courseId === courseId);
    }

    // Filtrar por periodKey si se proporciona
    if (periodKey && periodKey.trim()) {
      reports = reports.filter((r) => String(r.periodKey || '').trim() === String(periodKey).trim());
    }

    // Para filtros de estudiante, necesitamos buscar en la colección de estudiantes
    if (studentCedula && studentCedula.trim()) {
      const studentSnap = await db
        .collection('students')
        .where('cedula', '==', studentCedula.trim())
        .limit(1)
        .get();
      if (!studentSnap.empty) {
        const studentId = studentSnap.docs[0].id;
        reports = reports.filter((r) => r.studentId === studentId);
      } else {
        reports = [];
      }
    }

    if (studentName && studentName.trim()) {
      const nameLower = studentName.trim().toLowerCase();
      reports = reports.filter((r) =>
        `${r.studentName || ''}`.toLowerCase().includes(nameLower)
      );
    }

    // Ordenar
    reports.sort((a, b) => {
      const nameComp = String(a.studentName || '').localeCompare(String(b.studentName || ''), 'es');
      if (nameComp !== 0) return nameComp;
      return String(b.periodKey || '').localeCompare(String(a.periodKey || ''));
    });

    return res.json({ reports, count: reports.length });
  } catch (e) {
    console.error('[REPORT search]', e);
    return res.status(500).json({ error: e.message });
  }
};

/**
 * POST /api/report-cards/admin/reports/:reportId/send-to-parents
 * Enviar boletín a padres de familia y disparar notificación
 */
exports.sendReportCardToParents = async (req, res) => {
  try {
    if (getRequestRole(req) !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores' });
    }

    const { reportId } = req.params;
    const ref = db.collection('reportCards').doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Boletín no encontrado' });
    }

    const report = snap.data();

    // Validar que el boletín está publicado
    if (!report.published) {
      return res.status(400).json({
        error: 'El boletín debe estar publicado antes de enviar a padres',
      });
    }

    // Obtener datos del estudiante
    const studentDoc = await db.collection('students').doc(report.studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }
    const student = studentDoc.data();

    // Obtener padre/tutor
    const parentId = student.parentId;
    if (!parentId) {
      return res.status(400).json({ error: 'El estudiante no tiene padre/tutor asignado' });
    }

    // Actualizar boletín con información de envío
    const now = new Date();
    await ref.update({
      sentToParents: true,
      sentToParentsAt: now,
      sentBy: req.user.uid,
    });

    // Crear notificación para el padre
    const { createNotificationsForUsers } = require('../services/notificationTriggers');
    await createNotificationsForUsers([parentId], {
      type: 'report_card',
      title: `Nuevo Boletín de ${report.studentName}`,
      message: `El boletín del período ${report.periodKey} para ${report.studentName} ya está disponible en tu plataforma.`,
      relatedId: reportId,
      createdBy: req.user.uid,
    });

    return res.json({
      message: 'Boletín enviado a padres de familia exitosamente',
      sentAt: now,
    });
  } catch (e) {
    console.error('[REPORT send to parents]', e);
    return res.status(500).json({ error: e.message });
  }
};
