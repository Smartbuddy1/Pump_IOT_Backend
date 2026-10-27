const { body } = require('express-validator');

exports.alertValidation = [
  body('machine_id')
    .notEmpty().withMessage('Machine ID is required')
    .isInt().withMessage('Machine ID must be an integer'),
  body('severity')
    .notEmpty().withMessage('Severity is required')
    .isIn(['Info', 'Warning', 'Critical']).withMessage('Invalid severity level'),
  body('message')
    .notEmpty().withMessage('Message is required')
    .trim()
    .isLength({ max: 255 }).withMessage('Message must not exceed 255 characters')
];
