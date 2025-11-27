const catchAsync = require("../../exception/catchAsync");
const AppError = require("../../exception/AppError");
const SubscriptionPlan = require("../../model/SubscriptionPlan");
const SubscriptionHistory = require("../../model/SubscriptionHistory");
const User = require("../../model/User");
const BalanceService = require("../../services/BalanceService");
const moment = require("moment");
const SimpleValidator = require("../../validator/simpleValidator");

/**
 * Get all active subscription plans for users
 * Sorted by sortOrder
 * 
 * @route GET /api/user/subscriptions/plans
 * @access Private
 */
exports.getSubscriptionPlans = catchAsync(async (req, res) => {
  const plans = await SubscriptionPlan.find({
    status: "active",
  })
    .sort({ sortOrder: 1, createdAt: 1 })
    .select("-stripeMonthlyPriceId -stripeYearlyPriceId -paypalMonthlyPlanId -paypalYearlyPlanId -paddleMonthlyPlanId -paddleYearlyPlanId");

  res.json({
    status: "success",
    message: "Subscription plans fetched successfully",
    data: plans,
  });
});

/**
 * Subscribe to a subscription plan
 * Adds credits to user's balance based on the plan
 * 
 * @route POST /api/user/subscriptions/subscribe
 * @access Private
 */
exports.subscribeToPlan = catchAsync(async (req, res) => {
  const { user } = req;

  // Validate input
  await SimpleValidator(req.body, {
    planId: "required|string",
    intervalType: "required|string|in:month,year",
  });

  const { planId, intervalType } = req.body;

  // Find the subscription plan
  const plan = await SubscriptionPlan.findOne({
    _id: planId,
    status: "active",
  });

  if (!plan) {
    throw new AppError("Subscription plan not found or inactive", 404);
  }

  // Handle custom plans - return contact form link instead of processing subscription
  if (plan.isCustom) {
    if (!plan.contactFormLink) {
      throw new AppError("Contact form link not configured for this custom plan", 400);
    }
    
    return res.status(200).json({
      status: "success",
      message: "Custom plan - redirect to contact form",
      data: {
        isCustom: true,
        contactFormLink: plan.contactFormLink,
        plan: {
          _id: plan._id,
          name: plan.name,
          subtitle: plan.subtitle,
        },
      },
    });
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
  let currentUser = await User.findById(user._id);
  if (!currentUser) {
    throw new AppError("User not found", 404);
  }

  // Find existing active subscription (user can only have ONE active subscription)
  const existingActiveSubscription = await SubscriptionHistory.findOne({
    user: user._id,
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
    upgradeNote = `Upgraded from ${oldPlanName} to ${plan.name}. Remaining balance: ${remainingBalanceFromOldSubscription} credits transferred.`;
    
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

  // Create new subscription history
  const subscriptionHistory = await SubscriptionHistory.create({
    user: user._id,
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
      ? `Subscribed to ${plan.name} - ${paymentCycle}. Upgraded from previous plan with ${remainingBalanceFromOldSubscription} credits transferred.`
      : `Subscribed to ${plan.name} - ${paymentCycle}`,
    status: "active",
    amount: totalCreditsToAdd,
    currentCycleBalance: totalCreditsToAdd,
    transactionType: "manual",
    transactionId: `manual_${Date.now()}_${user._id}`,
  });

  // Create credit transaction for the new subscription credits
  await BalanceService.createTransaction({
    userId: user._id,
    amount: creditToAdd,
    type: "credit",
    source: unlimitedCredit === "yes" 
      ? "subscriptionWithUnlimitedCredit" 
      : "subscription",
    subscriptionPlan: plan._id,
    subscriptionHistory: subscriptionHistory._id,
    remarks: `Subscription: ${plan.name} - ${paymentCycle}`,
  });

  // If there was a balance transfer, create a transaction for that too
  if (remainingBalanceFromOldSubscription > 0) {
    await BalanceService.createTransaction({
      userId: user._id,
      amount: remainingBalanceFromOldSubscription,
      type: "credit",
      source: "subscriptionUpgrade",
      subscriptionPlan: plan._id,
      subscriptionHistory: subscriptionHistory._id,
      remarks: `Balance transferred from upgraded subscription`,
    });
  }

  // Update user model directly with accumulated balance and subscription info
  await User.findByIdAndUpdate(user._id, {
    monthlySubscriptionCreditBalance: newSubscriptionBalance,
    subscriptionExpiresAt,
    subscriptionStatus: "active",
    subscriptionPlan: plan._id,
  });

  // Get updated user
  const updatedUser = await User.findById(user._id).select(
    "topUpCreditBalance monthlySubscriptionCreditBalance subscriptionExpiresAt subscriptionStatus subscriptionPlan"
  );

  // Get balance summary
  const balanceSummary = await BalanceService.getBalanceSummary(user._id);

  res.status(201).json({
    status: "success",
    message: existingActiveSubscription 
      ? "Successfully upgraded subscription plan" 
      : "Successfully subscribed to plan",
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

/**
 * Get user's subscription history
 * 
 * @route GET /api/user/subscriptions/history
 * @access Private
 */
exports.getSubscriptionHistory = catchAsync(async (req, res) => {
  const { user } = req;
  const { status } = req.query;

  let matchQuery = {
    user: user._id,
  };

  if (status) {
    matchQuery.status = status;
  }

  const subscriptions = await SubscriptionHistory.aggregate([
    {
      $match: matchQuery,
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
      $sort: { createdAt: -1 },
    },
  ]);

  res.json({
    status: "success",
    message: "Subscription history fetched successfully",
    data: subscriptions,
  });
});

