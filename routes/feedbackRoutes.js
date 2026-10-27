const express = require('express');
const { 
  submitFeedback, 
  getFeedbacks, 
  getPublicMachineDetails 
} = require('../controllers/feedbackController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

// Public routes for customer QR scan
router.post('/public', submitFeedback);
router.get('/machine/:machineId', getPublicMachineDetails);

// Protected routes for dashboard viewing
router.get('/', protect, getFeedbacks);

module.exports = router;
