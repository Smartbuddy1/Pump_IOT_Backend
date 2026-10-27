const express = require('express');
const router = express.Router();
const { getTelemetryHistory, getDashboardStats } = require('../controllers/analyticsController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect); // Protect analytics routes

router.get('/history', getTelemetryHistory);
router.get('/dashboard-stats', getDashboardStats);

module.exports = router;
