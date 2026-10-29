const express = require('express');
const { getMachines, createMachine, updateMachine, deleteMachine } = require('../controllers/machineController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const { machineValidation } = require('../validators/machineValidators');

const router = express.Router();

router.use(protect); // All machine routes require authentication

router.route('/')
  .get(getMachines)
  .post(authorize('Super Admin', 'OMC Admin'), machineValidation, validate, createMachine);

router.route('/:id')
  .put(authorize('Super Admin', 'OMC Admin'), machineValidation, validate, updateMachine)
  .delete(authorize('Super Admin', 'OMC Admin'), deleteMachine);

module.exports = router;
