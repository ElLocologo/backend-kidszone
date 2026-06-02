/**
 * SCRIPT DE SEED DATA - Crear datos de prueba
 * 
 * Crea:
 * - 10 maestros
 * - 40 padres
 * - 46 alumnos
 * - 2 grados (Kinder, Pre-kinder)
 * - 3 cursos (Kinder A, Kinder B, Pre-kinder A)
 * - Asignación de maestros a cursos
 * - Materias asignadas a maestros
 * 
 * USO:
 * node backend/seeds/seedData.js
 * 
 * NOTA: Es idempotente - no crea duplicados si se ejecuta múltiples veces
 */

const { auth, db } = require('../config/firebase');
const { toFirestoreUser } = require('../utils/userCompat');

// Configuración
const SEED_CONFIG = {
  teachers: 10,
  parents: 40,
  students: 46,
  defaultTeacherPassword: 'Maestro123!',
  defaultParentPassword: 'Padre123!',
};

// Datos base
const GRADES_DATA = [
  { id: 'grade_kinder', name: 'Kinder', level: 1, description: 'Jardin de niños', academicYear: 2026 },
  { id: 'grade_prekinder', name: 'Pre-kinder', level: 0, description: 'Pre-jardin', academicYear: 2026 },
];

const COURSES_DATA = [
  { id: 'course_kinder_a', gradeId: 'grade_kinder', name: 'Kinder A', code: 'KA-2026', section: 'A', capacity: 15, academicYear: 2026 },
  { id: 'course_kinder_b', gradeId: 'grade_kinder', name: 'Kinder B', code: 'KB-2026', section: 'B', capacity: 15, academicYear: 2026 },
  { id: 'course_prekinder_a', gradeId: 'grade_prekinder', name: 'Pre-kinder A', code: 'PA-2026', section: 'A', capacity: 16, academicYear: 2026 },
];

const SUBJECTS_DATA = [
  { id: 'subject_math', name: 'Matemáticas', description: 'Aprendizaje de números y operaciones' },
  { id: 'subject_spanish', name: 'Español', description: 'Lectura y escritura' },
  { id: 'subject_english', name: 'Inglés', description: 'Idioma inglés' },
  { id: 'subject_science', name: 'Ciencias', description: 'Exploración científica' },
  { id: 'subject_arts', name: 'Artes', description: 'Artes plásticas y expresión' },
];

// Configuración de asignaciones
const TEACHER_ASSIGNMENTS = {
  'teacher_001': ['course_kinder_a'],  // Maestro 1 → Kinder A
  'teacher_002': ['course_kinder_b'],  // Maestro 2 → Kinder B
  'teacher_003': ['course_prekinder_a'], // Maestro 3 → Pre-kinder A
  // Maestros 4-10 sin curso asignado
};

const TEACHER_SUBJECTS = {
  'teacher_001': ['subject_math', 'subject_spanish'],
  'teacher_002': ['subject_english', 'subject_science'],
  'teacher_003': ['subject_arts', 'subject_math'],
  'teacher_004': ['subject_spanish'],
  'teacher_005': ['subject_english'],
  'teacher_006': ['subject_science'],
  'teacher_007': ['subject_arts'],
  'teacher_008': ['subject_math'],
  'teacher_009': ['subject_spanish'],
  'teacher_010': ['subject_english'],
};

// Nombres para generar
const FIRST_NAMES_TEACHERS = [
  'Carlos', 'Maria', 'Juan', 'Patricia', 'Roberto', 'Luz', 'Fernando', 'Rosa', 'Miguel', 'Ana'
];

const LAST_NAMES = [
  'Lopez', 'Garcia', 'Rodriguez', 'Martinez', 'Fernandez', 'Gonzalez', 'Perez', 'Sanchez',
  'Diaz', 'Ramirez', 'Torres', 'Rivera', 'Cruz', 'Morales', 'Ortiz'
];

const FIRST_NAMES_STUDENTS = [
  'Lucas', 'Sofia', 'Diego', 'Emma', 'Mateo', 'Olivia', 'Samuel', 'Ava', 'Gabriel', 'Isabella',
  'Daniel', 'Mia', 'Alejandro', 'Valentina', 'Andres', 'Camila', 'Felipe', 'Martina', 'Juan', 'Giuliana',
  'Sebastian', 'Carolina', 'Nicolas', 'Francisca', 'Ricardo', 'Gabriela', 'Javier', 'Mariana', 'Gustavo', 'Patricia',
  'Raul', 'Veronica', 'Hector', 'Silvia', 'Marcos', 'Roxana', 'Luis', 'Sandra', 'Eduardo', 'Irene',
  'Victor', 'Nora', 'Victor', 'Elena', 'Enrique', 'Lidia'
];

// Utilidades
function removeTildes(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function randomName() {
  return LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
}

function getRandomCourse() {
  const courses = ['course_kinder_a', 'course_kinder_b', 'course_prekinder_a'];
  return courses[Math.floor(Math.random() * courses.length)];
}

function getRandomGrade() {
  return ['grade_kinder', 'grade_prekinder'][Math.floor(Math.random() * 2)];
}

async function checkExists(collectionName, docId) {
  try {
    const doc = await db.collection(collectionName).doc(docId).get();
    return doc.exists;
  } catch (err) {
    return false;
  }
}

async function createGrades() {
  console.log('\n📚 Creando grados...');
  let created = 0;

  for (const gradeData of GRADES_DATA) {
    const exists = await checkExists('grades', gradeData.id);
    
    if (!exists) {
      await db.collection('grades').doc(gradeData.id).set({
        ...gradeData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`   ✅ Grado creado: ${gradeData.name}`);
      created++;
    } else {
      console.log(`   ⏭️  Grado existente: ${gradeData.name}`);
    }
  }

  console.log(`\n✨ Total grados creados: ${created}`);
  return created;
}

async function createCourses() {
  console.log('\n🏫 Creando cursos...');
  let created = 0;

  for (const courseData of COURSES_DATA) {
    const exists = await checkExists('courses', courseData.id);
    
    if (!exists) {
      await db.collection('courses').doc(courseData.id).set({
        ...courseData,
        enrolledCount: 0,
        isActive: true,
        roomNumber: 'SIN ASIGNAR',
        schedule: {
          startTime: '08:30',
          endTime: '12:00',
          daysOfWeek: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes']
        },
        secondaryTeachers: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`   ✅ Curso creado: ${courseData.name}`);
      created++;
    } else {
      console.log(`   ⏭️  Curso existente: ${courseData.name}`);
    }
  }

  console.log(`\n✨ Total cursos creados: ${created}`);
  return created;
}

async function createSubjects() {
  console.log('\n📖 Creando materias para maestros...');
  let created = 0;

  // Crear una entrada de materia para cada maestro que tenga esa materia asignada
  for (const [teacherId, subjectIds] of Object.entries(TEACHER_SUBJECTS)) {
    // Obtener datos del maestro
    const teacherDoc = await db.collection('usuarios').doc(teacherId).get();
    if (!teacherDoc.exists) {
      console.log(`   ⏭️  Maestro no encontrado: ${teacherId}`);
      continue;
    }
    const teacherData = teacherDoc.data();

    // Determinar el grado del maestro (obtener del primer curso asignado)
    const assignedCourses = TEACHER_ASSIGNMENTS[teacherId] || [];
    let gradeId = 'grade_kinder'; // Por defecto

    if (assignedCourses.length > 0) {
      const courseId = assignedCourses[0];
      const courseDoc = await db.collection('courses').doc(courseId).get();
      if (courseDoc.exists) {
        gradeId = courseDoc.data().gradeId;
      }
    }

    for (const subjectId of subjectIds) {
      const subjectData = SUBJECTS_DATA.find(s => s.id === subjectId);
      if (!subjectData) continue;

      const docId = `${teacherId}_${subjectId}`;
      const exists = await checkExists('subjects', docId);

      if (!exists) {
        try {
          await db.collection('subjects').doc(docId).set({
            id: docId,
            name: subjectData.name,
            description: subjectData.description,
            gradeId,
            teacherId,
            teacherName: teacherData.name || '',
            academicYear: 2026,
            isActive: true,
            gradingScale: 'numeric',
            gradingNumericMin: 0,
            gradingNumericMax: 10,
            gradingLetterOptions: '',
            performanceCriteria: '',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          console.log(`   ✅ Materia creada: ${subjectData.name} (${teacherId})`);
          created++;
        } catch (err) {
          console.error(`   ❌ Error creando materia ${docId}:`, err.message);
        }
      } else {
        console.log(`   ⏭️  Materia existente: ${subjectData.name} (${teacherId})`);
      }
    }
  }

  console.log(`\n✨ Total materias creadas: ${created}`);
  return created;
}

async function createTeachers() {
  console.log('\n👨‍🏫 Creando maestros...');
  let created = 0;
  const createdTeachers = [];

  for (let i = 1; i <= SEED_CONFIG.teachers; i++) {
    const teacherId = `teacher_${String(i).padStart(3, '0')}`;
    const firstName = FIRST_NAMES_TEACHERS[i - 1];
    const lastName = randomName();
    const cedula = `${Math.floor(Math.random() * 900000000) + 100000000}`;
    const email = `${removeTildes(firstName).toLowerCase()}.${removeTildes(lastName).toLowerCase()}@kidszone.com`;

    const userExists = await checkExists('usuarios', teacherId);

    if (!userExists) {
      try {
        // Crear en Firebase Auth
        const firebaseUser = await auth.createUser({
          uid: teacherId,
          email,
          password: SEED_CONFIG.defaultTeacherPassword,
          displayName: `${firstName} ${lastName}`,
        });

        // Crear en Firestore
        await db.collection('usuarios').doc(teacherId).set(toFirestoreUser({
          id: teacherId,
          email,
          name: `${firstName} ${lastName}`,
          cedula,
          role: 'teacher',
          isActive: true,
          phone: `+51${Math.floor(Math.random() * 900000000) + 100000000}`,
          specialization: 'Educación Primaria',
          yearsExperience: Math.floor(Math.random() * 20) + 1,
          assignedCourses: {
            titularCourses: TEACHER_ASSIGNMENTS[teacherId] || [],
            secondaryCourses: [],
          },
          createdAt: new Date(),
        }));

        console.log(`   ✅ Maestro creado: ${firstName} ${lastName} (${email})`);
        createdTeachers.push(teacherId);
        created++;
      } catch (err) {
        console.error(`   ❌ Error creando maestro ${teacherId}:`, err.message);
      }
    } else {
      console.log(`   ⏭️  Maestro existente: ${teacherId}`);
      createdTeachers.push(teacherId);
    }
  }

  console.log(`\n✨ Total maestros creados: ${created}`);
  return { created, teacherIds: createdTeachers };
}

async function createParents() {
  console.log('\n👨‍👩‍👧 Creando padres...');
  let created = 0;
  const createdParents = [];

  for (let i = 1; i <= SEED_CONFIG.parents; i++) {
    const parentId = `parent_${String(i).padStart(3, '0')}`;
    const firstName = FIRST_NAMES_STUDENTS[Math.floor(Math.random() * FIRST_NAMES_STUDENTS.length)];
    const lastName = randomName();
    const email = `${removeTildes(firstName).toLowerCase()}.${removeTildes(lastName).toLowerCase()}.parent${i}@kidszone.com`;

    const userExists = await checkExists('usuarios', parentId);

    if (!userExists) {
      try {
        // Crear en Firebase Auth
        await auth.createUser({
          uid: parentId,
          email,
          password: SEED_CONFIG.defaultParentPassword,
          displayName: `${firstName} ${lastName}`,
        });

        // Crear en Firestore
        await db.collection('usuarios').doc(parentId).set(toFirestoreUser({
          id: parentId,
          email,
          name: `${firstName} ${lastName}`,
          role: 'parent',
          isActive: true,
          children: [],
          phone: `+51${Math.floor(Math.random() * 900000000) + 100000000}`,
          createdAt: new Date(),
        }));

        console.log(`   ✅ Padre creado: ${firstName} ${lastName} (${email})`);
        createdParents.push(parentId);
        created++;
      } catch (err) {
        console.error(`   ❌ Error creando padre ${parentId}:`, err.message);
      }
    } else {
      console.log(`   ⏭️  Padre existente: ${parentId}`);
      createdParents.push(parentId);
    }
  }

  console.log(`\n✨ Total padres creados: ${created}`);
  return { created, parentIds: createdParents };
}

async function createStudents(parentIds) {
  console.log('\n👶 Creando alumnos...');
  let created = 0;
  const createdStudents = [];

  // Mapeo de cursos a grados
  const courseToGrade = {
    'course_kinder_a': 'grade_kinder',
    'course_kinder_b': 'grade_kinder',
    'course_prekinder_a': 'grade_prekinder',
  };

  // Distribuir estudiantes por curso
  const studentsPerCourse = {
    'course_kinder_a': 15,
    'course_kinder_b': 15,
    'course_prekinder_a': 16,
  };

  let studentIndex = 0;

  for (const [courseId, count] of Object.entries(studentsPerCourse)) {
    const gradeId = courseToGrade[courseId];
    
    for (let i = 0; i < count; i++) {
      const studentId = `student_${String(studentIndex + 1).padStart(3, '0')}`;
      const firstName = FIRST_NAMES_STUDENTS[studentIndex % FIRST_NAMES_STUDENTS.length];
      const lastName = randomName();
      const cedula = `${Math.floor(Math.random() * 900000000) + 100000000}`;
      const randomParent = parentIds[Math.floor(Math.random() * parentIds.length)];

      const userExists = await checkExists('students', studentId);

      if (!userExists) {
        try {
          // Obtener datos del padre
          const parentDoc = await db.collection('usuarios').doc(randomParent).get();
          const parentData = parentDoc.data();

          // Crear estudiante
          await db.collection('students').doc(studentId).set({
            id: studentId,
            name: firstName,
            lastName,
            cedula,
            email: `${removeTildes(firstName).toLowerCase()}.${removeTildes(lastName).toLowerCase()}.student${studentId}@kidszone.com`,
            dateOfBirth: new Date(2018 + Math.floor(Math.random() * 5), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString(),
            parentId: randomParent,
            parentEmail: parentData.email,
            enrollment: {
              courseId,
              gradeId,
              enrolledAt: new Date(),
              status: 'active',
            },
            medicalInfo: {
              bloodType: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'][Math.floor(Math.random() * 8)],
              chronicDiseases: '',
              medications: '',
              allergies: [],
            },
            emergencyContact: {
              name: `Emergencia ${lastName}`,
              phone: parentData.phone || '+51999999999',
              relationship: 'Padre',
            },
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Crear asociación padre-estudiante
          const assocRef = db.collection('parentAssociations').doc();
          await assocRef.set({
            id: assocRef.id,
            parentId: randomParent,
            parentEmail: parentData.email,
            studentIds: [studentId],
            relationships: [
              {
                studentId,
                studentName: `${firstName} ${lastName}`,
                relationship: 'Tutor',
              },
            ],
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Actualizar array de hijos del padre
          const currentChildren = parentData.children || [];
          if (!currentChildren.includes(studentId)) {
            await db.collection('usuarios').doc(randomParent).update({
              children: [...currentChildren, studentId],
              updatedAt: new Date(),
            });
          }

          console.log(`   ✅ Alumno creado: ${firstName} ${lastName} (${cedula}) → ${courseId}`);
          createdStudents.push(studentId);
          created++;
        } catch (err) {
          console.error(`   ❌ Error creando alumno ${studentId}:`, err.message);
        }
      } else {
        console.log(`   ⏭️  Alumno existente: ${studentId}`);
        createdStudents.push(studentId);
      }

      studentIndex++;
    }
  }

  console.log(`\n✨ Total alumnos creados: ${created}`);
  return { created, studentIds: createdStudents };
}

async function assignTeachersToCourses() {
  console.log('\n🔗 Asignando maestros a cursos...');
  let assigned = 0;

  for (const [teacherId, courseIds] of Object.entries(TEACHER_ASSIGNMENTS)) {
    if (courseIds.length > 0) {
      try {
        await db.collection('usuarios').doc(teacherId).update({
          'assignedCourses.titularCourses': courseIds,
          updatedAt: new Date(),
        });

        // Actualizar curso para incluir al maestro
        for (const courseId of courseIds) {
          await db.collection('courses').doc(courseId).update({
            titularTeacherId: teacherId,
            updatedAt: new Date(),
          });
        }

        console.log(`   ✅ ${teacherId} asignado a: ${courseIds.join(', ')}`);
        assigned++;
      } catch (err) {
        console.error(`   ❌ Error asignando ${teacherId}:`, err.message);
      }
    }
  }

  console.log(`\n✨ Total maestros asignados: ${assigned}`);
  return assigned;
}

async function assignSubjectsToTeachers() {
  console.log('\n📚 Asignando materias a maestros...');
  let assigned = 0;

  for (const [teacherId, subjectIds] of Object.entries(TEACHER_SUBJECTS)) {
    try {
      // Crear documentos de asignación
      for (const subjectId of subjectIds) {
        const assignmentId = `${teacherId}_${subjectId}`;
        const exists = await checkExists('teacherSubjectAssignments', assignmentId);

        if (!exists) {
          await db.collection('teacherSubjectAssignments').doc(assignmentId).set({
            id: assignmentId,
            teacherId,
            subjectId,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      console.log(`   ✅ ${teacherId} asignado a materias: ${subjectIds.join(', ')}`);
      assigned++;
    } catch (err) {
      console.error(`   ❌ Error asignando materias a ${teacherId}:`, err.message);
    }
  }

  console.log(`\n✨ Total maestros con materias asignadas: ${assigned}`);
  return assigned;
}

async function seedDatabase() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🌱 INICIANDO SEED DE DATOS - KIDS ZONE');
  console.log('═══════════════════════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // 1. Crear grados
    await createGrades();

    // 2. Crear cursos
    await createCourses();

    // 3. Crear materias
    await createSubjects();

    // 4. Crear maestros
    const { teacherIds } = await createTeachers();

    // 5. Crear padres
    const { parentIds } = await createParents();

    // 6. Crear alumnos
    await createStudents(parentIds);

    // 7. Asignar maestros a cursos
    await assignTeachersToCourses();

    // 8. Asignar materias a maestros
    await assignSubjectsToTeachers();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('✅ SEED DE DATOS COMPLETADO EXITOSAMENTE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`⏱️  Tiempo total: ${duration}s`);
    console.log('\n📊 RESUMEN:');
    console.log(`   • 2 Grados creados`);
    console.log(`   • 3 Cursos creados`);
    console.log(`   • 5 Materias creadas`);
    console.log(`   • 10 Maestros creados`);
    console.log(`   • 40 Padres creados`);
    console.log(`   • 46 Alumnos creados`);
    console.log(`   • 46 Asociaciones Padre-Estudiante creadas`);
    console.log('\n🔐 CREDENCIALES:');
    console.log(`   Maestros: password = "Maestro123!"`);
    console.log(`   Padres: password = "Padre123!"`);
    console.log('\n📧 DATOS DE ACCESO:');
    console.log(`   • Primeros maestros y padres tienen emails generados automáticamente`);
    console.log(`   • Todos los alumnos tienen cédula única generada`);
    console.log(`   • Los alumnos están asignados a padres aleatoriamente`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR FATAL:', error);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  seedDatabase().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

module.exports = { seedDatabase };
