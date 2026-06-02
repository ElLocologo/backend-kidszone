const { auth, db } = require('../config/firebase');
const studentController = require('./studentController');
const { toFirestoreUser, normalizeUser, getRole, getChildren } = require('../utils/userCompat');

async function ensureParentStudentAssociationSimple(parentId, parentEmail, studentId, studentName) {
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

// Crear maestro
exports.createTeacher = async (req, res) => {
  try {
    const { email, password, name, cedula, phone, specialization, yearsExperience } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, contraseña y nombre son requeridos' });
    }

    // Verificar si el usuario ya existe en Firestore
    const existingUser = await db.collection('usuarios').where('email', '==', email).get();
    if (!existingUser.empty) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Crear usuario en Firebase Authentication
    let firebaseUser;
    try {
      firebaseUser = await auth.createUser({
        email,
        password,
        displayName: name,
      });
      console.log('[TEACHER] Usuario creado en Firebase Auth:', firebaseUser.uid);
    } catch (authError) {
      return res.status(400).json({ error: 'Error al crear usuario en Firebase: ' + authError.message });
    }

    // Crear usuario en Firestore con el UID de Firebase
    await db.collection('usuarios').doc(firebaseUser.uid).set(toFirestoreUser({
      id: firebaseUser.uid,
      email,
      name,
      cedula: cedula || '',
      role: 'teacher',
      phone: phone || '',
      specialization: specialization || '',
      yearsExperience: yearsExperience || 0,
      isActive: true,
      assignedCourses: {
        titularCourses: [],
        secondaryCourses: [],
      },
      createdAt: new Date(),
    }));

    return res.status(201).json({
      message: 'Maestro creado correctamente',
      teacherId: firebaseUser.uid,
    });
  } catch (error) {
    console.error('[TEACHER] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Crear estudiante - delega a studentController
exports.createStudent = async (req, res) => {
  // El nuevo flujo requiere courseId obligatorio
  return studentController.createStudent(req, res);
};

// Crear cuenta de acceso para padre
exports.createParentAccount = async (req, res) => {
  try {
    const { email, name, studentIds } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email y nombre son requeridos' });
    }

    // Verificar si el usuario ya existe en Firestore
    const existingParent = await db.collection('usuarios').where('email', '==', email).get();
    if (!existingParent.empty) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Generar contraseña temporal
    const tempPassword = Math.random().toString(36).slice(-10);

    // Crear usuario en Firebase Authentication
    let firebaseUser;
    try {
      firebaseUser = await auth.createUser({
        email,
        password: tempPassword,
        displayName: name,
      });
      console.log('[PARENT] Usuario creado en Firebase Auth:', firebaseUser.uid);
    } catch (authError) {
      return res.status(400).json({ error: 'Error al crear usuario en Firebase: ' + authError.message });
    }

    // Crear usuario padre en Firestore con el UID de Firebase
    const childrenIds = Array.isArray(studentIds) ? studentIds.filter(Boolean) : [];

    await db.collection('usuarios').doc(firebaseUser.uid).set(toFirestoreUser({
      id: firebaseUser.uid,
      email,
      name,
      role: 'parent',
      isActive: true,
      createdAt: new Date(),
      children: childrenIds,
    }));

    const parentUid = firebaseUser.uid;
    for (const sid of childrenIds) {
      const sref = db.collection('students').doc(sid);
      const sdoc = await sref.get();
      if (!sdoc.exists) continue;
      const sd = sdoc.data();
      await sref.update({
        parentId: parentUid,
        parentEmail: email,
        updatedAt: new Date(),
        updatedBy: req.user?.uid || 'admin',
      });
      await ensureParentStudentAssociationSimple(
        parentUid,
        email,
        sid,
        `${sd.name || ''} ${sd.lastName || ''}`.trim()
      );
    }

    return res.status(201).json({
      message: 'Cuenta de padre creada correctamente',
      parentId: firebaseUser.uid,
      email,
      tempPassword, // Esto debería enviarse por email en una aplicación real
    });
  } catch (error) {
    console.error('[PARENT] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Obtener todos los maestros
exports.getAllTeachers = async (req, res) => {
  try {
    const teachersSnapshot = await db.collection('usuarios').where('role', '==', 'teacher').get();
    const teachers = teachersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...normalizeUser(doc.data()),
    }));

    return res.json(teachers);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener todos los estudiantes
exports.getAllStudents = async (req, res) => {
  try {
    const studentsSnapshot = await db.collection('students').get();
    
    // Cargar todos los cursos y grados para enriquecer los datos
    const coursesSnapshot = await db.collection('courses').get();
    const coursesMap = new Map();
    const gradesMap = new Map();
    
    coursesSnapshot.docs.forEach(doc => {
      const course = doc.data();
      coursesMap.set(doc.id, course);
    });

    const gradesSnapshot = await db.collection('grades').get();
    gradesSnapshot.docs.forEach(doc => {
      const grade = doc.data();
      gradesMap.set(doc.id, grade);
    });
    
    // Enriquecer estudiantes con datos de curso y grado
    const students = studentsSnapshot.docs.map(doc => {
      const studentData = doc.data();
      const enrollment = studentData.enrollment;
      
      // Si hay enrollment válido, enriquecer con datos de curso y grado
      if (enrollment && enrollment.courseId) {
        const course = coursesMap.get(enrollment.courseId);
        const gradeId = enrollment.gradeId || course?.gradeId;
        const grade = gradeId ? gradesMap.get(gradeId) : null;
        
        return {
          id: doc.id,
          ...studentData,
          enrollment: {
            ...enrollment,
            courseName: course?.name || '—',
            gradeName: grade?.name || '—',
            gradeId: gradeId || '—',
          }
        };
      }
      
      // Si no hay enrollment o está vacío, crear una estructura mínima
      return {
        id: doc.id,
        ...studentData,
        enrollment: {
          courseId: null,
          gradeId: null,
          courseName: '—',
          gradeName: '—',
          status: 'inactive',
          dateEnrolled: null,
        }
      };
    });

    return res.json(students);
  } catch (error) {
    console.error('Error en getAllStudents:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Obtener todos los padres
exports.getAllParents = async (req, res) => {
  try {
    // Obtener todos los padres
    const parentsSnapshot = await db.collection('usuarios').where('role', '==', 'parent').get();
    
    let parents = parentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...normalizeUser(doc.data()),
    }));

    // Obtener todos los estudiantes para enriquecer la información de los hijos
    const studentsSnapshot = await db.collection('students').get();
    const studentsMap = new Map();
    studentsSnapshot.docs.forEach(doc => {
      studentsMap.set(doc.id, { id: doc.id, ...doc.data() });
    });

    // Enriquecer a cada padre con los detalles de sus hijos
    parents = parents.map(parent => {
      const childrenIds = getChildren(parent);
      const enrichedChildren = childrenIds
        .map(studentId => studentsMap.get(studentId))
        .filter(Boolean) // Eliminar cualquier hijo que no se encuentre en studentsMap
        .map(student => ({ id: student.id, name: `${student.name || ''} ${student.lastName || ''}`.trim() }));

      return {
        ...parent,
        children: enrichedChildren,
      };
    });

    return res.json(parents);
  } catch (error) {
    console.error('[getAllParents] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, cedula, specialization, yearsExperience, isActive } = req.body;

    const doc = await db.collection('usuarios').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (getRole(doc.data()) !== 'teacher') {
      return res.status(400).json({ error: 'El usuario no es docente' });
    }

    const updates = { updatedAt: new Date() };
    if (name !== undefined) {
      updates.name = name;
    }
    if (phone !== undefined) {
      updates.phone = phone;
    }
    if (cedula !== undefined) {
      updates.cedula = cedula;
    }
    if (specialization !== undefined) {
      updates.specialization = specialization;
    }
    if (yearsExperience !== undefined) {
      updates.yearsExperience = yearsExperience;
    }
    if (isActive !== undefined) {
      updates.isActive = isActive;
    }

    await db.collection('usuarios').doc(id).update(updates);

    if (name !== undefined) {
      try {
        await auth.updateUser(id, { displayName: name });
      } catch (e) {
        console.warn('[TEACHER UPDATE] Auth displayName:', e.message);
      }
    }
    if (isActive !== undefined) {
      await auth.updateUser(id, { disabled: !isActive });
    }

    return res.json({ message: 'Maestro actualizado', teacherId: id });
  } catch (error) {
    console.error('[TEACHER UPDATE]', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.resetTeacherPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection('usuarios').doc(id).get();
    if (!doc.exists || getRole(doc.data()) !== 'teacher') {
      return res.status(404).json({ error: 'Docente no encontrado' });
    }
    const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
    await auth.updateUser(id, { password: tempPassword });
    return res.json({
      message: 'Contraseña temporal generada',
      tempPassword,
    });
  } catch (error) {
    console.error('[TEACHER RESET PW]', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.updateParent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, cedula, isActive } = req.body;

    const doc = await db.collection('usuarios').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (getRole(doc.data()) !== 'parent') {
      return res.status(400).json({ error: 'El usuario no es padre/tutor' });
    }

    const updates = { updatedAt: new Date() };
    if (name !== undefined) {
      updates.name = name;
    }
    if (phone !== undefined) {
      updates.phone = phone;
    }
    if (cedula !== undefined) {
      updates.cedula = cedula;
    }
    if (isActive !== undefined) {
      updates.isActive = isActive;
    }

    await db.collection('usuarios').doc(id).update(updates);

    if (name !== undefined) {
      try {
        await auth.updateUser(id, { displayName: name });
      } catch (e) {
        console.warn('[PARENT UPDATE] Auth displayName:', e.message);
      }
    }
    if (isActive !== undefined) {
      await auth.updateUser(id, { disabled: !isActive });
    }

    return res.json({ message: 'Padre actualizado', parentId: id });
  } catch (error) {
    console.error('[PARENT UPDATE]', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.resetParentPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection('usuarios').doc(id).get();
    if (!doc.exists || getRole(doc.data()) !== 'parent') {
      return res.status(404).json({ error: 'Padre no encontrado' });
    }
    const tempPassword = Math.random().toString(36).slice(-12) + 'a1!';
    await auth.updateUser(id, { password: tempPassword });
    return res.json({
      message: 'Contraseña temporal generada',
      tempPassword,
    });
  } catch (error) {
    console.error('[PARENT RESET PW]', error);
    return res.status(500).json({ error: error.message });
  }
};
