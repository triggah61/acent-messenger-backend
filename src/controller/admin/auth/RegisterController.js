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
const SMS = require("../../../config/sms");
const AppError = require("../../../exception/AppError");
const catchAsync = require("../../../exception/catchAsync");
const OtpVerification = require("../../../model/OtpVerification");
const User = require("../../../model/User");
const { generateWebToken } = require("../../../services/AuthService");
const { createOtp } = require("../../../services/OtpVerificationService");
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
exports.registerRequest = catchAsync(async (req, res) => {
  await SimpleValidator(req.body, {
    phone: "required|min:10",
    password: "required|min:6",
    firstName: "required",
  });

  const { phone, password, firstName, lastName } = req.body;

  let otp = await createOtp(null, "USER_REGISTER", "phone", phone, req.body);

  res.json({
    message: "OTP sent to the phone number",
    data: { traceId: otp.traceId },
  });
});

exports.verifyRegistration = catchAsync(async (req, res) => {
  let { trace } = req.body;
  let { firstName, lastName, phone, password } = trace.data;
  let user = await User.create({
    firstName,
    lastName,
    phone,
    password,
    status: "activated",
  });
  let webToken = await generateWebToken(user);

  res.json({
    message: "Registration completed successfully",
    data: { token: webToken },
  });
});
