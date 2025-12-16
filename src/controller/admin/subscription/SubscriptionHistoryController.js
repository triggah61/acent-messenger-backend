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
    status,
  } = req.query;

  // Build match query
  const matchQuery = {};

  // Filter by status if provided and not "all"
  if (status && status !== "all") {
    matchQuery.status = status;
  }

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

/**
 * Get detailed subscription history with events and payments
 * Shows full audit trail of a subscription
 * 
 * @route GET /api/admin/subscription-history/:id/details
 * @access Private
 */
exports.getSubscriptionDetails = catchAsync(async (req, res) => {
  const { id } = req.params;

  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid subscription ID", 400);
  }

  const subscription = await SubscriptionHistory.findById(id)
    .populate("user", "firstName lastName email photo phoneNumber")
    .populate("subscriptionPlan", "name subtitle monthlyPrice annualPrice monthlyCredit annualMonthlyCredit")
    .lean();

  if (!subscription) {
    throw new AppError("Subscription not found", 404);
  }

  // Calculate summary statistics
  const eventsSummary = {
    totalEvents: subscription.events?.length || 0,
    eventTypes: {},
  };

  if (subscription.events && subscription.events.length > 0) {
    subscription.events.forEach((event) => {
      eventsSummary.eventTypes[event.eventType] = 
        (eventsSummary.eventTypes[event.eventType] || 0) + 1;
    });
  }

  const paymentsSummary = {
    totalPayments: subscription.payments?.length || 0,
    totalAmountPaid: subscription.payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0,
    totalCreditsGranted: subscription.payments?.reduce((sum, p) => sum + (p.creditsGranted || 0), 0) || 0,
    paymentsByType: {},
  };

  if (subscription.payments && subscription.payments.length > 0) {
    subscription.payments.forEach((payment) => {
      paymentsSummary.paymentsByType[payment.paymentType] = 
        (paymentsSummary.paymentsByType[payment.paymentType] || 0) + 1;
    });
  }

  // Subscription duration
  let subscriptionDuration = null;
  if (subscription.subscriptionStartedAt) {
    const endDate = subscription.status === "expired" 
      ? subscription.subscriptionEndDate 
      : new Date();
    subscriptionDuration = {
      startDate: subscription.subscriptionStartedAt,
      endDate: subscription.status === "expired" ? subscription.subscriptionEndDate : null,
      daysActive: Math.floor((endDate - new Date(subscription.subscriptionStartedAt)) / (1000 * 60 * 60 * 24)),
    };
  }

  res.json({
    message: "Subscription details fetched successfully",
    data: {
      subscription,
      summary: {
        events: eventsSummary,
        payments: paymentsSummary,
        duration: subscriptionDuration,
        renewalCount: subscription.renewalCount || 0,
        totalAmountPaid: subscription.totalAmountPaid || 0,
        totalCreditsReceived: subscription.totalCreditsReceived || 0,
      },
    },
  });
});

/**
 * Get subscription events history
 * Paginated events for a subscription
 * 
 * @route GET /api/admin/subscription-history/:id/events
 * @access Private
 */
exports.getSubscriptionEvents = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid subscription ID", 400);
  }

  const subscription = await SubscriptionHistory.findById(id)
    .select("events")
    .lean();

  if (!subscription) {
    throw new AppError("Subscription not found", 404);
  }

  // Sort events by date (newest first) and paginate
  const events = (subscription.events || [])
    .sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));
  
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const paginatedEvents = events.slice(startIndex, endIndex);

  res.json({
    message: "Subscription events fetched successfully",
    data: {
      events: paginatedEvents,
      pagination: {
        total: events.length,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(events.length / parseInt(limit)),
      },
    },
  });
});

/**
 * Get subscription payment history
 * Paginated payments for a subscription
 * 
 * @route GET /api/admin/subscription-history/:id/payments
 * @access Private
 */
exports.getSubscriptionPayments = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid subscription ID", 400);
  }

  const subscription = await SubscriptionHistory.findById(id)
    .select("payments")
    .lean();

  if (!subscription) {
    throw new AppError("Subscription not found", 404);
  }

  // Sort payments by date (newest first) and paginate
  const payments = (subscription.payments || [])
    .sort((a, b) => new Date(b.paymentTime) - new Date(a.paymentTime));
  
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const paginatedPayments = payments.slice(startIndex, endIndex);

  // Calculate totals
  const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalCredits = payments.reduce((sum, p) => sum + (p.creditsGranted || 0), 0);

  res.json({
    message: "Subscription payments fetched successfully",
    data: {
      payments: paginatedPayments,
      totals: {
        totalAmount,
        totalCredits,
        paymentCount: payments.length,
      },
      pagination: {
        total: payments.length,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(payments.length / parseInt(limit)),
      },
    },
  });
});

/**
 * Get all subscription history with events and payments summary
 * Enhanced version with more fields for admin dashboard
 * 
 * @route GET /api/admin/subscription-history/all-detailed
 * @access Private
 */
exports.getAllSubscriptionHistoryDetailed = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    userId,
    status,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  // Build match query
  const matchQuery = {};
  
  if (status && status !== "all") {
    matchQuery.status = status;
  }

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
        eventsCount: { $size: { $ifNull: ["$events", []] } },
        paymentsCount: { $size: { $ifNull: ["$payments", []] } },
        latestEvent: { $arrayElemAt: [{ $slice: ["$events", -1] }, 0] },
        latestPayment: { $arrayElemAt: [{ $slice: ["$payments", -1] }, 0] },
      },
    },
    {
      $sort: {
        [sortBy]: sortOrder === "asc" ? 1 : -1,
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
        autoRenewing: 1,
        renewalCount: 1,
        totalAmountPaid: 1,
        totalCreditsReceived: 1,
        lastRenewalAt: 1,
        cancelledAt: 1,
        cancelledBy: 1,
        cancellationReason: 1,
        googlePlayProductId: 1,
        googlePlayAcknowledged: 1,
        transactionType: 1,
        createdAt: 1,
        updatedAt: 1,
        userName: 1,
        userEmail: 1,
        userPhoto: 1,
        planName: 1,
        eventsCount: 1,
        paymentsCount: 1,
        latestEvent: 1,
        latestPayment: 1,
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
    message: "Detailed subscription history fetched successfully",
    data,
  });
});

