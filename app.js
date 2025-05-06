/**
 * @fileoverview Main application entry point
 * 
 * This module sets up the Express application, configures middleware,
 * establishes routes, and handles errors. It serves as the central
 * configuration point for the Node.js server.
 * 
 * @module app
 * @requires express
 * @requires cors
 * @requires dotenv
 * @requires body-parser
 * @requires express-useragent
 * @requires winston
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config();
require("./src/config/db");
require("./src/cronJob");
const body_parser = require("body-parser");
const useragent = require("express-useragent");
const winston = require("winston");

/**
 * Express application instance
 * @type {import('express').Application}
 */
let app = express();

// CORS configuration
app.use(cors({ origin: "*" }));

// Body parser configuration
app.use(body_parser.urlencoded({ extended: true, limit: "50mb" }));
app.use(body_parser.json({ extended: true, limit: "50mb" }));

// Import routes and error handling modules
const router = require("./src/routes/http");
const AppError = require("./src/exception/AppError");
const globalError = require("./src/exception/globalError");
const logger = require("./src/config/logger");

// User agent middleware
app.use(useragent.express());

/**
 * Middleware to log all incoming requests
 * @function
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next middleware function
 */
app.all("*", (req, res, next) => {
  console.log(` ${new Date()} ${req.originalUrl}`);
  next();
});

// Apply routes
app.use(router);

/**
 * Root route handler
 * @function
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 */
app.get("/", (req, res) => {
  res.json({
    message: "Server is on 🔥",
  });
});

/**
 * 404 handler for undefined routes
 * @function
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next middleware function
 */
app.all("*", (req, res, next) => {
  next(
    new AppError(`Can't find route ${req.originalUrl} on this Node server`, 404)
  );
});

// Configure winston logger for non-production environments
if (process.env.NODE_ENV !== "pro") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

// Apply global error handling middleware
app.use(globalError);

module.exports = app;
