const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { verifyFirebaseToken, verifyAdmin } = require('../middleware/auth');

// Admin: Crear curso
router.post('/', verifyFirebaseToken, verifyAdmin, courseController.createCourse);

// Todos: Obtener todos los cursos o cursos de un grado específico
router.get('/', verifyFirebaseToken, courseController.getCoursesByGrade);

// Admin/Docente: Obtener curso con estudiantes
router.get('/:id/students', verifyFirebaseToken, courseController.getCourseWithStudents);

// Admin: Asignar docente adicional
router.post('/:id/secondary-teachers', verifyFirebaseToken, verifyAdmin, courseController.addSecondaryTeacher);

// Admin: Actualizar curso
router.patch('/:id', verifyFirebaseToken, verifyAdmin, courseController.updateCourse);

module.exports = router;
