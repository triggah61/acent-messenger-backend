/**
 * @fileoverview Profile Controller
 *
 * This module provides controller functions for managing user profiles.
 * It handles operations for retrieving user information, updating profiles,
 *
 * @module ProfileController
 * @requires ../../../config/file
 * @requires ../../../exception/AppError
 * @requires ../../../exception/catchAsync
 * @requires ../../../model/User
 * @requires ../../../validator/simpleValidator
 */

const { upload, deleteFileByPath } = require("../../../config/file");
const AppError = require("../../../exception/AppError");
const catchAsync = require("../../../exception/catchAsync");
const User = require("../../../model/User");
const SimpleValidator = require("../../../validator/simpleValidator");

/**
 * Retrieves the profile information of the authenticated user
 *
 * @function info
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.user - Authenticated user object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with user profile data
 */
exports.info = catchAsync(async (req, res) => {
  let { user } = req;
  let data = {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    photo: user.photo,
    phone: user.phone,
    dialCode: user.dialCode,
    status: user.status,
    createdAt: user.createdAt,
    gender: user.gender,
    dob: user.dob,
  };
  res.json({
    message: "Fetched successfully",
    data,
  });
});

/**
 * Updates the profile of the authenticated user
 *
 * @function updateProfile
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body
 * @param {string} req.body.firstName - Updated first name
 * @param {string} [req.body.lastName] - Updated last name
 * @param {Object} req.file - Uploaded profile photo file
 * @param {Object} req.user - Authenticated user object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with updated user data
 * @throws {AppError} If user is not found or validation fails
 */
exports.updateProfile = catchAsync(async (req, res) => {
  let { user } = req;
  // 1. Validate incoming data
  await SimpleValidator(req.body, {
    firstName: "required",
  });

  const { firstName, lastName, email, phone, gender, dob } = req.body;

  // 2. Find the user by ID
  user = await User.findById(user._id);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  // 3. Update only the fields provided in the payload
  if (firstName) {
    user.firstName = firstName;
  }
  if (lastName) {
    user.lastName = lastName;
  }
  if (email) {
    user.email = email;
  }
  if (phone) {
    user.phone = phone;
  }
  if (gender) {
    user.gender = gender;
  }
  if (dob) {
    user.dob = dob;
  }

  // 4. Save the updated user
  await user.save();

  // 5. Send response
  res.json({
    message: "Profile updated successfully",
    data: {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        photo: user.photo,
        role: user.roleType,
        status: user.status,
        gender: user.gender,
        dob: user.dob,
      },
    },
  });
});

exports.uploadPhoto = catchAsync(async (req, res) => {
  let { user } = req;
  if (!req.file) {
    throw new AppError("Photo is required", 400);
  }

  user = await User.findById(user._id);
  let uploadData = await upload(req.file, "profile-photo");
  console.log(uploadData);
  const { Key } = uploadData;
  user.photo = Key;
  await user.save();
  res.json({
    message: "Profile photo uploaded successfully",
    data: {
      photo: Key,
    },
  });
});
