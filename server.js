const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const teacherRoutes = require('./routes/teacher');
const servicesRoutes = require('./routes/services');
const gradesRoutes = require('./routes/grades');
const coursesRoutes = require('./routes/courses');
const attendanceRoutes = require('./routes/attendance');
const studentsRoutes = require('./routes/students');
const academicRoutes = require('./routes/academic');
const reportCardsRoutes = require('./routes/reportCards');

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/grades', gradesRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/academic', academicRoutes);
app.use('/api/report-cards', reportCardsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server running' });
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});
