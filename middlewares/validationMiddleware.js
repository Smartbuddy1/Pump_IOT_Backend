const { validationResult } = require('express-validator');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

// Middleware to format express-validator errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  
  // Format errors array into a cleaner object
  const extractedErrors = [];
  errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

  logger.warn(`Validation failed on ${req.originalUrl}`, extractedErrors);

  return res.status(422).json(
    new ApiResponse(422, extractedErrors, 'Invalid input data')
  );
};

module.exports = {
  validate,
};
