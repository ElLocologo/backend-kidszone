const { db } = require('../config/firebase');

/**
 * Crear un nuevo grado
 * POST /api/grades
 */
exports.createGrade = async (req, res) => {
  try {
    const { name, level, description, minAge, maxAge } = req.body;

    // Validaciones
    if (!name || level === undefined) {
      return res.status(400).json({
        error: 'Nombre y nivel del grado son requeridos'
      });
    }

    if (level < 0 || level > 5) {
      return res.status(400).json({
        error: 'El nivel debe estar entre 0 y 5'
      });
    }

    // Verificar que no exista un grado con el mismo nombre
    const existing = await db.collection('grades')
      .where('name', '==', name)
      .where('academicYear', '==', new Date().getFullYear())
      .get();

    if (!existing.empty) {
      return res.status(400).json({
        error: `Ya existe un grado llamado "${name}" en este año académico`
      });
    }

    // Crear grado
    const gradeRef = db.collection('grades').doc();
    const grade = {
      id: gradeRef.id,
      name,
      level,
      description: description || '',
      minAge: minAge || 0,
      maxAge: maxAge || 0,
      academicYear: new Date().getFullYear(),
      isActive: true,
      createdAt: new Date(),
      createdBy: req.user?.uid || 'system'
    };

    await gradeRef.set(grade);

    console.log(`[GRADE] Grado creado: ${name} (${gradeRef.id})`);

    return res.status(201).json({
      message: 'Grado creado exitosamente',
      grade: {
        id: gradeRef.id,
        ...grade
      }
    });
  } catch (error) {
    console.error('[GRADE CREATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener todos los grados
 * GET /api/grades
 */
exports.getGrades = async (req, res) => {
  try {
    const { academicYear } = req.query;
    const rawYear =
      academicYear !== undefined && academicYear !== ''
        ? Number(academicYear)
        : new Date().getFullYear();
    if (Number.isNaN(rawYear)) {
      return res.status(400).json({ error: 'academicYear inválido' });
    }

    // Una sola igualdad en Firestore evita índices compuestos; filtro y orden en memoria.
    const snapshot = await db
      .collection('grades')
      .where('academicYear', '==', rawYear)
      .get();

    const grades = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.isActive === true) {
        grades.push(data);
      }
    });

    grades.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

    return res.status(200).json({
      count: grades.length,
      grades
    });
  } catch (error) {
    console.error('[GRADE GET] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener un grado específico con sus cursos
 * GET /api/grades/:id
 */
exports.getGradeWithCourses = async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener grado
    const gradeDoc = await db.collection('grades').doc(id).get();
    if (!gradeDoc.exists) {
      return res.status(404).json({ error: 'Grado no encontrado' });
    }

    const grade = gradeDoc.data();

    // Obtener cursos del grado
    const coursesSnapshot = await db.collection('courses')
      .where('gradeId', '==', id)
      .where('isActive', '==', true)
      .get();

    const courses = [];
    coursesSnapshot.forEach(doc => {
      courses.push(doc.data());
    });

    return res.status(200).json({
      grade: {
        id: gradeDoc.id,
        ...grade
      },
      courses,
      courseCount: courses.length
    });
  } catch (error) {
    console.error('[GRADE GET ONE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Actualizar un grado
 * PATCH /api/grades/:id
 */
exports.updateGrade = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, level, description, minAge, maxAge, isActive } = req.body;

    // Verificar que existe
    const gradeDoc = await db.collection('grades').doc(id).get();
    if (!gradeDoc.exists) {
      return res.status(404).json({ error: 'Grado no encontrado' });
    }

    // Preparar datos a actualizar
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (level !== undefined) updateData.level = level;
    if (description !== undefined) updateData.description = description;
    if (minAge !== undefined) updateData.minAge = minAge;
    if (maxAge !== undefined) updateData.maxAge = maxAge;
    if (isActive !== undefined) updateData.isActive = isActive;

    updateData.updatedAt = new Date();

    // Actualizar
    await db.collection('grades').doc(id).update(updateData);

    console.log(`[GRADE] Grado actualizado: ${id}`);

    return res.status(200).json({
      message: 'Grado actualizado exitosamente',
      gradeId: id
    });
  } catch (error) {
    console.error('[GRADE UPDATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Desactivar un grado
 * DELETE /api/grades/:id
 */
exports.deactivateGrade = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que existe
    const gradeDoc = await db.collection('grades').doc(id).get();
    if (!gradeDoc.exists) {
      return res.status(404).json({ error: 'Grado no encontrado' });
    }

    // Desactivar grado
    await db.collection('grades').doc(id).update({
      isActive: false,
      deactivatedAt: new Date()
    });

    // Desactivar todos sus cursos
    const coursesSnapshot = await db.collection('courses')
      .where('gradeId', '==', id)
      .get();

    const batch = db.batch();
    coursesSnapshot.forEach(doc => {
      batch.update(doc.ref, { isActive: false });
    });
    await batch.commit();

    console.log(`[GRADE] Grado desactivado: ${id}`);

    return res.status(200).json({
      message: 'Grado desactivado exitosamente',
      gradeId: id
    });
  } catch (error) {
    console.error('[GRADE DEACTIVATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
