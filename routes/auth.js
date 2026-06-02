const express = require('express');
const authController = require('../controllers/authController');
const { verifyFirebaseToken } = require('../middleware/auth');

const router = express.Router();

// Rutas públicas
router.post('/login', authController.login);
router.post('/register', authController.registerParent);

// Rutas autenticadas
router.get('/me', verifyFirebaseToken, authController.getCurrentUser);

module.exports = router;
