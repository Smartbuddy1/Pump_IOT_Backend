const express = require('express');
const { 
  submitFeedback, 
  getFeedbacks, 
  getPublicMachineDetails 
} = require('../controllers/feedbackController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

const rateLimit = require('express-rate-limit');

// Anti-spam limiter for public feedback submissions: max 10 per 10 minutes per IP
const feedbackLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many feedback submissions. Please try again after a few minutes.' }
});

// Limiter for public QR machine lookup: max 30 per 5 minutes per IP
const qrLookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many QR scans. Please try again shortly.' }
});

// Public routes for customer QR scan
router.post('/public', feedbackLimiter, submitFeedback);
router.get('/machine/:machineId', qrLookupLimiter, getPublicMachineDetails);

// Protected routes for dashboard viewing
router.get('/', protect, getFeedbacks);

module.exports = router;
