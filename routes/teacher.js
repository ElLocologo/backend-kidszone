const express = require('express');
const teacherController = require('../controllers/teacherController');
const attendanceController = require('../controllers/attendanceController');
const { verifyFirebaseToken, verifyTeacher } = require('../middleware/auth');

const router = express.Router();

// Aplicar middleware de autenticación y verificación de docente a todas las rutas
router.use(verifyFirebaseToken);
router.use(verifyTeacher);

// Cursos asignados al docente
router.get('/courses', teacherController.getMyCourses);

// Rutas de asistencia (delegadas a attendanceController)
router.post('/attendance', attendanceController.createAttendance);
router.get('/attendance/student/:studentId', attendanceController.getStudentAttendance);
router.get('/attendance/date/:date', attendanceController.getAttendanceByDate);

module.exports = router;
