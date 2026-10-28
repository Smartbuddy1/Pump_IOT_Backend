const { body } = require('express-validator');

exports.machineValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Machine Name is required')
    .isLength({ max: 100 }).withMessage('Machine Name must not exceed 100 characters'),
  body('ro_id')
    .notEmpty().withMessage('RO ID is required')
    .isInt().withMessage('RO ID must be an integer'),
  body('type')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Machine Type must not exceed 50 characters'),
  body('status')
    .optional()
    .isIn(['ACTIVE', 'Active', 'INACTIVE', 'Inactive', 'Running', 'Offline', 'Maintenance', 'Warning', 'Critical', 'ONLINE', 'OPERATIONAL']).withMessage('Invalid machine status'),
  body('health_score')
    .optional()
    .isInt({ min: 0, max: 100 }).withMessage('Health score must be between 0 and 100'),
  body('last_maintenance')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('Last maintenance must be a valid date')
];
