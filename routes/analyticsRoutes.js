const express = require('express');
const router = express.Router();
const { getTelemetryHistory, getDashboardStats, getLiveReadings, getDailySensorReports } = require('../controllers/analyticsController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect); // Protect analytics routes

router.get('/history', getTelemetryHistory);
router.get('/dashboard-stats', getDashboardStats);
router.get('/readings', getLiveReadings);
router.get('/sensor-reports', getDailySensorReports);

module.exports = router;
