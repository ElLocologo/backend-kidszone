const express = require('express');
const scheduleController = require('../controllers/scheduleController');
const billingController = require('../controllers/billingController');
const notificationController = require('../controllers/notificationController');
const { verifyFirebaseToken, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

// RUTAS DE HORARIOS (Admin y Teachers)
router.post('/schedules', verifyFirebaseToken, scheduleController.createSchedule);
router.get('/schedules/month', verifyFirebaseToken, scheduleController.getMonthlySchedule);
router.get('/schedules/today', verifyFirebaseToken, scheduleController.getTodaySchedule);
router.put('/schedules/:scheduleId', verifyFirebaseToken, scheduleController.updateSchedule);
router.delete('/schedules/:scheduleId', verifyFirebaseToken, scheduleController.deleteSchedule);

// RUTAS DE FACTURACIÓN (Admin y Padres)
router.post('/charges', verifyFirebaseToken, verifyAdmin, billingController.createAdditionalCharge);
router.get('/student/:studentId/charges', verifyFirebaseToken, billingController.getStudentCharges);
router.post('/billing/generate', verifyFirebaseToken, verifyAdmin, billingController.generateMonthlyBilling);
router.get('/student/:studentId/billing', verifyFirebaseToken, billingController.getStudentBilling);
router.get('/billing/details', verifyFirebaseToken, verifyAdmin, billingController.getBillingWithDetails);
router.get('/billing/:billingId', verifyFirebaseToken, billingController.getBillingById);
router.post('/payments', verifyFirebaseToken, verifyAdmin, billingController.recordPayment);
router.patch('/billing/:billingId/status/admin', verifyFirebaseToken, verifyAdmin, billingController.updateBillingStatus);
router.get('/billing/report', verifyFirebaseToken, verifyAdmin, billingController.getBillingReport);

// RUTAS DE NOTIFICACIONES
router.post('/notifications', verifyFirebaseToken, notificationController.createNotification);
router.get('/notifications', verifyFirebaseToken, notificationController.getUserNotifications);
router.put('/notifications/:notificationId/read', verifyFirebaseToken, notificationController.markAsRead);
router.put('/notifications/read-all', verifyFirebaseToken, notificationController.markAllAsRead);
router.get('/notifications/unread/count', verifyFirebaseToken, notificationController.getUnreadCount);
router.delete('/notifications/:notificationId', verifyFirebaseToken, notificationController.deleteNotification);
router.post('/notifications/bulk', verifyFirebaseToken, verifyAdmin, notificationController.sendBulkNotification);

module.exports = router;
