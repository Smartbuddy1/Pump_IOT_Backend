const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Only log stack traces for actual server errors (500+), ignore routine 404 bot scanner probes
  if (statusCode >= 500) {
    console.error(`[SERVER ERROR] ${err.stack || err.message}`);
  } else if (statusCode !== 404) {
    console.warn(`[WARN ${statusCode}] ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

module.exports = errorHandler;
