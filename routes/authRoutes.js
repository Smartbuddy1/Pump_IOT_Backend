const express = require('express');
const rateLimit = require('express-rate-limit');
const { register, login, refreshToken, logout } = require('../controllers/authController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const { registerValidation, loginValidation } = require('../validators/authValidators');

const router = express.Router();

// Brute-force protection for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Relaxed limit to prevent locking during development and testing
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again later' }
});

router.post('/login', loginLimiter, loginValidation, validate, login);
router.get('/refresh', refreshToken);
router.post('/logout', logout);

// Only Super Admin can register new users in an Enterprise setup
router.post('/register', protect, authorize('Super Admin'), registerValidation, validate, register);

module.exports = router;
