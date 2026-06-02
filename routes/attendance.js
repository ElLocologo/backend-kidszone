const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const { verifyFirebaseToken, verifyTeacher } = require('../middleware/auth');

// Aplicar middleware de autenticación a todas las rutas
router.use(verifyFirebaseToken);
router.use(verifyTeacher);

// Docente: Registrar asistencia
router.post('/', attendanceController.createAttendance);

// Obtener asistencia de un estudiante
router.get('/student/:studentId', attendanceController.getStudentAttendance);

// Docente: Historial de inasistencias del curso (antes que /course/:courseId genérico)
router.get(
  '/course/:courseId/absences',
  attendanceController.getCourseAbsenceHistory
);

// Docente: Obtener asistencias de un curso
router.get('/course/:courseId', attendanceController.getAttendanceByTeacher);

// Obtener asistencias por fecha
router.get('/date/:date', attendanceController.getAttendanceByDate);

// Docente: Actualizar registro de asistencia
router.patch('/:id', attendanceController.updateAttendance);

// Docente: Eliminar registro de asistencia
router.delete('/:id', attendanceController.deleteAttendance);

module.exports = router;
