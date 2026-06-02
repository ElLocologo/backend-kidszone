const express = require('express');
const adminController = require('../controllers/adminController');
const { verifyFirebaseToken, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

// Aplicar middleware de autenticación y verificación de admin a todas las rutas
router.use(verifyFirebaseToken);
router.use(verifyAdmin);

// Rutas para maestros
router.post('/teachers', adminController.createTeacher);
router.get('/teachers', adminController.getAllTeachers);
router.patch('/teachers/:id', adminController.updateTeacher);
router.post('/teachers/:id/reset-password', adminController.resetTeacherPassword);

// Rutas para estudiantes
router.post('/students', adminController.createStudent);
router.get('/students', adminController.getAllStudents);

// Rutas para padres
router.post('/parents', adminController.createParentAccount);
router.get('/parents', adminController.getAllParents);
router.patch('/parents/:id', adminController.updateParent);
router.post('/parents/:id/reset-password', adminController.resetParentPassword);

module.exports = router;
