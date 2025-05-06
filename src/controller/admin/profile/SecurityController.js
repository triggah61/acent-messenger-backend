/**
 * @fileoverview Security Controller
 * 
 * This module provides controller functions for managing user security settings,
 * including two-factor authentication (2FA) and password changes.
 * 
 * @module SecurityController
 * @requires ../../../exception/catchAsync
 * @requires ../../../model/User
 * @requires speakeasy
 * @requires qrcode
 * @requires ../../../exception/AppError
 * @requires bcryptjs
 * @requires ../../../validator/simpleValidator
 * @requires ../../../events/TwoFAChanged
 * @requires ../../../events/PasswordChanged
 */

const catchAsync = require("../../../exception/catchAsync");
const User = require("../../../model/User");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const AppError = require("../../../exception/AppError");
const bcrypt = require("bcryptjs");
const SimpleValidator = require("../../../validator/simpleValidator");
const TwoFAChanged = require("../../../events/TwoFAChanged");
const PasswordChanged = require("../../../events/PasswordChanged");

/**
 * Initiates the setup process for Google Authenticator
 * 
 * @function setAuthenticatorSeed
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.user - Authenticated user object
 * @param {Object} req.params - URL parameters
 * @param {string} [req.params.id] - User ID (optional, defaults to authenticated user)
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with QR code and setup data
 * @throws {AppError} If there's an error generating the authenticator seed
 */
exports.setAuthenticatorSeed = catchAsync(async (req, res) => {
  let userId = req.user._id;

  if (req.params.id) {
    userId = req.params.id;
  }

  // Generate a new secret for Google Authenticator
  const secret = speakeasy.generateSecret({ length: 20 });

  // Save the secret to the user's profile (but do not turn on Google Authenticator yet)
  const user = await User.findByIdAndUpdate(
    userId,
    { googleAuthSeed: secret.base32 },
    { new: true }
  );
  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret.ascii,
    label: `${process.env.APP_NAME}:${user.email}`,
    issuer: process.env.APP_NAME,
  });
  const qrCode = await qrcode.toDataURL(otpauthUrl);
  res.json({
    message: "Google Authenticator setup initiated successfully",
    data: {
      qrCode, // Base64-encoded QR code image
      otpauthUrl, // Optional: the OTPAuth URL if the user prefers to enter manually
      googleAuthSeed: secret.base32, // The base32 secret that can be stored on the server
    },
  });
});

/**
 * Toggles the status of Google Authenticator for a user
 * 
 * @function toggleAuthenticatorStatus
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.user - Authenticated user object
 * @param {Object} req.params - URL parameters
 * @param {string} [req.params.id] - User ID (optional, defaults to authenticated user)
 * @param {Object} req.body - Request body
 * @param {string} req.body.otp - One-time password for verification
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response confirming the status change
 * @throws {AppError} If OTP is invalid or user is not found
 */
exports.toggleAuthenticatorStatus = catchAsync(async (req, res) => {
  const { otp } = req.body;
  let userId = req.user._id;

  if (req.params.id) {
    userId = req.params.id;
  }

  // Find the user
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if (user?.googleAuthenticator == "on") {
    // Currently enabled, toggle to disable
    if (!otp) {
      throw new AppError(
        "OTP is required to disable Google Authenticator",
        422
      );
    }

    // Verify the OTP
    const verified = speakeasy.totp.verify({
      secret: user.googleAuthSeed,
      encoding: "base32",
      token: otp,
    });

    if (!verified) {
      throw new AppError("Invalid OTP", 409);
    }

    // Disable Google Authenticator
    user.googleAuthenticator = "off";
    await user.save();

    TwoFAChanged(user);

    res.json({
      message: "Google Authenticator has been disabled successfully",
    });
  } else {
    // Currently disabled, toggle to enable

    if (!otp) {
      throw new AppError(
        "OTP is required to disable Google Authenticator",
        422
      );
    }

    // Verify the OTP
    const verified = speakeasy.totp.verify({
      secret: user.googleAuthSeed,
      encoding: "base32",
      token: otp,
    });

    if (!verified) {
      throw new AppError("Invalid OTP", 409);
    }

    // Enable Google Authenticator
    user.googleAuthenticator = "on";
    await user.save();

    TwoFAChanged(user);

    res.json({
      message: "Google Authenticator has been enabled successfully",
    });
  }
});

/**
 * Changes the password for a user
 * 
 * @function changePassword
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.user - Authenticated user object
 * @param {Object} req.params - URL parameters
 * @param {string} [req.params.id] - User ID (optional, defaults to authenticated user)
 * @param {Object} req.body - Request body
 * @param {string} req.body.currentPassword - Current password (required for profile changes)
 * @param {string} req.body.newPassword - New password
 * @param {string} req.body.confirmNewPassword - Confirmation of new password
 * @param {string} req.body.sourcePage - Source of the request ('profile' or 'user-management')
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response confirming the password change
 * @throws {AppError} If validation fails or current password is invalid
 */
exports.changePassword = catchAsync(async (req, res) => {
  let { user } = req;

  await SimpleValidator(req.body, {
    confirmNewPassword: "required|same:newPassword",
    newPassword: "required",
    sourcePage: "required|in:profile,user-management",
    currentPassword: "required_if:sourcePage,profile",
  });

  let { currentPassword, newPassword, sourcePage } = req.body;

  if (req.params.id) {
    user = await User.findById(req.params.id);
  }

  if (sourcePage == "profile") {
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );
    if (!isPasswordValid) {
      throw new AppError("Invalid current password", 401);
    }
  }

  user = await User.findByIdAndUpdate(user._id);
  user.password = newPassword;
  await user.save();

  PasswordChanged(user);

  res.status(200).json({
    status: "success",
    message: "Password changed successfully",
  });
});
