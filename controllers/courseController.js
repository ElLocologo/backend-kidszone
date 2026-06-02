const { db } = require('../config/firebase');
const { getRole, getName } = require('../utils/userCompat');

/**
 * Crear un nuevo curso
 * POST /api/courses
 * Body: { gradeId, name, code, section, capacity, titularTeacherId, roomNumber, schedule }
 */
exports.createCourse = async (req, res) => {
  try {
    const {
      gradeId,
      name,
      code,
      section,
      capacity,
      titularTeacherId,
      secondaryTeachers,
      roomNumber,
      schedule
    } = req.body;

    // Validaciones
    if (!gradeId || !name || !titularTeacherId) {
      return res.status(400).json({
        error: 'gradeId, nombre y titularTeacherId son requeridos'
      });
    }

    // Verificar que el grado existe
    const gradeDoc = await db.collection('grades').doc(gradeId).get();
    if (!gradeDoc.exists) {
      return res.status(404).json({ error: 'Grado no encontrado' });
    }

    // Verificar que el docente titular existe y es docente
    const teacherDoc = await db.collection('usuarios').doc(titularTeacherId).get();
    if (!teacherDoc.exists || getRole(teacherDoc.data()) !== 'teacher') {
      return res.status(404).json({ error: 'Docente titular no encontrado o no es válido' });
    }

    const teacher = teacherDoc.data();
    const grade = gradeDoc.data();

    // Verificar código único
    const existingCode = await db.collection('courses')
      .where('code', '==', code)
      .where('academicYear', '==', new Date().getFullYear())
      .get();

    if (!existingCode.empty) {
      return res.status(400).json({
        error: `El código "${code}" ya está registrado en este año académico`
      });
    }

    // Crear curso
    const courseRef = db.collection('courses').doc();
    const course = {
      id: courseRef.id,
      gradeId,
      gradeName: grade.name,
      name,
      code,
      section: section || 'A',
      capacity: capacity || 30,
      enrolledCount: 0,
      titularTeacherId,
      titularTeacherName: getName(teacher) || '',
      secondaryTeachers: secondaryTeachers || [],
      roomNumber: roomNumber || 'SIN ASIGNAR',
      schedule: schedule || {
        startTime: '08:30',
        endTime: '12:00',
        daysOfWeek: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes']
      },
      isActive: true,
      academicYear: new Date().getFullYear(),
      createdAt: new Date(),
      createdBy: req.user?.uid || 'system'
    };

    await courseRef.set(course);

    // Actualizar docente: agregar curso a titularCourses
    const currentAssignedCourses = teacher.assignedCourses || {};
    const titularCourses = currentAssignedCourses.titularCourses || [];

    if (!titularCourses.includes(courseRef.id)) {
      await db.collection('usuarios').doc(titularTeacherId).update({
        'assignedCourses.titularCourses': [...titularCourses, courseRef.id],
        'assignedCourses.academicYear': new Date().getFullYear()
      });
    }

    console.log(`[COURSE] Curso creado: ${name} (${courseRef.id})`);

    return res.status(201).json({
      message: 'Curso creado exitosamente',
      course: {
        id: courseRef.id,
        ...course
      }
    });
  } catch (error) {
    console.error('[COURSE CREATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener cursos - todos o filtrados por grado
 * GET /api/courses?gradeId=xxx (opcional)
 */
exports.getCoursesByGrade = async (req, res) => {
  try {
    const { gradeId, includeInactive } = req.query;

    let query = db.collection('courses');

    // Si se proporciona gradeId, filtra por ese grado; si no, devuelve todos
    if (gradeId) {
      query = query.where('gradeId', '==', gradeId);
    }

    const snapshot = await query.get();

    const courses = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (includeInactive === 'true' || data.isActive === true) {
        courses.push({
          id: doc.id,
          ...data
        });
      }
    });

    courses.sort((a, b) =>
      String(a.section ?? '').localeCompare(String(b.section ?? ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );

    return res.status(200).json({
      gradeId: gradeId || 'all',
      count: courses.length,
      courses
    });
  } catch (error) {
    console.error('[COURSE GET] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener curso con estudiantes
 * GET /api/courses/:id/students
 */
exports.getCourseWithStudents = async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener curso
    const courseDoc = await db.collection('courses').doc(id).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    const course = courseDoc.data();

    // Obtener estudiantes del curso
    const studentsSnapshot = await db.collection('students')
      .where('enrollment.courseId', '==', id)
      .where('enrollment.status', '==', 'active')
      .get();

    const students = [];
    studentsSnapshot.forEach(doc => {
      students.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return res.status(200).json({
      course: {
        id: courseDoc.id,
        ...course
      },
      students,
      studentCount: students.length
    });
  } catch (error) {
    console.error('[COURSE GET WITH STUDENTS] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Agregar docente secundario a curso
 * POST /api/courses/:id/secondary-teachers
 * Body: { teacherId }
 */
exports.addSecondaryTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { teacherId } = req.body;

    if (!teacherId) {
      return res.status(400).json({ error: 'teacherId es requerido' });
    }

    // Verificar que el curso existe
    const courseDoc = await db.collection('courses').doc(id).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    // Verificar que el docente existe
    const teacherDoc = await db.collection('usuarios').doc(teacherId).get();
    if (!teacherDoc.exists || getRole(teacherDoc.data()) !== 'teacher') {
      return res.status(404).json({ error: 'Docente no encontrado' });
    }

    const course = courseDoc.data();
    const teacher = teacherDoc.data();

    // Verificar que no esté duplicado
    const secondaryTeachers = course.secondaryTeachers || [];
    if (secondaryTeachers.includes(teacherId)) {
      return res.status(400).json({ error: 'Este docente ya está asignado como secundario' });
    }

    // Agregar a curso
    await db.collection('courses').doc(id).update({
      'secondaryTeachers': [...secondaryTeachers, teacherId]
    });

    // Agregar a docente
    const currentAssignedCourses = teacher.assignedCourses || {};
    const secondaryCourses = currentAssignedCourses.secondaryCourses || [];

    if (!secondaryCourses.includes(id)) {
      await db.collection('usuarios').doc(teacherId).update({
        'assignedCourses.secondaryCourses': [...secondaryCourses, id],
        'assignedCourses.academicYear': new Date().getFullYear()
      });
    }

    console.log(`[COURSE] Docente secundario agregado: ${teacherId} a curso ${id}`);

    return res.status(200).json({
      message: 'Docente secundario agregado exitosamente',
      courseId: id,
      teacherId
    });
  } catch (error) {
    console.error('[COURSE ADD TEACHER] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Actualizar curso
 * PATCH /api/courses/:id
 */
exports.updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, capacity, roomNumber, schedule, isActive } = req.body;

    // Verificar que existe
    const courseDoc = await db.collection('courses').doc(id).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    // Preparar datos
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (capacity !== undefined) updateData.capacity = capacity;
    if (roomNumber !== undefined) updateData.roomNumber = roomNumber;
    if (schedule !== undefined) updateData.schedule = schedule;
    if (isActive !== undefined) updateData.isActive = isActive;

    updateData.updatedAt = new Date();

    // Actualizar
    await db.collection('courses').doc(id).update(updateData);

    console.log(`[COURSE] Curso actualizado: ${id}`);

    return res.status(200).json({
      message: 'Curso actualizado exitosamente',
      courseId: id
    });
  } catch (error) {
    console.error('[COURSE UPDATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
