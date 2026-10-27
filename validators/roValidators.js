const { body } = require('express-validator');

exports.roValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('RO Name is required')
    .isLength({ max: 100 }).withMessage('RO Name must not exceed 100 characters'),
  body('omc_id')
    .notEmpty().withMessage('OMC ID is required')
    .isInt().withMessage('OMC ID must be an integer'),
  body('location')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Location must not exceed 255 characters'),
  body('status')
    .optional()
    .isIn(['Active', 'Inactive']).withMessage('Invalid status')
];
