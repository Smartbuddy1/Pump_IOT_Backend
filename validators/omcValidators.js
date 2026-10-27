const { body } = require('express-validator');

exports.omcValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('OMC Name is required')
    .isLength({ max: 100 }).withMessage('OMC Name must not exceed 100 characters'),
  body('location')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Location must not exceed 255 characters')
];
