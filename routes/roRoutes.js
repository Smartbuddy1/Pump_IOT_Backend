const express = require('express');
const { getROs, createRO, updateRO, deleteRO } = require('../controllers/roController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const { roValidation } = require('../validators/roValidators');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getROs)
  .post(authorize('Super Admin', 'OMC Admin'), roValidation, validate, createRO);

router.route('/:id')
  .put(authorize('Super Admin', 'OMC Admin', 'RO Manager'), roValidation, validate, updateRO)
  .delete(authorize('Super Admin', 'OMC Admin'), deleteRO);

module.exports = router;
