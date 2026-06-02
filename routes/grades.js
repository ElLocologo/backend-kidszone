const express = require('express');
const router = express.Router();
const gradeController = require('../controllers/gradeController');
const { verifyFirebaseToken, verifyAdmin } = require('../middleware/auth');

// Admin: Crear grado
router.post('/', verifyFirebaseToken, verifyAdmin, gradeController.createGrade);

// Todos: Obtener grados
router.get('/', verifyFirebaseToken, gradeController.getGrades);

// Todos: Obtener grado con sus cursos
router.get('/:id', verifyFirebaseToken, gradeController.getGradeWithCourses);

// Admin: Actualizar grado
router.put('/:id', verifyFirebaseToken, verifyAdmin, gradeController.updateGrade);

// Admin: Desactivar grado
router.delete('/:id', verifyFirebaseToken, verifyAdmin, gradeController.deactivateGrade);

module.exports = router;
