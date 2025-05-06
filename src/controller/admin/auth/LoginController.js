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
    email: "required|email",
    password: "required",
  });
  const { email, password } = req.body;

  // 1. Validate Email and Password
  const user = await User.findOne({
    email,
    status: { $ne: "deleted" },
  });
  if (!user) {
    return res.status(422).json({ message: "Invalid email or password" });
  }

  const isPasswordCorrect = await user.correctPassword(password, user.password);
  if (!isPasswordCorrect) {
    return res.status(422).json({ message: "Invalid email or password" });
  }

  // 2. Check if Google Authenticator is enabled
  if (user?.googleAuthenticator == "on") {
    let temporaryTokenForAuthenticatorVerification = jwt.sign(
      { authenticatorVerificationId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );
    return res.status(200).json({
      status: "otp_required",
      message: "OTP is required",
      token: temporaryTokenForAuthenticatorVerification, // Send back user ID for OTP validation
    });
  }

  // 3. Generate JWT Token if no OTP is required
  const token = await generateWebToken(user);

  // check dashboard access
  let hasDashboardAccess = true;

  res.json({
    message: "Logged in successfully",
    data: {
      token,
      hasDashboardAccess,
    },
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
 * @param {string} req.body.otp - One-time password for verification
 * @param {string} req.body.token - Temporary token from initial login
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with authentication result
 * @throws {AppError} If validation fails or OTP verification is unsuccessful
 */
exports.verifyLoginWithOTP = catchAsync(async (req, res) => {
  SimpleValidator(req.body, {
    otp: "required|maxlength:6",
    token: "required",
  });
  const { token, otp } = req.body;

  if (!token || !otp) {
    throw new AppError("Temporary token and OTP are required", 422);
  }

  try {
    // Decode the temporary token
    const { authenticatorVerificationId } = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (!authenticatorVerificationId) {
      throw new AppError("Invalid token provided", 401);
    }

    // Find the user
    const user = await User.findById(authenticatorVerificationId);
    if (!user || user?.googleAuthenticator !== "on") {
      throw new AppError("Invalid user or authenticator not enabled", 401);
    }

    // Verify the OTP
    const isValidOTP = speakeasy.totp.verify({
      secret: user.googleAuthSeed,
      encoding: "base32",
      token: otp,
    });

    if (!isValidOTP) {
      throw new AppError("Invalid OTP", 409);
    }

    // Generate the final JWT token
    const webToken = await generateWebToken(user);

    // check dashboard access
    let hasDashboardAccess = true;

    res.json({
      message: "Login successful",
      data: { token: webToken, hasDashboardAccess },
    });
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      throw new AppError("Invalid or expired temporary token", 401);
    }
    throw error;
  }
});
