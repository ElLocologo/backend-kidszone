const express = require('express');
const academicController = require('../controllers/academicController');
const { verifyFirebaseToken, verifyAdmin, verifyTeacher, verifyParent } = require('../middleware/auth');

const router = express.Router();

router.post('/subjects', verifyFirebaseToken, verifyAdmin, academicController.createSubject);
router.get('/subjects', verifyFirebaseToken, academicController.listSubjects);
router.patch('/subjects/:subjectId', verifyFirebaseToken, verifyAdmin, academicController.updateSubject);
router.delete('/subjects/:subjectId', verifyFirebaseToken, verifyAdmin, academicController.deleteSubject);

router.post('/slots', verifyFirebaseToken, verifyAdmin, academicController.createSlot);
router.get('/slots/course/:courseId', verifyFirebaseToken, verifyAdmin, academicController.listSlotsForCourse);
router.delete('/slots/:slotId', verifyFirebaseToken, verifyAdmin, academicController.deleteSlot);

router.get('/timetable/teacher', verifyFirebaseToken, verifyTeacher, academicController.getTeacherTimetable);
router.get(
  '/timetable/parent/:studentId',
  verifyFirebaseToken,
  verifyParent,
  academicController.getParentTimetable
);

module.exports = router;
