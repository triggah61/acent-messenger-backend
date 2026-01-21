const catchAsync = require("../../exception/catchAsync");
const AppError = require("../../exception/AppError");
const SubscriptionPlan = require("../../model/SubscriptionPlan");
const SubscriptionHistory = require("../../model/SubscriptionHistory");
const User = require("../../model/User");
const BalanceService = require("../../services/BalanceService");
const googlePlayBillingService = require("../../services/GooglePlayBillingService");
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
    // Only return plans that are synced with Google Play or are custom plans
    $or: [
      { isCustom: true }, // Custom plans don't need Google Play sync
      { 
        googlePlaySyncStatus: "synced", // Only synced plans
        $or: [
          { googlePlayMonthlySubscriptionId: { $exists: true, $ne: null } },
          { googlePlayAnnualSubscriptionId: { $exists: true, $ne: null } }
        ]
      }
    ]
  })
    .sort({ sortOrder: 1, createdAt: 1 })
    .select("-stripeMonthlyPriceId -stripeYearlyPriceId -paypalMonthlyPlanId -paypalYearlyPlanId -paddleMonthlyPlanId -paddleYearlyPlanId");
    // Note: Google Play product IDs are included in response for client to query Google Play Store

  console.log(`SubscriptionController: Found ${plans.length} active and synced plans`);

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

/**
 * Verify and process Google Play subscription purchase
 * 
 * @route POST /api/user/subscriptions/verify-google-play
 * @access Private
 */
exports.verifyGooglePlaySubscription = catchAsync(async (req, res) => {
  const { user } = req;

  // Validate input
  await SimpleValidator(req.body, {
    purchaseToken: "required|string",
    subscriptionId: "required|string",
    planId: "required|string",
    intervalType: "required|string|in:month,year",
  });

  const { purchaseToken, subscriptionId, planId, intervalType } = req.body;

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
    throw new AppError("Cannot subscribe to custom plan via Google Play", 400);
  }

  // Check if this purchase has already been processed (idempotency)
  const existingSubscription = await SubscriptionHistory.findOne({
    user: user._id,
    googlePlayPurchaseToken: purchaseToken,
    status: "active",
  });

  if (existingSubscription) {
    // Purchase already processed, return success with existing record
    const balanceSummary = await BalanceService.getBalanceSummary(user._id);
    return res.status(200).json({
      status: "success",
      message: "Subscription already processed",
      data: {
        subscription: existingSubscription,
        balance: balanceSummary,
        alreadyProcessed: true,
      },
    });
  }

  // Verify subscription with Google Play
  let purchaseVerification;
  try {
    purchaseVerification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );
  } catch (error) {
    console.error("SubscriptionController: Google Play verification error:", error);
    throw new AppError(
      `Subscription verification failed: ${error.message}`,
      error.statusCode || 500
    );
  }

  // Check if subscription is valid and active
  if (!purchaseVerification.valid || !purchaseVerification.active) {
    throw new AppError("Invalid or expired subscription", 400);
  }

  // Check if subscription is already acknowledged
  if (purchaseVerification.acknowledgementState === 1) {
    // Already acknowledged, but not in our database - might be a duplicate
    // Check by order ID
    if (purchaseVerification.orderId) {
      const existingByOrderId = await SubscriptionHistory.findOne({
        googlePlayOrderId: purchaseVerification.orderId,
        status: "active",
      });

      if (existingByOrderId) {
        const balanceSummary = await BalanceService.getBalanceSummary(user._id);
        return res.status(200).json({
          status: "success",
          message: "Subscription already processed",
          data: {
            subscription: existingByOrderId,
            balance: balanceSummary,
            alreadyProcessed: true,
          },
        });
      }
    }
  }

  // Determine credit amount and expiration date based on interval type
  let creditToAdd = 0;
  let subscriptionExpiresAt = null;
  let paymentCycle = "Monthly";
  let totalCycle = 1;

  if (intervalType === "month") {
    creditToAdd = Number(plan.monthlyCredit);
    subscriptionExpiresAt = new Date(purchaseVerification.expiryTimeMillis);
    paymentCycle = "Monthly";
    totalCycle = 1;
  } else if (intervalType === "year") {
    creditToAdd = Number(plan.annualMonthlyCredit);
    subscriptionExpiresAt = new Date(purchaseVerification.expiryTimeMillis);
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

  // Calculate total credits to add
  // On upgrade: Transfer remaining balance from old subscription (one-time transfer)
  // On next monthly distribution/renewal: Balance will reset to new credits only (use it or lose it)
  const totalCreditsToAdd = Number(creditToAdd) + Number(remainingBalanceFromOldSubscription);

  // Get current subscription balance from user model
  const currentSubscriptionBalance = Number(currentUser.monthlySubscriptionCreditBalance ?? 0);
  
  // Calculate new balance:
  // - Upgrade: Transfer old balance + new credits (will reset on next cycle)
  // - New purchase: Reset to new credits only (old balance expires)
  const expiredCredits = existingActiveSubscription ? 0 : currentSubscriptionBalance;
  const newSubscriptionBalance = existingActiveSubscription 
    ? currentSubscriptionBalance + totalCreditsToAdd // Upgrade: add transferred balance
    : totalCreditsToAdd; // New purchase: reset to new credits (old balance expires)

  // Prepare purchase start and expiry dates
  const purchaseStartDate = purchaseVerification.startTimeMillis 
    ? new Date(purchaseVerification.startTimeMillis) 
    : new Date();
  
  // Determine price from plan
  let purchaseAmount = 0;
  if (intervalType === "month" || intervalType === "monthly") {
    purchaseAmount = Number(plan.monthlyPrice || 0);
  } else {
    purchaseAmount = Number(plan.annualPrice || plan.monthlyPrice * 12 || 0);
  }

  // Create new subscription history with events and payments
  const subscriptionHistory = await SubscriptionHistory.create({
    user: user._id,
    subscriptionPlan: plan._id,
    cycleType: paymentCycle,
    totalCycle,
    cycleCompleted: 1,
    nextCycleAt: intervalType === "year" 
      ? moment.utc().add(1, "month").toDate() 
      : null,
    subscriptionStartedAt: purchaseStartDate,
    subscriptionEndDate: subscriptionExpiresAt,
    membership: "pro",
    remarks: remainingBalanceFromOldSubscription > 0
      ? `Subscribed to ${plan.name} - ${paymentCycle} via Google Play. Upgraded from previous plan with ${remainingBalanceFromOldSubscription} credits transferred.`
      : `Subscribed to ${plan.name} - ${paymentCycle} via Google Play`,
    status: "active",
    amount: purchaseAmount,
    currentCycleBalance: totalCreditsToAdd,
    transactionType: "google_play",
    transactionId: purchaseVerification.orderId || `google_play_${Date.now()}_${user._id}`,
    googlePlayPurchaseToken: purchaseToken,
    googlePlayOrderId: purchaseVerification.orderId || null,
    googlePlayTransactionId: purchaseVerification.orderId || null,
    googlePlayProductId: subscriptionId,
    googlePlayAcknowledged: purchaseVerification.acknowledgementState === 1,
    autoRenewing: purchaseVerification.autoRenewing !== false,
    renewalCount: 0,
    totalAmountPaid: purchaseAmount,
    totalCreditsReceived: totalCreditsToAdd,
    // Initial event
    events: [{
      eventType: remainingBalanceFromOldSubscription > 0 ? "UPGRADE" : "SUBSCRIPTION_PURCHASED",
      eventTime: new Date(),
      orderId: purchaseVerification.orderId,
      purchaseToken: purchaseToken,
      expiryTimeAtEvent: subscriptionExpiresAt,
      autoRenewingAtEvent: purchaseVerification.autoRenewing !== false,
      creditsChanged: totalCreditsToAdd,
      source: 'app_purchase',
      metadata: {
        subscriptionId,
        planName: plan.name,
        intervalType,
        wasUpgrade: remainingBalanceFromOldSubscription > 0,
        transferredCredits: remainingBalanceFromOldSubscription,
        // Credit expiration tracking (for new purchases, not upgrades)
        expiredCredits: expiredCredits, // Old credits that expired (use it or lose it)
        previousBalance: expiredCredits,
        newBalance: newSubscriptionBalance,
      },
    }],
    // Initial payment record
    payments: [{
      paymentTime: purchaseStartDate,
      amount: purchaseAmount,
      currency: 'USD',
      orderId: purchaseVerification.orderId,
      transactionId: purchaseVerification.orderId,
      status: 'completed',
      paymentType: remainingBalanceFromOldSubscription > 0 ? 'upgrade' : 'initial',
      periodStart: purchaseStartDate,
      periodEnd: subscriptionExpiresAt,
      creditsGranted: totalCreditsToAdd,
      metadata: {
        subscriptionId,
        purchaseToken,
        planName: plan.name,
        source: 'google_play',
      },
    }],
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
    remarks: `Subscription: ${plan.name} - ${paymentCycle} (Google Play)`,
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

  // Sync currentCycleBalance to match monthlySubscriptionCreditBalance
  // This ensures currentCycleBalance always reflects the actual remaining balance
  await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
    currentCycleBalance: newSubscriptionBalance,
  });

  // Acknowledge subscription with Google Play (if not already acknowledged)
  if (purchaseVerification.acknowledgementState === 0) {
  try {
      await googlePlayBillingService.acknowledgeSubscription(
        purchaseToken,
        subscriptionId
      );
      // Update subscription history
      await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
        googlePlayAcknowledged: true,
      });
    } catch (ackError) {
      console.error(
        "SubscriptionController: Failed to acknowledge subscription:",
        ackError
      );
      // Don't fail the request if acknowledgment fails - subscription is already processed
    }
  }

  // Get balance summary
  const balanceSummary = await BalanceService.getBalanceSummary(user._id);

  // Send to Facebook Conversions API (only if user has attribution)
  // Do this asynchronously so it doesn't block the response
  const facebookConversionsService = require("../../services/FacebookConversionsService");
  facebookConversionsService
    .sendPurchaseEvent({
      user: currentUser,
      eventName: "Purchase",
      value: purchaseAmount,
      currency: "USD",
      contentIds: [plan._id.toString()],
      contentType: "subscription",
      contentName: plan.name,
      orderId: purchaseVerification.orderId,
      purchaseToken: purchaseToken,
    })
    .then((result) => {
      if (result.success) {
        console.log("✅ Facebook conversion tracked for subscription");
      } else if (result.reason === "no_attribution") {
        console.log("ℹ️ Skipped Facebook conversion - no attribution");
      } else {
        console.log("⚠️ Facebook conversion failed:", result.error);
      }
    })
    .catch((error) => {
      console.error("❌ Facebook conversion error:", error);
      // Don't fail the purchase if Facebook API fails
    });

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
      purchase: {
        orderId: purchaseVerification.orderId,
        autoRenewing: purchaseVerification.autoRenewing,
        expiryTime: purchaseVerification.expiryTimeMillis,
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

