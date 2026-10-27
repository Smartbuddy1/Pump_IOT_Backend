const express = require('express');
const { getOMCs, createOMC, updateOMC, deleteOMC } = require('../controllers/omcController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const { omcValidation } = require('../validators/omcValidators');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getOMCs)
  .post(authorize('Super Admin'), omcValidation, validate, createOMC);

router.route('/:id')
  .put(authorize('Super Admin', 'OMC Admin'), omcValidation, validate, updateOMC)
  .delete(authorize('Super Admin'), deleteOMC);

module.exports = router;
