const catchAsync = require("../../../exception/catchAsync");
const moment = require("moment");
const User = require("../../../model/User");
const SubscriptionHistory = require("../../../model/SubscriptionHistory");
const SubscriptionPlan = require("../../../model/SubscriptionPlan");
const TopUpHistory = require("../../../model/TopUpHistory");

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

  // Calculate Today's Earnings
  // From subscription payments made today
  const todaySubscriptionPayments = await SubscriptionHistory.aggregate([
    {
      $unwind: {
        path: "$payments",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $match: {
        "payments.paymentTime": {
          $gte: startOfToday,
          $lte: endOfToday,
        },
        "payments.status": "completed",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$payments.amount" },
      },
    },
  ]);

  // From top-ups executed today
  const todayTopUps = await TopUpHistory.aggregate([
    {
      $match: {
        status: "executed",
        createdAt: {
          $gte: startOfToday,
          $lte: endOfToday,
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$usdPrice" },
      },
    },
  ]);

  const todayEarnings =
    (todaySubscriptionPayments[0]?.total || 0) + (todayTopUps[0]?.total || 0);

  // Calculate Monthly Earnings (current month)
  const startOfMonth = moment.utc().startOf("month").toDate();
  const endOfMonth = moment.utc().endOf("month").toDate();

  const monthlySubscriptionPayments = await SubscriptionHistory.aggregate([
    {
      $unwind: {
        path: "$payments",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $match: {
        "payments.paymentTime": {
          $gte: startOfMonth,
          $lte: endOfMonth,
        },
        "payments.status": "completed",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$payments.amount" },
      },
    },
  ]);

  const monthlyTopUps = await TopUpHistory.aggregate([
    {
      $match: {
        status: "executed",
        createdAt: {
          $gte: startOfMonth,
          $lte: endOfMonth,
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$usdPrice" },
      },
    },
  ]);

  const monthlyEarnings =
    (monthlySubscriptionPayments[0]?.total || 0) + (monthlyTopUps[0]?.total || 0);

  // Calculate Total Earnings (all time)
  const totalSubscriptionPayments = await SubscriptionHistory.aggregate([
    {
      $unwind: {
        path: "$payments",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $match: {
        "payments.status": "completed",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$payments.amount" },
      },
    },
  ]);

  const totalTopUps = await TopUpHistory.aggregate([
    {
      $match: {
        status: "executed",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$usdPrice" },
      },
    },
  ]);

  const totalEarnings =
    (totalSubscriptionPayments[0]?.total || 0) + (totalTopUps[0]?.total || 0);

  res.json({
    message: "Fetched successfully",
    data: {
      userCount: totalUsers,
      todayRegisteredUsers,
      usersWithoutSubscriptions,
      subscriptionsByPlan,
      earnings: {
        today: todayEarnings,
        monthly: monthlyEarnings,
        total: totalEarnings,
      },
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
  const formattedSubscriptions = latestSubscriptions.map((sub) => {
    // Get the latest payment amount (initial purchase)
    const latestPayment = sub.payments && sub.payments.length > 0
      ? sub.payments[sub.payments.length - 1]
      : null;
    
    const purchaseAmount = latestPayment?.amount || sub.amount || 0;

    return {
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
      purchaseAmount: purchaseAmount,
    };
  });

  res.json({
    message: "Latest subscriptions fetched successfully",
    data: formattedSubscriptions,
  });
});

/**
 * Get monthly earnings breakdown for chart (daily earnings for current month)
 * @route GET /api/admin/dashboard/monthly-earnings
 * @access Private
 */
exports.getMonthlyEarnings = catchAsync(async (req, res) => {
  const startOfMonth = moment.utc().startOf("month").toDate();
  const endOfMonth = moment.utc().endOf("month").toDate();
  const currentDate = moment.utc();

  // Get daily subscription payments for current month
  const dailySubscriptionPayments = await SubscriptionHistory.aggregate([
    {
      $unwind: {
        path: "$payments",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $match: {
        "payments.paymentTime": {
          $gte: startOfMonth,
          $lte: endOfMonth,
        },
        "payments.status": "completed",
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$payments.paymentTime",
          },
        },
        amount: { $sum: "$payments.amount" },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Get daily top-up payments for current month
  const dailyTopUps = await TopUpHistory.aggregate([
    {
      $match: {
        status: "executed",
        createdAt: {
          $gte: startOfMonth,
          $lte: endOfMonth,
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
          },
        },
        amount: { $sum: "$usdPrice" },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Create a map for quick lookup
  const earningsMap = new Map();
  
  // Initialize all days in current month with 0
  const daysInMonth = currentDate.daysInMonth();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = moment.utc().date(day).format("YYYY-MM-DD");
    earningsMap.set(dateStr, 0);
  }

  // Add subscription payments
  dailySubscriptionPayments.forEach((item) => {
    const current = earningsMap.get(item._id) || 0;
    earningsMap.set(item._id, current + item.amount);
  });

  // Add top-up payments
  dailyTopUps.forEach((item) => {
    const current = earningsMap.get(item._id) || 0;
    earningsMap.set(item._id, current + item.amount);
  });

  // Convert to array format for chart
  const dailyEarnings = Array.from(earningsMap.entries())
    .map(([date, amount]) => ({
      date,
      amount: parseFloat(amount.toFixed(2)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    message: "Monthly earnings fetched successfully",
    data: dailyEarnings,
  });
});
