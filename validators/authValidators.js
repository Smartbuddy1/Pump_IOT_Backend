const { body } = require('express-validator');

exports.registerValidation = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 50 }).withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('role')
    .notEmpty().withMessage('Role is required')
    .isIn(['Super Admin', 'OMC Admin', 'RO Manager', 'Operator']).withMessage('Invalid role provided')
];

exports.loginValidation = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required'),
  body('password')
    .notEmpty().withMessage('Password is required')
];
