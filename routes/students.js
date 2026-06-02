const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { verifyFirebaseToken, verifyAdmin, verifyTeacher } = require('../middleware/auth');

// Admin: Crear estudiante con matriculación obligatoria
router.post('/', verifyFirebaseToken, verifyAdmin, studentController.createStudent);

// Todos: Obtener estudiantes de un curso
router.get('/', verifyFirebaseToken, studentController.getStudentsByCourse);

// Padre: Obtener estudiantes vinculados (antes de /:id para no capturar "parent")
router.get('/parent/:parentId', verifyFirebaseToken, studentController.getStudentsByParent);

// Docente/Padre: Obtener estudiante por ID
router.get('/:id', verifyFirebaseToken, studentController.getStudentById);

// Admin: Transferir estudiante a otro curso
router.patch('/:id/transfer', verifyFirebaseToken, verifyAdmin, studentController.transferStudent);

// Admin: Vincular padre por email (estudiante sin parentId)
router.patch('/:id/link-parent', verifyFirebaseToken, verifyAdmin, studentController.linkStudentToParent);

// Admin: Actualizar información del estudiante
router.patch('/:id', verifyFirebaseToken, verifyAdmin, studentController.updateStudent);

// Admin: Desactivar estudiante
router.patch('/:id/deactivate', verifyFirebaseToken, verifyAdmin, studentController.deactivateStudent);

module.exports = router;
