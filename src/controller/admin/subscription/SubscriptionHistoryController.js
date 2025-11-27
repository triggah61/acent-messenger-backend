const catchAsync = require("../../../exception/catchAsync");
const AppError = require("../../../exception/AppError");
const SubscriptionHistory = require("../../../model/SubscriptionHistory");
const User = require("../../../model/User");
const mongoose = require("mongoose");
const Types = mongoose.Types;

/**
 * Get all active subscriptions for admin
 * Shows all active subscriptions in descending order
 * Supports filtering by user
 * 
 * @route GET /api/admin/subscription-history
 * @access Private
 */
exports.getAllSubscriptionHistory = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    userId,
    status = "active", // Default to active only
  } = req.query;

  // Build match query
  const matchQuery = {
    status: status,
  };

  // Filter by user if provided
  if (userId) {
    matchQuery.user = new Types.ObjectId(userId);
  }

  // Build aggregation pipeline
  const aggregatedQuery = SubscriptionHistory.aggregate([
    {
      $match: matchQuery,
    },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userData",
      },
    },
    {
      $unwind: {
        path: "$userData",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: "subscriptionplans",
        localField: "subscriptionPlan",
        foreignField: "_id",
        as: "planData",
      },
    },
    {
      $unwind: {
        path: "$planData",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        userName: {
          $concat: [
            { $ifNull: ["$userData.firstName", ""] },
            " ",
            { $ifNull: ["$userData.lastName", ""] },
          ],
        },
        userEmail: "$userData.email",
        userPhoto: "$userData.photo",
        planName: "$planData.name",
      },
    },
    {
      $sort: {
        createdAt: -1, // Descending order
      },
    },
    {
      $project: {
        _id: 1,
        user: 1,
        subscriptionPlan: 1,
        cycleType: 1,
        totalCycle: 1,
        cycleCompleted: 1,
        currentCycleBalance: 1,
        nextCycleAt: 1,
        subscriptionStartedAt: 1,
        subscriptionEndDate: 1,
        status: 1,
        amount: 1,
        remarks: 1,
        createdAt: 1,
        updatedAt: 1,
        userName: 1,
        userEmail: 1,
        userPhoto: 1,
        planName: 1,
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
 * Get list of subscribed users for filter dropdown
 * Returns only users who have active subscriptions
 * 
 * @route GET /api/admin/subscription-history/subscribed-users
 * @access Private
 */
exports.getSubscribedUsers = catchAsync(async (req, res) => {
  // Get all users with active subscriptions
  const subscribedUsers = await User.aggregate([
    {
      $match: {
        status: "activated",
        role: { $nin: ["superAdmin", "admin"] },
        subscriptionStatus: "active",
        subscriptionPlan: { $ne: null },
      },
    },
    {
      $lookup: {
        from: "subscriptionplans",
        localField: "subscriptionPlan",
        foreignField: "_id",
        as: "planData",
      },
    },
    {
      $unwind: {
        path: "$planData",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 1,
        firstName: 1,
        lastName: 1,
        email: 1,
        photo: 1,
        planName: "$planData.name",
      },
    },
    {
      $sort: {
        firstName: 1,
        lastName: 1,
      },
    },
  ]);

  // Format the response
  const formattedUsers = subscribedUsers.map((user) => ({
    _id: user._id,
    name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "N/A",
    email: user.email,
    photo: user.photo,
    planName: user.planName || "N/A",
  }));

  res.json({
    message: "Subscribed users fetched successfully",
    data: formattedUsers,
  });
});

