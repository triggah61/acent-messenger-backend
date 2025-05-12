/**
 * @fileoverview Login Controller
 *
 * This module provides controller functions for user authentication,
 * including login and two-factor authentication (2FA) verification.
 *
 * @module LoginController
 * @requires ../../../exception/AppError
 * @requires ../../../exception/catchAsync
 * @requires ../../../model/User
 * @requires ../../../services/AuthService
 * @requires ../../../validator/simpleValidator
 * @requires jsonwebtoken
 * @requires speakeasy
 */

const AppError = require("../../../exception/AppError");
const catchAsync = require("../../../exception/catchAsync");
const User = require("../../../model/User");
const { generateWebToken } = require("../../../services/AuthService");
const SimpleValidator = require("../../../validator/simpleValidator");
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const {
  createOtp,
  resendOtp,
} = require("../../../services/OtpVerificationService");

/**
 * Handles user login
 *
 * This function authenticates a user based on their email and password.
 * If 2FA is enabled, it returns a temporary token for OTP verification.
 *
 * @function login
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body
 * @param {string} req.body.email - User's email
 * @param {string} req.body.password - User's password
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with authentication result
 * @throws {AppError} If validation fails or authentication is unsuccessful
 */
exports.login = catchAsync(async (req, res) => {
  await SimpleValidator(req.body, {
    phone: "required",
    dialCode: "required",
    // password: "required",
  });
  const { phone, dialCode } = req.body;

  // 1. Validate Email and Password
  const user = await User.findOne({
    phone,
    status: { $ne: "deleted" },
  });

  if (user && user.status == "blocked") {
    throw new AppError("User is blocked", 400);
  }
  // if (!user) {
  //   return res.status(422).json({ message: "Invalid phone number entered" });
  // }

  // const isPasswordCorrect = await user.correctPassword(password, user.password);
  // if (!isPasswordCorrect) {
  //   return res.status(422).json({ message: "Invalid phone or password" });
  // }

  // if (true) {
  //   // Generate the final JWT token
  //   const webToken = await generateWebToken(user);

  //   return res.status(200).json({
  //     message: "Login successful",
  //     data: { token: webToken },
  //   });
  // }

  let otp = await createOtp(user?._id ?? null, "USER_LOGIN", "phone", phone, {
    // userId: user._id,
    phone: phone,
    dialCode: dialCode,
  });

  return res.status(200).json({
    status: "otp_required",
    message: "OTP is required",
    data: { traceId: otp.traceId },
  });
});

/**
 * Verifies the OTP for two-factor authentication
 *
 * This function validates the OTP provided by the user for 2FA login.
 *
 * @function verifyLoginWithOTP
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with authentication result
 * @throws {AppError} If validation fails or OTP verification is unsuccessful
 */
exports.verifyLoginWithOTP = catchAsync(async (req, res) => {
  let { trace } = req.body;
  let { phone, dialCode } = trace.data;

  let user = await User.findOne({ phone });
  if (!user) {
    user = await User.create({ phone, dialCode, status: "activated" });
  }

  // Generate the final JWT token
  const webToken = await generateWebToken(user);

  res.json({
    message: "Login successful",
    data: { token: webToken },
  });
});

exports.resendOTP = catchAsync(async (req, res) => {
  SimpleValidator(req.body, {
    traceId: "required",
  });
  let { traceId } = req.body;

  let otp = await resendOtp(traceId);

  res.json({
    message: "OTP resent",
    data: { traceId: otp.traceId },
  });
});
