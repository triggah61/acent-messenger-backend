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
const UserCacheService = require("../../../services/UserCacheService");
const BalanceService = require("../../../services/BalanceService");
const SubscriptionPlan = require("../../../model/SubscriptionPlan");
const SubscriptionHistory = require("../../../model/SubscriptionHistory");

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
  console.log(user);
  
  // Get balance summary (only balance amounts, not subscription status)
  const balanceSummaryFull = await BalanceService.getBalanceSummary(user._id);
  const balanceSummary = {
    topUpBalance: balanceSummaryFull.topUpBalance,
    subscriptionBalance: balanceSummaryFull.subscriptionBalance,
    totalBalance: balanceSummaryFull.totalBalance,
  };
  
  // Sync subscription info first to ensure User model is up to date
  await BalanceService.syncUserBalanceFromSubscriptions(user._id);
  
  // Refresh user data to get updated subscription info
  const updatedUser = await User.findById(user._id).select(
    "subscriptionPlan subscriptionStatus subscriptionExpiresAt"
  );
  
  // Get current subscription plan details
  // First try from User model, if null, get from latest active subscription
  let subscriptionPlan = null;
  let subscriptionStatus = updatedUser?.subscriptionStatus || "none";
  let subscriptionExpiresAt = updatedUser?.subscriptionExpiresAt || null;
  
  if (updatedUser?.subscriptionPlan) {
    subscriptionPlan = await SubscriptionPlan.findById(updatedUser.subscriptionPlan)
      .select("-stripeMonthlyPriceId -stripeYearlyPriceId -paypalMonthlyPlanId -paypalYearlyPlanId -paddleMonthlyPlanId -paddleYearlyPlanId");
  } else {
    // If User model doesn't have subscriptionPlan, get from latest active subscription
    const latestActiveSubscription = await SubscriptionHistory.findOne({
      user: user._id,
      status: "active",
    })
      .sort({ createdAt: -1 })
      .populate("subscriptionPlan", "-stripeMonthlyPriceId -stripeYearlyPriceId -paypalMonthlyPlanId -paypalYearlyPlanId -paddleMonthlyPlanId -paddleYearlyPlanId");
    
    if (latestActiveSubscription?.subscriptionPlan) {
      subscriptionPlan = latestActiveSubscription.subscriptionPlan;
      subscriptionStatus = "active";
      subscriptionExpiresAt = latestActiveSubscription.subscriptionEndDate;
      
      // Update User model with this info for future requests
      await User.findByIdAndUpdate(user._id, {
        subscriptionPlan: latestActiveSubscription.subscriptionPlan._id,
        subscriptionStatus: "active",
        subscriptionExpiresAt: latestActiveSubscription.subscriptionEndDate,
      });
    }
  }

  // Format subscription information (without subscription history)
  let subscriptionInfo = null;
  if (subscriptionPlan || subscriptionStatus !== "none") {
    subscriptionInfo = {
      currentPlan: subscriptionPlan ? {
        _id: subscriptionPlan._id,
        name: subscriptionPlan.name,
        subtitle: subscriptionPlan.subtitle,
        description: subscriptionPlan.description,
        icon: subscriptionPlan.icon,
        monthlyPrice: subscriptionPlan.monthlyPrice,
        monthlyCredit: subscriptionPlan.monthlyCredit,
        annualMonthlyPrice: subscriptionPlan.annualMonthlyPrice,
        annualMonthlyCredit: subscriptionPlan.annualMonthlyCredit,
        color: subscriptionPlan.color,
        isCustom: subscriptionPlan.isCustom,
        contactFormLink: subscriptionPlan.contactFormLink,
        unlimitedCredit: subscriptionPlan.unlimitedCredit,
        unlimitedCreditCap: subscriptionPlan.unlimitedCreditCap,
        isPopular: subscriptionPlan.isPopular,
      } : null,
      subscriptionStatus: subscriptionStatus,
      subscriptionExpiresAt: subscriptionExpiresAt,
    };
  }
  
  let data = {
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    photo: user.photo,
    phone: user.phone,
    dialCode: user.dialCode,
    status: user.status,
    createdAt: user.createdAt,
    gender: user.gender,
    dob: user.dob,
    language: user?.language || "en",
    balance: balanceSummary,
    subscription: subscriptionInfo,
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

  const { firstName, lastName, username, email, phone, gender, dob, language } = req.body;

  console.log(req.body);

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
    user.dob = new Date(dob);
  }
  if (language) {
    user.language = language;
  }
  if (username) {
    const existingUser = await User.findOne({
      username,
      _id: { $ne: user._id },
    });
    if (existingUser) {
      throw new AppError("Username already exists", 400);
    }
    user.username = username;
  }

  // 4. Save the updated user
  await user.save();

  // 5. Invalidate cache after update
  await UserCacheService.deleteCachedUser(user._id.toString());

  // 6. Send response
  res.json({
    message: "Profile updated successfully",
    data: {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        photo: user.photo,
        role: user.roleType,
        status: user.status,
        gender: user.gender,
        dob: user.dob,
        language: user?.language || "en",
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

  // Invalidate cache after photo update
  await UserCacheService.deleteCachedUser(user._id.toString());

  res.json({
    message: "Profile photo uploaded successfully",
    data: {
      photo: Key,
    },
  });
});
