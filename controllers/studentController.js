const { db } = require('../config/firebase');
const { getRole, getChildren } = require('../utils/userCompat');

/**
 * Asocia padre–estudiante en Firestore: parentAssociations (formato compatible con APIs)
 * y arrays hijos/children del usuario padre.
 */
async function ensureParentStudentAssociation(db, {
  parentId,
  parentEmail,
  studentId,
  studentName,
}) {
  const parentRef = db.collection('usuarios').doc(parentId);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) return;

  const parentData = parentSnap.data();
  const email = (parentEmail || parentData.email || '').trim();

  const dup = await db.collection('parentAssociations')
    .where('parentId', '==', parentId)
    .where('studentIds', 'array-contains', studentId)
    .limit(1)
    .get();

  if (dup.empty) {
    const assocRef = db.collection('parentAssociations').doc();
    await assocRef.set({
      id: assocRef.id,
      parentId,
      parentEmail: email,
      studentIds: [studentId],
      relationships: [
        {
          studentId,
          studentName: studentName || '',
          relationship: 'Tutor',
        },
      ],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const currentStudents = getChildren(parentData);
  if (!currentStudents.includes(studentId)) {
    await parentRef.update({
      children: [...currentStudents, studentId],
      updatedAt: new Date(),
    });
  }
}

/**
 * Crear estudiante con matriculación obligatoria en un curso
 * POST /api/students
 * Body requerido: { name, lastName, email, dateOfBirth, courseId, parentEmail }
 */
exports.createStudent = async (req, res) => {
  try {
    const {
      name,
      lastName,
      email,
      cedula,
      dateOfBirth,
      courseId,
      parentEmail,
      medicalInfo,
      allergies,
      emergencyContact
    } = req.body;

    // Validaciones obligatorias
    if (!name || !lastName || !email || !cedula || !courseId) {
      return res.status(400).json({
        error: 'Nombre, apellido, cédula, email y courseId son requeridos'
      });
    }

    // Validar que el curso existe y está activo
    const courseDoc = await db.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    const course = courseDoc.data();
    if (!course.isActive) {
      return res.status(400).json({ error: 'El curso no está activo' });
    }

    // Validar que hay capacidad disponible
    if (course.enrolledCount >= course.capacity) {
      return res.status(400).json({
        error: `El curso está lleno. Capacidad: ${course.capacity}, Inscritos: ${course.enrolledCount}`
      });
    }

    // Validar que el email del padre existe
    let parentId = null;
    if (parentEmail) {
      const parentByEmail = await db.collection('usuarios')
        .where('email', '==', parentEmail)
        .get();

      const parentCandidate = parentByEmail.docs.find((doc) => getRole(doc.data()) === 'parent');
      if (!parentCandidate) {
        return res.status(404).json({
          error: `Padre con email ${parentEmail} no encontrado`
        });
      }

      parentId = parentCandidate.id;
    }

    // Crear documento de estudiante
    const studentRef = db.collection('students').doc();
    const studentData = {
      id: studentRef.id,
      name,
      lastName,
      cedula,
      email,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      // OBLIGATORIO: Matriculación en curso
      enrollment: {
        courseId,
        gradeId: course.gradeId,
        gradeName: course.gradeName,
        courseName: course.name,
        status: 'active', // active, inactive, suspended
        dateEnrolled: new Date(),
        dateCompleted: null
      },
      parentId: parentId || null,
      parentEmail: parentEmail || '',
      medicalInfo: {
        bloodType: medicalInfo?.bloodType || '',
        chronicDiseases: medicalInfo?.chronicDiseases || [],
        medications: medicalInfo?.medications || [],
        allergies: allergies || []
      },
      emergencyContact: {
        name: emergencyContact?.name || '',
        phone: emergencyContact?.phone || '',
        relationship: emergencyContact?.relationship || ''
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.user?.uid || 'system'
    };

    await studentRef.set(studentData);

    // Actualizar contador de inscritos en el curso
    await db.collection('courses').doc(courseId).update({
      enrolledCount: course.enrolledCount + 1,
      updatedAt: new Date()
    });

    if (parentId) {
      const parentSnap = await db.collection('usuarios').doc(parentId).get();
      const pEmail =
        parentSnap.exists && parentSnap.data().email
          ? parentSnap.data().email
          : parentEmail;
      await ensureParentStudentAssociation(db, {
        parentId,
        parentEmail: pEmail || parentEmail,
        studentId: studentRef.id,
        studentName: `${name} ${lastName}`,
      });
    }

    console.log(`[STUDENT] Estudiante creado: ${name} ${lastName} (${studentRef.id}) en curso ${courseId}`);

    return res.status(201).json({
      success: true,
      message: 'Estudiante creado y matriculado exitosamente',
      studentId: studentRef.id,
      data: studentData
    });
  } catch (error) {
    console.error('[STUDENT CREATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Vincular estudiante existente a un padre (por email). Solo si aún no tiene parentId.
 * PATCH /api/students/:id/link-parent  Body: { parentEmail }
 */
exports.linkStudentToParent = async (req, res) => {
  try {
    const { id } = req.params;
    const rawEmail = req.body.parentEmail;
    if (!rawEmail || !String(rawEmail).trim()) {
      return res.status(400).json({ error: 'parentEmail es requerido' });
    }
    const parentEmailNorm = String(rawEmail).trim().toLowerCase();

    const studentDoc = await db.collection('students').doc(id).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }
    const student = studentDoc.data();

    if (student.parentId) {
      return res.status(400).json({
        error:
          'Este estudiante ya tiene un padre vinculado. Usa otro flujo o contacta al administrador.',
      });
    }

    const parentByEmail = await db.collection('usuarios')
      .where('email', '==', parentEmailNorm)
      .get();

    const parentCandidate = parentByEmail.docs.find(
      (doc) => getRole(doc.data()) === 'parent'
    );
    if (!parentCandidate) {
      return res.status(404).json({
        error: `No hay cuenta de padre registrada con el email ${parentEmailNorm}`,
      });
    }

    const parentId = parentCandidate.id;

    await db.collection('students').doc(id).update({
      parentId,
      parentEmail: parentEmailNorm,
      updatedAt: new Date(),
      updatedBy: req.user?.uid || 'system',
    });

    await ensureParentStudentAssociation(db, {
      parentId,
      parentEmail: parentEmailNorm,
      studentId: id,
      studentName: `${student.name || ''} ${student.lastName || ''}`.trim(),
    });

    return res.status(200).json({
      success: true,
      message: 'Padre vinculado correctamente',
      parentId,
      studentId: id,
    });
  } catch (error) {
    console.error('[STUDENT LINK PARENT] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener todos los estudiantes de un curso
 * GET /api/students?courseId=xxx
 */
exports.getStudentsByCourse = async (req, res) => {
  try {
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({ error: 'courseId es requerido' });
    }

    const snapshot = await db
      .collection('students')
      .where('enrollment.courseId', '==', courseId)
      .get();

    const students = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.enrollment?.status !== 'active') return;
      students.push({
        id: doc.id,
        ...data
      });
    });

    students.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'es', {
        sensitivity: 'base',
      })
    );

    return res.status(200).json({
      courseId,
      count: students.length,
      students
    });
  } catch (error) {
    console.error('[STUDENT GET BY COURSE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener estudiante por ID
 * GET /api/students/:id
 */
exports.getStudentById = async (req, res) => {
  try {
    const { id } = req.params;

    const studentDoc = await db.collection('students').doc(id).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    return res.status(200).json({
      id: studentDoc.id,
      ...studentDoc.data()
    });
  } catch (error) {
    console.error('[STUDENT GET BY ID] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener estudiantes de un padre
 * GET /api/students/parent/:parentId
 */
exports.getStudentsByParent = async (req, res) => {
  try {
    const { parentId } = req.params;

    const callerUid = req.user.uid;
    const callerRole =
      req.user.role || req.user.claims?.role || '';

    if (parentId !== callerUid && callerRole !== 'admin') {
      return res.status(403).json({
        error: 'No autorizado para ver estos estudiantes',
      });
    }

    // Solo filtramos por parentId en Firestore (un índice compuesto basta).
    // El filtrado de matrícula se hace en memoria: los documentos antiguos no tienen
    // `enrollment` y quedarían excluidos con .where('enrollment.status', '==', 'active').
    const snapshot = await db.collection('students')
      .where('parentId', '==', parentId)
      .get();

    const list = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });

    const students = list.filter((s) => {
      const st = s.enrollment?.status;
      if (st === 'inactive' || st === 'suspended') return false;
      return true;
    });

    students.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'es', {
        sensitivity: 'base',
      })
    );

    return res.status(200).json({
      parentId,
      count: students.length,
      students
    });
  } catch (error) {
    console.error('[STUDENT GET BY PARENT] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Cambiar estudiante de curso
 * PATCH /api/students/:id/transfer
 */
exports.transferStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { newCourseId } = req.body;

    if (!newCourseId) {
      return res.status(400).json({ error: 'newCourseId es requerido' });
    }

    // Obtener estudiante actual
    const studentDoc = await db.collection('students').doc(id).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    const student = studentDoc.data();
    const oldCourseId = student.enrollment.courseId;

    // Obtener nuevo curso
    const newCourseDoc = await db.collection('courses').doc(newCourseId).get();
    if (!newCourseDoc.exists) {
      return res.status(404).json({ error: 'Nuevo curso no encontrado' });
    }

    const newCourse = newCourseDoc.data();

    // Validar capacidad del nuevo curso
    if (newCourse.enrolledCount >= newCourse.capacity) {
      return res.status(400).json({
        error: 'El nuevo curso está lleno'
      });
    }

    // Actualizar estudiante
    const newEnrollment = {
      ...student.enrollment,
      courseId: newCourseId,
      gradeId: newCourse.gradeId,
      gradeName: newCourse.gradeName,
      courseName: newCourse.name
    };

    await db.collection('students').doc(id).update({
      enrollment: newEnrollment,
      updatedAt: new Date(),
      updatedBy: req.user?.uid || 'system'
    });

    // Actualizar contadores de cursos
    const oldCourseDoc = await db.collection('courses').doc(oldCourseId).get();
    const oldCourse = oldCourseDoc.data();

    await db.collection('courses').doc(oldCourseId).update({
      enrolledCount: Math.max(0, oldCourse.enrolledCount - 1),
      updatedAt: new Date()
    });

    await db.collection('courses').doc(newCourseId).update({
      enrolledCount: newCourse.enrolledCount + 1,
      updatedAt: new Date()
    });

    console.log(`[STUDENT] Estudiante transferido: ${id} de ${oldCourseId} a ${newCourseId}`);

    return res.status(200).json({
      success: true,
      message: 'Estudiante transferido exitosamente',
      studentId: id,
      oldCourseId,
      newCourseId
    });
  } catch (error) {
    console.error('[STUDENT TRANSFER] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Actualizar información del estudiante
 * PATCH /api/students/:id
 */
exports.updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, lastName, cedula, email, dateOfBirth, medicalInfo, allergies, emergencyContact } = req.body;

    // Obtener estudiante
    const studentDoc = await db.collection('students').doc(id).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    // Preparar datos a actualizar
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (cedula !== undefined) updateData.cedula = cedula;
    if (email !== undefined) updateData.email = email;
    if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    // SOLUCIÓN: Fusionamos todo lo médico en un solo objeto limpio sin usar puntos
    if (medicalInfo !== undefined || allergies !== undefined) {
      const currentMedicalInfo = studentDoc.data().medicalInfo || {};
      
      updateData.medicalInfo = {
        ...currentMedicalInfo,               // Lo que ya estaba en Firebase (ej: tipo de sangre, etc.)
        ...(medicalInfo !== undefined ? medicalInfo : {}), // Los nuevos datos médicos que vengan del formulario
      };

      // Si vienen alergias desde el frontend, las guardamos limpiamente dentro del mismo objeto
      if (allergies !== undefined) {
        updateData.medicalInfo.allergies = allergies;
      }
    }
    if (emergencyContact !== undefined) updateData['emergencyContact'] = { ...studentDoc.data().emergencyContact, ...emergencyContact };

    updateData.updatedAt = new Date();
    updateData.updatedBy = req.user?.uid || 'system';

    // Actualizar
    await db.collection('students').doc(id).update(updateData);

    console.log(`[STUDENT] Estudiante actualizado: ${id}`);

    return res.status(200).json({
      success: true,
      message: 'Estudiante actualizado',
      studentId: id
    });
  } catch (error) {
    console.error('[STUDENT UPDATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Desactivar estudiante (cambiar estado de matriculación)
 * PATCH /api/students/:id/deactivate
 */
exports.deactivateStudent = async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener estudiante
    const studentDoc = await db.collection('students').doc(id).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    const student = studentDoc.data();

    // Desactivar matriculación
    await db.collection('students').doc(id).update({
      'enrollment.status': 'inactive',
      'enrollment.dateCompleted': new Date(),
      updatedAt: new Date(),
      updatedBy: req.user?.uid || 'system'
    });

    // Disminuir contador del curso
    const courseDoc = await db.collection('courses').doc(student.enrollment.courseId).get();
    const course = courseDoc.data();

    await db.collection('courses').doc(student.enrollment.courseId).update({
      enrolledCount: Math.max(0, course.enrolledCount - 1),
      updatedAt: new Date()
    });

    console.log(`[STUDENT] Estudiante desactivado: ${id}`);

    return res.status(200).json({
      success: true,
      message: 'Estudiante desactivado',
      studentId: id
    });
  } catch (error) {
    console.error('[STUDENT DEACTIVATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
