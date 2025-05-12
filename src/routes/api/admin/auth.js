/**
 * @fileoverview Admin Authentication Routes
 *
 * This module defines the routes for admin authentication, including login and OTP verification.
 * It uses Express Router to group these authentication-related routes under the "/auth" path.
 *
 * @module adminAuthRoutes
 * @requires express
 * @requires ../../../controller/admin/auth/LoginController
 */

const {
  login,
  verifyLoginWithOTP,
  resendOTP,
} = require("../../../controller/admin/auth/LoginController");
const {
  register,
  verifyRegistration,
  registerRequest,
} = require("../../../controller/admin/auth/RegisterController");
const otpVerified = require("../../../middleware/otpVerified");

/**
 * Express router to mount admin authentication related functions on.
 * @type {object}
 * @const
 */
const authRouter = require("express").Router();
require("express-group-routes");

/**
 * Express router group for authentication routes.
 * All routes defined within this group will be prefixed with "/auth".
 */
authRouter.group("/auth", (auth) => {
  /**
   * POST /auth/login
   * @desc Authenticate admin and initiate login process
   * @access Public
   */
  auth.post("/loginRequest", login);

  auth.post("/resendOTP", resendOTP);

  /**
   * POST /auth/login/verify
   * @desc Verify admin login with OTP
   * @access Public
   */
  auth.post("/login/verify", otpVerified, verifyLoginWithOTP);

  auth.post("/registerRequest", registerRequest);

  auth.post("/verifyRegistration", otpVerified, verifyRegistration);

});

module.exports = authRouter;
