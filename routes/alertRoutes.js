const express = require('express');
const { getAlerts, createAlert, updateAlert, deleteAlert } = require('../controllers/alertController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect); // All alert routes require authentication

const { validate } = require('../middlewares/validationMiddleware');
const { alertValidation } = require('../validators/alertValidators');

router.route('/')
  .get(getAlerts)
  .post(alertValidation, validate, createAlert); // In a real IoT setup, this might be a webhook from the device

router.route('/:id')
  .put(updateAlert)
  .delete(authorize('Super Admin'), deleteAlert);

module.exports = router;
