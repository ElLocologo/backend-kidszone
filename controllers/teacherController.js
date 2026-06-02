const { db } = require('../config/firebase');

/**
 * Cursos donde el docente es titular o docente secundario
 * GET /api/teacher/courses
 */
exports.getMyCourses = async (req, res) => {
  try {
    const uid = req.user.uid;

    const titularSnap = await db.collection('courses')
      .where('titularTeacherId', '==', uid)
      .get();

    const secondarySnap = await db.collection('courses')
      .where('secondaryTeachers', 'array-contains', uid)
      .get();

    const map = new Map();
    titularSnap.forEach((doc) => {
      map.set(doc.id, { id: doc.id, ...doc.data() });
    });
    secondarySnap.forEach((doc) => {
      map.set(doc.id, { id: doc.id, ...doc.data() });
    });

    const courses = Array.from(map.values())
      .filter((c) => c.isActive !== false)
      .sort((a, b) =>
        String(a.gradeName || '').localeCompare(String(b.gradeName || ''))
        || String(a.name || '').localeCompare(String(b.name || ''))
        || String(a.section || '').localeCompare(String(b.section || ''))
      );

    return res.status(200).json({
      count: courses.length,
      courses,
    });
  } catch (error) {
    console.error('[TEACHER MY COURSES] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
