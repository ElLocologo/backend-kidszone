const express = require('express');
const reportCardsController = require('../controllers/reportCardsController');
const { verifyFirebaseToken, verifyAdmin, verifyTeacher, verifyParent } = require('../middleware/auth');

const router = express.Router();

router.get(
  '/teacher/markbook',
  verifyFirebaseToken,
  verifyTeacher,
  reportCardsController.getTeacherMarkbookContext
);
router.post(
  '/teacher/markbook',
  verifyFirebaseToken,
  verifyTeacher,
  reportCardsController.saveTeacherMarkbookDrafts
);
router.post(
  '/teacher/markbook/submit',
  verifyFirebaseToken,
  verifyTeacher,
  reportCardsController.submitTeacherMarkbook
);
router.post(
  '/teacher/correction-requests',
  verifyFirebaseToken,
  verifyTeacher,
  reportCardsController.createCorrectionRequest
);
router.get(
  '/teacher/correction-requests',
  verifyFirebaseToken,
  verifyTeacher,
  reportCardsController.listTeacherCorrectionRequests
);

// Nuevas rutas para director de curso
router.get(
  '/teacher/director-courses',
  verifyFirebaseToken,
  verifyTeacher,
  reportCardsController.getTeacherDirectorCourses
);
router.get(
  '/teacher/course/:courseId/reports',
  verifyFirebaseToken,
  verifyTeacher,
  reportCardsController.getTeacherCourseReportCards
);

router.get(
  '/admin/correction-requests',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.listAdminCorrectionRequests
);
router.get(
  '/admin/reports',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.listAdminReports
);
router.get(
  '/admin/reports/search',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.searchReportCards
);
router.post(
  '/admin/correction-requests/:requestId/resolve',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.resolveCorrectionRequest
);
router.patch(
  '/admin/markbook/:entryId',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.adminUpdateMarkbook
);
router.post(
  '/admin/reports/generate',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.generateReportCard
);
router.post(
  '/admin/reports/:reportId/publish',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.publishReportCard
);
router.post(
  '/admin/reports/:reportId/send-to-parents',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.sendReportCardToParents
);
router.get(
  '/admin/reports/student/:studentId',
  verifyFirebaseToken,
  verifyAdmin,
  reportCardsController.getAdminReportForStudent
);

router.get(
  '/parent/:studentId',
  verifyFirebaseToken,
  verifyParent,
  reportCardsController.getParentReportCard
);

module.exports = router;
