
const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');


const levels = {
  fatal: 0, 
  error: 1, 
  warn: 2,  
  info: 3,  
  debug: 4, 
  trace: 5  
};

const colors = {
  fatal: 'bold red',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'cyan',
  trace: 'gray'
};
winston.addColors(colors);







function nivelSegunEntorno() {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}






const formatoArchivo = winston.format.combine(
  winston.format.timestamp(),        
  winston.format.errors({ stack: true }),
  winston.format.json()              
);


const formatoConsola = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module: mod, ...meta }) => {
    const modulo = mod ? `[${mod}]` : '';
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} ${level} ${modulo} ${message} ${metaStr}`.trim();
  })
);




const logsDir = path.join(__dirname, '..', 'logs');

const transports = [
  
  
  new winston.transports.Console({
    format: formatoConsola
  }),

  
  
  new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d', 
    format: formatoArchivo
  }),

  
  
  
  new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '30d', 
    format: formatoArchivo
  })
];




const logger = winston.createLogger({
  levels,
  level: nivelSegunEntorno(),
  format: formatoArchivo,
  transports,
  exitOnError: false,
  exceptionHandlers: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: formatoArchivo
    })
  ],
  rejectionHandlers: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: formatoArchivo
    })
  ]
});








logger.child = function (moduleName) {
  return winston.createLogger({
    levels,
    level: logger.level,
    format: formatoArchivo,
    transports,
    defaultMeta: { module: moduleName }
  });
};

module.exports = logger;
