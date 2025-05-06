const winston = require("winston");

// Define your logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    // - Write all logs with level `error` and below to `error.log`
    new winston.transports.File({ filename: "error.log", level: "error" }),
    // - Write all logs with level `info` and below to `combined.log`
    // new winston.transports.File({ filename: "combined.log" }),
  ],
});

module.exports = logger;
