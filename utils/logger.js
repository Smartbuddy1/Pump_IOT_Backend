const winston = require('winston');
const path = require('path');

// Define your severity levels. 
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define different colors for each level. 
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};
winston.addColors(colors);

// Choose the aspect of your log customizing the log format.
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define which transports the logger must use to print out messages.
const transports = [
  // Allow the use of the console to print the messages
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true })
    )
  }),
  // Allow printing all the error level messages inside the error.log file
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/error.log'),
    level: 'error',
  }),
  // Allow printing all the error message inside the all.log file
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/all.log'),
  }),
];

// Create the logger instance that has to be exported
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
  levels,
  format,
  transports,
});

module.exports = logger;
