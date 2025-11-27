const catchAsync = require("../../../exception/catchAsync");
const moment = require("moment");
const User = require("../../../model/User");
const SubscriptionHistory = require("../../../model/SubscriptionHistory");
const SubscriptionPlan = require("../../../model/SubscriptionPlan");

exports.getDashboard = catchAsync(async (req, res) => {
  const startOfToday = moment.utc().startOf("day").toDate();
  const endOfToday = moment.utc().endOf("day").toDate();

  // Total Users (activated users with role = "user")
  const totalUsers = await User.countDocuments({
    status: "activated",
    role: { $nin: ["superAdmin", "admin"] },
  });

  // Today Registered Users
  const todayRegisteredUsers = await User.countDocuments({
    status: "activated",
    role: { $nin: ["superAdmin", "admin"] },
    createdAt: {
      $gte: startOfToday,
      $lte: endOfToday,
    },
  });

  // Users without Subscriptions - users who don't have an active subscription
  // A user is considered "without plan" if subscriptionStatus is NOT "active"
  // This covers: none, expired, cancelled, null, or any other non-active status
  const usersWithoutSubscriptions = await User.countDocuments({
    status: "activated",
    role: {$nin: ["superAdmin", "admin"]},
    $or: [
      { subscriptionStatus: { $ne: "active" } }, // Not active (includes none, expired, cancelled, null)
      { subscriptionPlan: null },
    ],
  });

  // Get all active subscription plans first
  const allPlans = await SubscriptionPlan.find({
    status: "active",
  })
    .select("_id name")
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  // Get subscribed users count per plan
  const subscribedUsersPerPlan = await User.aggregate([
    {
      $match: {
        subscriptionStatus: "active",
        subscriptionPlan: { $ne: null },
      },
    },
    {
      $group: {
        _id: "$subscriptionPlan",
        count: { $sum: 1 },
      },
    },
  ]);

  // Create a map of planId to count for quick lookup
  const planCountMap = new Map();
  subscribedUsersPerPlan.forEach((item) => {
    planCountMap.set(item._id.toString(), item.count);
  });

  // Format subscriptions by plan - include ALL plans, even with 0 subscribers
  const subscriptionsByPlan = allPlans.map((plan) => ({
    planId: plan._id,
    planName: plan.name,
    count: planCountMap.get(plan._id.toString()) || 0,
  }));

  // Sort by count descending, then by name
  subscriptionsByPlan.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.planName.localeCompare(b.planName);
  });

  res.json({
    message: "Fetched successfully",
    data: {
      userCount: totalUsers,
      todayRegisteredUsers,
      usersWithoutSubscriptions,
      subscriptionsByPlan,
    },
  });
});

/**
 * Get latest active subscriptions for dashboard table
 * @route GET /api/admin/dashboard/latest-subscriptions
 * @access Private
 */
exports.getLatestSubscriptions = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  // Only fetch active subscriptions
  const latestSubscriptions = await SubscriptionHistory.find({
    status: "active",
  })
    .populate("user", "firstName lastName email photo")
    .populate("subscriptionPlan", "name")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Format the response
  const formattedSubscriptions = latestSubscriptions.map((sub) => ({
    _id: sub._id,
    userName: sub.user
      ? `${sub.user.firstName || ""} ${sub.user.lastName || ""}`.trim() ||
        sub.user.email ||
        "N/A"
      : "N/A",
    userEmail: sub.user?.email || "N/A",
    userPhoto: sub.user?.photo || null,
    planName: sub.subscriptionPlan?.name || "N/A",
    cycleType: sub.cycleType || "N/A",
    cycleCompleted: sub.cycleCompleted || 0,
    totalCycle: sub.totalCycle || 0,
    status: sub.status || "N/A",
    subscriptionStartedAt: sub.subscriptionStartedAt || null,
    subscriptionEndDate: sub.subscriptionEndDate || null,
    createdAt: sub.createdAt || null,
  }));

  res.json({
    message: "Latest subscriptions fetched successfully",
    data: formattedSubscriptions,
  });
});
