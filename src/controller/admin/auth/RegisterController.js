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

exports.loginWithEmail = catchAsync(async (req, res) => {
  await SimpleValidator(req.body, {
    email: "required|email",
    password: "required",
  });

  const { email, password } = req.body;

  // Find user by email
  const user = await User.findOne({
    email: email.toLowerCase(),
    status: { $ne: "deleted" },
  });

  if (!user) {
    throw new AppError("Invalid email or password", 401);
  }

  if (user.status === "blocked") {
    throw new AppError("User account is blocked", 400);
  }

  if (user.status === "pending") {
    throw new AppError(
      "User account is not activated. Please verify your email first.",
      400
    );
  }

  // Check password
  if (
    !user.password ||
    !(await user.correctPassword(password, user.password))
  ) {
    throw new AppError("Invalid email or password", 401);
  }

  const webToken = await generateWebToken(user);

  return res.json({
    message: "Login successful",
    data: { token: webToken },
  });

  // Send OTP for two-factor authentication
  let otp = await createOtp(
    user._id,
    "USER_LOGIN",
    "email",
    email.toLowerCase(),
    {
      email: email.toLowerCase(),
      userId: user._id,
    }
  );

  return res.status(200).json({
    status: "otp_required",
    message: "Verification code sent to your email",
    data: { traceId: otp.traceId },
  });
});

exports.verifyEmailLogin = catchAsync(async (req, res) => {
  let { trace, fcmToken, platform, deviceId } = req.body;
  let { email, userId } = trace.data;

  let user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  console.log(user);
  // Generate the final JWT token
  const webToken = await generateWebToken(user);

  res.json({
    message: "Login successful",
    data: { token: webToken },
  });
});
