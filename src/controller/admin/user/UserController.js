/**
 * @fileoverview User Controller
 *
 * This module provides controller functions for managing user accounts.
 * It handles CRUD operations for users, including creation, retrieval,
 * updating, and soft deletion of user accounts.
 *
 * @module UserController
 * @requires mongoose
 * @requires ../../../exception/AppError
 * @requires ../../../exception/catchAsync
 * @requires ../../../model/User
 * @requires ../../../utils/dateQueryGenerator
 * @requires ../../../validator/simpleValidator
 * @requires ../../../config/file
 */

const { Types } = require("mongoose");
const AppError = require("../../../exception/AppError");
const catchAsync = require("../../../exception/catchAsync");
const User = require("../../../model/User");
const dateQueryGenerator = require("../../../utils/dateQueryGenerator");
const SimpleValidator = require("../../../validator/simpleValidator");
const { upload, deleteFileByPath } = require("../../../config/file");
const UserCacheService = require("../../../services/UserCacheService");

/**
 * Creates a new user
 *
 * This function validates the input, checks for existing email,
 * creates a new user in the database, and handles profile photo upload.
 *
 * @function createUser
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body containing user details
 * @param {string} req.body.firstName - First name of the user
 * @param {string} req.body.lastName - Last name of the user
 * @param {string} req.body.email - Email of the user
 * @param {string} req.body.password - Password for the user
 * @param {string} [req.body.phone] - Phone number of the user
 * @param {Object} [req.file] - Uploaded profile photo file
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the created user
 */
exports.createUser = catchAsync(async (req, res) => {
  // Validate incoming data
  await SimpleValidator(req.body, {
    firstName: "required|string",
    lastName: "required|string",
    email: "required|email",
    password: "required|string|min:8",
  });

  const { firstName, lastName, email, password, phone } = req.body;

  // Validate the email exist
  const emailExists = await User.findOne({ email, status: { $ne: "deleted" } });
  if (emailExists) {
    throw new AppError("Email already exists", 422);
  }

  // Create the user
  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    phone,
    status: "activated",
  });
  if (req.file) {
    let uploadData = await upload(req.file, "profile-photo", user._id);
    const { Key } = uploadData;
    user.photo = Key;
    await user.save();
  }

  res.status(201).json({
    message: "User created successfully",
    data: user,
  });
});

/**
 * Retrieves all users with optional filtering and pagination
 *
 * This function fetches users based on search criteria, date range,
 *  status, and pagination parameters.
 *
 * @function getAllUsers
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.query - Query parameters
 * @param {string} [req.query.search] - Search term for user name or email
 * @param {string} [req.query.fromDate] - Start date for filtering
 * @param {string} [req.query.toDate] - End date for filtering
 * @param {number} [req.query.page=1] - Page number for pagination
 * @param {number} [req.query.limit=10] - Number of items per page
 * @param {string} [req.query.status] - User status filter
 * @param {string} [req.query.sortBy="createdAt"] - Field to sort by
 * @param {string} [req.query.sortOrder="desc"] - Sort order (asc or desc)
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with paginated user data
 */
exports.getAllUsers = catchAsync(async (req, res) => {
  const {
    search,
    fromDate,
    toDate,
    page = 1,
    limit = 10,
    status,
    subscriptionPlan,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  // Generate date query using the provided function
  let dateQuery = dateQueryGenerator(fromDate, toDate);

  // Create the main query object
  let query = {
    ...dateQuery,
    ...(status ? { status } : { status: { $ne: "deleted" } }),
    ...(search && {
      $or: [
        { email: { $regex: search, $options: "i" } },
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
      ],
    }),
  };

  const moment = require("moment");

  // Aggregation pipeline
  const aggregatedQuery = User.aggregate([
    {
      $match: query,
    },
    {
      $addFields: {
        // Top-up balance
        topUpBalance: { $ifNull: ["$topUpCreditBalance", 0] },
        // Subscription balance (will be set to 0 if expired)
        subscriptionBalance: { $ifNull: ["$monthlySubscriptionCreditBalance", 0] },
        // Combine first and last name
        fullName: {
          $concat: [
            { $ifNull: ["$firstName", ""] },
            " ",
            { $ifNull: ["$lastName", ""] },
          ],
        },
      },
    },
    {
      $addFields: {
        // Check if subscription has expired and set subscription balance to 0 if expired
        effectiveSubscriptionBalance: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$subscriptionExpiresAt", null] },
                { $lt: ["$subscriptionExpiresAt", "$$NOW"] },
              ],
            },
            then: 0,
            else: "$subscriptionBalance",
          },
        },
      },
    },
    {
      $addFields: {
        // Total balance
        totalBalance: {
          $add: ["$effectiveSubscriptionBalance", "$topUpBalance"],
        },
      },
    },
    {
      $lookup: {
        from: "subscriptionplans",
        localField: "subscriptionPlan",
        foreignField: "_id",
        as: "subscriptionPlanData",
      },
    },
    {
      $unwind: {
        path: "$subscriptionPlanData",
        preserveNullAndEmptyArrays: true,
      },
    },
    // Filter by subscription plan if provided
    ...(subscriptionPlan
      ? [
          {
            $match: {
              ...(subscriptionPlan === "none"
                ? { $or: [{ subscriptionPlan: null }, { subscriptionPlan: { $exists: false } }] }
                : { subscriptionPlan: new Types.ObjectId(subscriptionPlan) }),
            },
          },
        ]
      : []),
    {
      $project: {
        // Include all user fields plus balance fields
        firstName: 1,
        lastName: 1,
        fullName: 1,
        email: 1,
        phone: 1,
        dialCode: 1,
        photo: 1,
        status: 1,
        roleType: 1,
        gender: 1,
        dob: 1,
        language: 1,
        createdAt: 1,
        updatedAt: 1,
        topUpCreditBalance: 1,
        monthlySubscriptionCreditBalance: 1,
        subscriptionPlan: 1,
        subscriptionStatus: 1,
        subscriptionExpiresAt: 1,
        // Computed balance fields
        topUpBalance: 1,
        effectiveSubscriptionBalance: 1,
        totalBalance: 1,
        // Subscription plan details
        currentPlan: {
          $cond: {
            if: { $ne: ["$subscriptionPlanData", null] },
            then: {
              name: "$subscriptionPlanData.name",
              _id: "$subscriptionPlanData._id",
            },
            else: null,
          },
        },
      },
    },
    {
      $sort: {
        [sortBy]: sortOrder === "desc" ? -1 : 1,
      },
    },
  ]);

  // Pagination options
  const options = {
    page: parseInt(page),
    limit: parseInt(limit) === -1 ? 9999999 : parseInt(limit),
  };

  // Fetch paginated data
  const data = await User.aggregatePaginate(aggregatedQuery, options);

  res.json({
    message: "Fetched successfully",
    data,
  });
});

/**
 * Retrieves a specific user by ID
 *
 * This function fetches a single user based on the provided ID.
 *
 * @function getUser
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - User ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the user data
 * @throws {AppError} If the user is not found
 */
exports.getUser = catchAsync(async (req, res) => {
  const user = await User.findOne({
    _id: req.params.id,
    status: { $ne: "deleted" },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  res.json({
    message: "User fetched successfully",
    data: user,
  });
});

/**
 * Updates a specific user by ID
 *
 * This function validates the input and updates the user details,
 * including the profile photo if a new one is provided.
 *
 * @function updateUser
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - User ID
 * @param {Object} req.body - Request body containing updated user details
 * @param {string} req.body.firstName - Updated first name of the user
 * @param {string} req.body.lastName - Updated last name of the user
 * @param {string} [req.body.email] - Updated email of the user
 * @param {string} [req.body.status] - Updated status of the user
 * @param {string} [req.body.phone] - Updated phone number of the user
 * @param {string} [req.body.password] - Updated password for the user
 * @param {Object} [req.file] - New profile photo file
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the updated user
 * @throws {AppError} If the user is not found or validation fails
 */
exports.updateUser = catchAsync(async (req, res) => {
  // Validate incoming data
  await SimpleValidator(req.body, {
    firstName: "required",
    lastName: "required",
  });

  const { firstName, lastName, email, status, phone, password, roleType } =
    req.body;
  const userId = req.params.id;

  // Find the user
  const user = await User.findOne({ _id: userId, status: { $ne: "deleted" } });
  if (!user) {
    throw new AppError("User not found", 404);
  }

  // Update fields if provided
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
  if (roleType) {
    user.roleType = roleType;
  }
  if (password) {
    user.password = password;
  }
  if (req.file) {
    if (user?.photo) {
      await deleteFileByPath(user.photo);
    }
    let uploadData = await upload(req.file, "profile-photo");
    const { Key } = uploadData;
    user.photo = Key;
  }
  if (status) {
    user.status = status;
  }

  await user.save();

  // Invalidate cache after update
  await UserCacheService.deleteCachedUser(userId);

  res.json({
    message: "User updated successfully",
    data: user,
  });
});

/**
 * Soft deletes a specific user by ID
 *
 * This function marks a user as deleted without removing them from the database.
 *
 * @function deleteUser
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - User ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response confirming the deletion
 * @throws {AppError} If the user is not found
 */
exports.deleteUser = catchAsync(async (req, res) => {
  const userId = req.params.id;

  // Find the user
  const user = await User.findOne({ _id: userId, status: { $ne: "deleted" } });
  if (!user) {
    throw new AppError("User not found", 404);
  }

  // Soft delete the user by setting status to "deleted"
  user.status = "deleted";
  await user.save();

  res.json({
    message: "User deleted successfully",
  });
});

/**
 * Get user details with balance information
 *
 * @function getUserDetails
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - User ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with user details and balance
 */
exports.getUserDetails = catchAsync(async (req, res) => {
  const userId = req.params.id;

  const user = await User.findOne({
    _id: userId,
    status: { $ne: "deleted" },
  })
    .populate("subscriptionPlan")
    .select("-password");

  if (!user) {
    throw new AppError("User not found", 404);
  }

  // Get balance summary
  const BalanceService = require("../../../services/BalanceService");
  const balanceSummary = await BalanceService.getBalanceSummary(userId);

  res.json({
    message: "User details fetched successfully",
    data: {
      user,
      balance: balanceSummary,
    },
  });
});

/**
 * Get user subscription history
 *
 * @function getUserSubscriptionHistory
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - User ID
 * @param {Object} req.query - Query parameters
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=10] - Items per page
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with subscription history
 */
exports.getUserSubscriptionHistory = catchAsync(async (req, res) => {
  const userId = req.params.id;
  const { page = 1, limit = 10 } = req.query;

  // Verify user exists
  const user = await User.findOne({
    _id: userId,
    status: { $ne: "deleted" },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const SubscriptionHistory = require("../../../model/SubscriptionHistory");

  // Build aggregation pipeline
  const aggregatedQuery = SubscriptionHistory.aggregate([
    {
      $match: {
        user: new Types.ObjectId(userId),
      },
    },
    {
      $lookup: {
        from: "subscriptionplans",
        localField: "subscriptionPlan",
        foreignField: "_id",
        as: "plan",
      },
    },
    {
      $unwind: {
        path: "$plan",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: {
        createdAt: -1,
      },
    },
  ]);

  // Pagination options
  const options = {
    page: parseInt(page),
    limit: parseInt(limit) === -1 ? 9999999 : parseInt(limit),
  };

  // Fetch paginated data
  const data = await SubscriptionHistory.aggregatePaginate(
    aggregatedQuery,
    options
  );

  res.json({
    message: "Subscription history fetched successfully",
    data,
  });
});

/**
 * Get user topup history
 *
 * @function getUserTopupHistory
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - User ID
 * @param {Object} req.query - Query parameters
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=10] - Items per page
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with topup history
 */
exports.getUserTopupHistory = catchAsync(async (req, res) => {
  const userId = req.params.id;
  const { page = 1, limit = 10 } = req.query;

  // Verify user exists
  const user = await User.findOne({
    _id: userId,
    status: { $ne: "deleted" },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const TopUpHistory = require("../../../model/TopUpHistory");

  // Build aggregation pipeline
  const aggregatedQuery = TopUpHistory.aggregate([
    {
      $match: {
        user: new Types.ObjectId(userId),
      },
    },
    {
      $lookup: {
        from: "creditpackages",
        localField: "package",
        foreignField: "_id",
        as: "packageData",
      },
    },
    {
      $unwind: {
        path: "$packageData",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: {
        createdAt: -1,
      },
    },
  ]);

  // Pagination options
  const options = {
    page: parseInt(page),
    limit: parseInt(limit) === -1 ? 9999999 : parseInt(limit),
  };

  // Fetch paginated data
  const data = await TopUpHistory.aggregatePaginate(aggregatedQuery, options);

  res.json({
    message: "Topup history fetched successfully",
    data,
  });
});

/**
 * Add topup credit to a user
 *
 * @function addTopupCredit
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - User ID
 * @param {Object} req.body - Request body
 * @param {number} req.body.amount - Credit amount to add
 * @param {string} [req.body.remarks] - Remarks for the topup
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response confirming the topup
 */
exports.addTopupCredit = catchAsync(async (req, res) => {
  // Validate input
  await SimpleValidator(req.body, {
    amount: "required|numeric|min:1",
  });

  const userId = req.params.id;
  const { amount, remarks } = req.body;

  // Find the user
  const user = await User.findOne({ _id: userId, status: { $ne: "deleted" } });
  if (!user) {
    throw new AppError("User not found", 404);
  }

  const TopUpHistory = require("../../../model/TopUpHistory");
  const BalanceService = require("../../../services/BalanceService");

  // Create topup history record
  const topUpHistory = await TopUpHistory.create({
    user: userId,
    amount: Number(amount),
    usdPrice: 0, // Admin topup doesn't have USD price
    status: "executed",
  });

  // Update user's topup balance
  const currentTopUpBalance = Number(user.topUpCreditBalance ?? 0);
  const newTopUpBalance = currentTopUpBalance + Number(amount);

  await User.findByIdAndUpdate(userId, {
    topUpCreditBalance: newTopUpBalance,
  });

  // Create credit transaction record
  await BalanceService.createTransaction({
    userId: userId,
    amount: Number(amount),
    type: "credit",
    source: "admin_topup",
    topUpHistory: topUpHistory._id,
    remarks: remarks || "Admin topup credit",
  });

  // Get updated balance summary
  const balanceSummary = await BalanceService.getBalanceSummary(userId);

  res.json({
    message: "Topup credit added successfully",
    data: {
      topUpHistory,
      balance: balanceSummary,
    },
  });
});

/**
 * Upgrade user's subscription plan
 *
 * @function upgradeUserSubscription
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - User ID
 * @param {Object} req.body - Request body
 * @param {string} req.body.planId - Subscription plan ID
 * @param {string} req.body.intervalType - Interval type (month or year)
 * @param {string} [req.body.remarks] - Remarks for the upgrade
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response confirming the upgrade
 */
exports.upgradeUserSubscription = catchAsync(async (req, res) => {
  // Validate input
  await SimpleValidator(req.body, {
    planId: "required|string",
    intervalType: "required|string|in:month,year",
  });

  const userId = req.params.id;
  const { planId, intervalType, remarks } = req.body;

  // Find the user
  const targetUser = await User.findOne({ _id: userId, status: { $ne: "deleted" } });
  if (!targetUser) {
    throw new AppError("User not found", 404);
  }

  const SubscriptionPlan = require("../../../model/SubscriptionPlan");
  const SubscriptionHistory = require("../../../model/SubscriptionHistory");
  const BalanceService = require("../../../services/BalanceService");
  const moment = require("moment");

  // Find the subscription plan
  const plan = await SubscriptionPlan.findOne({
    _id: planId,
    status: "active",
  });

  if (!plan) {
    throw new AppError("Subscription plan not found or inactive", 404);
  }

  // Handle custom plans
  if (plan.isCustom) {
    throw new AppError("Cannot upgrade to custom plan via admin panel", 400);
  }

  // Determine credit amount and expiration date based on interval type
  let creditToAdd = 0;
  let subscriptionExpiresAt = null;
  let paymentCycle = "Monthly";
  let totalCycle = 1;

  if (intervalType === "month") {
    creditToAdd = Number(plan.monthlyCredit);
    subscriptionExpiresAt = moment.utc().add(1, "month").toDate();
    paymentCycle = "Monthly";
    totalCycle = 1;
  } else if (intervalType === "year") {
    creditToAdd = Number(plan.annualMonthlyCredit);
    subscriptionExpiresAt = moment.utc().add(1, "year").toDate();
    paymentCycle = "Yearly";
    totalCycle = 12;
  } else {
    throw new AppError("Invalid interval type. Must be 'month' or 'year'", 400);
  }

  // Handle unlimited credit
  let unlimitedCredit = plan?.unlimitedCredit ?? "no";
  let unlimitedCreditCap = Number(plan?.unlimitedCreditCap ?? 0);
  
  if (unlimitedCredit === "yes") {
    creditToAdd = unlimitedCreditCap;
  }

  // Get current user with latest balance
  let currentUser = await User.findById(userId);
  if (!currentUser) {
    throw new AppError("User not found", 404);
  }

  // Find existing active subscription (user can only have ONE active subscription)
  const existingActiveSubscription = await SubscriptionHistory.findOne({
    user: userId,
    status: "active",
  });

  let remainingBalanceFromOldSubscription = 0;
  let upgradeNote = null;

  // If user has an existing active subscription, mark it as upgraded
  if (existingActiveSubscription) {
    // Get remaining balance from old subscription
    remainingBalanceFromOldSubscription = Number(existingActiveSubscription.currentCycleBalance ?? 0);
    
    // Get old plan name for the note
    const oldPlan = await SubscriptionPlan.findById(existingActiveSubscription.subscriptionPlan);
    const oldPlanName = oldPlan ? oldPlan.name : "Previous Plan";
    
    // Mark old subscription as upgraded with note
    upgradeNote = `Admin upgraded from ${oldPlanName} to ${plan.name}. Remaining balance: ${remainingBalanceFromOldSubscription} credits transferred.`;
    
    await SubscriptionHistory.findByIdAndUpdate(existingActiveSubscription._id, {
      status: "upgraded",
      cancellationReason: upgradeNote,
      remarks: existingActiveSubscription.remarks 
        ? `${existingActiveSubscription.remarks} | ${upgradeNote}`
        : upgradeNote,
    });
  }

  // Calculate total credits to add (new subscription credits + remaining balance from old subscription)
  const totalCreditsToAdd = Number(creditToAdd) + Number(remainingBalanceFromOldSubscription);

  // Get current subscription balance from user model
  const currentSubscriptionBalance = Number(currentUser.monthlySubscriptionCreditBalance ?? 0);
  
  // Calculate new accumulated subscription balance
  // Add new credits to existing subscription balance
  const newSubscriptionBalance = currentSubscriptionBalance + totalCreditsToAdd;

  // Create admin upgrade note
  const adminNote = remarks 
    ? `Admin upgrade: ${remarks}` 
    : `Admin upgraded subscription to ${plan.name} - ${paymentCycle}`;

  // Create new subscription history
  const subscriptionHistory = await SubscriptionHistory.create({
    user: userId,
    subscriptionPlan: plan._id,
    cycleType: paymentCycle,
    totalCycle,
    cycleCompleted: 1,
    nextCycleAt: intervalType === "year" 
      ? moment.utc().add(1, "month").toDate() 
      : null,
    subscriptionStartedAt: new Date(),
    subscriptionEndDate: subscriptionExpiresAt,
    membership: "pro",
    remarks: remainingBalanceFromOldSubscription > 0
      ? `${adminNote}. Upgraded from previous plan with ${remainingBalanceFromOldSubscription} credits transferred.`
      : adminNote,
    status: "active",
    amount: totalCreditsToAdd,
    currentCycleBalance: totalCreditsToAdd,
    transactionType: "admin_manual",
    transactionId: `admin_${Date.now()}_${userId}`,
  });

  // Create credit transaction for the new subscription credits
  await BalanceService.createTransaction({
    userId: userId,
    amount: creditToAdd,
    type: "credit",
    source: unlimitedCredit === "yes" 
      ? "admin_subscriptionWithUnlimitedCredit" 
      : "admin_subscription",
    subscriptionPlan: plan._id,
    subscriptionHistory: subscriptionHistory._id,
    remarks: `Admin Subscription: ${plan.name} - ${paymentCycle}`,
  });

  // If there was a balance transfer, create a transaction for that too
  if (remainingBalanceFromOldSubscription > 0) {
    await BalanceService.createTransaction({
      userId: userId,
      amount: remainingBalanceFromOldSubscription,
      type: "credit",
      source: "admin_subscriptionUpgrade",
      subscriptionPlan: plan._id,
      subscriptionHistory: subscriptionHistory._id,
      remarks: `Balance transferred from upgraded subscription (Admin)`,
    });
  }

  // Update user model directly with accumulated balance and subscription info
  await User.findByIdAndUpdate(userId, {
    monthlySubscriptionCreditBalance: newSubscriptionBalance,
    subscriptionExpiresAt,
    subscriptionStatus: "active",
    subscriptionPlan: plan._id,
  });

  // Get updated user
  const updatedUser = await User.findById(userId).select(
    "topUpCreditBalance monthlySubscriptionCreditBalance subscriptionExpiresAt subscriptionStatus subscriptionPlan"
  );

  // Get balance summary
  const balanceSummary = await BalanceService.getBalanceSummary(userId);

  res.status(201).json({
    status: "success",
    message: existingActiveSubscription 
      ? "Successfully upgraded user's subscription plan" 
      : "Successfully subscribed user to plan",
    data: {
      subscription: subscriptionHistory,
      balance: balanceSummary,
      plan: {
        _id: plan._id,
        name: plan.name,
        subtitle: plan.subtitle,
        intervalType,
        creditAdded: creditToAdd,
        totalCreditsAdded: totalCreditsToAdd,
      },
      upgrade: existingActiveSubscription ? {
        wasUpgraded: true,
        previousPlanId: existingActiveSubscription.subscriptionPlan,
        balanceTransferred: remainingBalanceFromOldSubscription,
        note: upgradeNote,
      } : {
        wasUpgraded: false,
      },
    },
  });
});
