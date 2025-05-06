/**
 * @fileoverview Register Controller
 *
 * This module provides controller functions for user registration,
 * including initial registration and OTP verification.
 *
 * @module RegisterController
 * @requires ../../../exception/AppError
 * @requires ../../../exception/catchAsync
 * @requires ../../../model/User
 * @requires ../../../services/AuthService
 * @requires ../../../validator/simpleValidator
 * @requires jsonwebtoken
 */

const Email = require("../../../config/email");
const AppError = require("../../../exception/AppError");
const catchAsync = require("../../../exception/catchAsync");
const User = require("../../../model/User");
const { generateWebToken } = require("../../../services/AuthService");
const SimpleValidator = require("../../../validator/simpleValidator");
const jwt = require("jsonwebtoken");

/**
 * Handles initial user registration
 *
 * This function creates a new user and sends an OTP to their email
 * for verification.
 *
 * @function register
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body
 * @param {string} req.body.email - User's email
 * @param {string} req.body.password - User's password
 * @param {string} req.body.firstName - User's full firstName
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with registration result
 * @throws {AppError} If validation fails or registration is unsuccessful
 */
exports.register = catchAsync(async (req, res) => {
  await SimpleValidator(req.body, {
    email: "required|email",
    password: "required|min:6",
    firstName: "required",
  });

  const { email, password, firstName, lastName } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    if (existingUser.status === "pending") {
      await User.findByIdAndDelete(existingUser._id);
    } else {
      throw new AppError("Email already registered", 422);
    }
  }

  // Create user with pending status
  const user = await User.create({
    email,
    password,
    firstName,
    lastName,
    status: "activated",
    roleType: "user",
  });

  // Generate the final JWT token
  const webToken = await generateWebToken(user);
  res.json({
    message: "Registration completed successfully",
    data: { token: webToken },
  });
});