const moment = require("moment");
const mongoose = require("mongoose");
const User = require("../model/User");
const AppError = require("../exception/AppError");
const SubscriptionHistory = require("../model/SubscriptionHistory");
const SubscriptionPlan = require("../model/SubscriptionPlan");
const CreditTransaction = require("../model/CreditTransaction");

/**
 * Get available credit balance for a user
 * This includes both top-up balance and subscription balance
 * Subscription balance is checked for expiration
 * 
 * @param {Object} user - User object
 * @returns {Promise<Number>} Total available credit balance
 */
exports.getAvailableCreditBalance = async (user) => {
  let topUpBalance = user?.topUpCreditBalance ?? 0;
  let subscriptionBalance = user?.monthlySubscriptionCreditBalance ?? 0;

  // Check if subscription has expired
  if (user?.subscriptionExpiresAt) {
    if (moment.utc().toDate() > moment.utc(user.subscriptionExpiresAt).toDate()) {
      subscriptionBalance = 0;
    }
  }

  return Number(topUpBalance) + Number(subscriptionBalance);
};

/**
 * Deduct credit from user's balance
 * Priority: Subscription balance first, then top-up balance
 * 
 * @param {String} userId - User ID
 * @param {Number} amount - Amount to deduct
 * @param {String} consumptionReason - Reason for consumption
 * @returns {Promise<Boolean>} True if deduction was successful
 * @throws {AppError} If insufficient balance
 */
exports.deductCredit = async (userId, amount, consumptionReason = "") => {
  let user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  // Get balances directly from User model (source of truth)
  let topUpBalance = Number(user?.topUpCreditBalance ?? 0);
  let subscriptionBalance = Number(user?.monthlySubscriptionCreditBalance ?? 0);

  // Check if subscription has expired
  if (user?.subscriptionExpiresAt) {
    const now = moment.utc().toDate();
    const expiresAt = moment.utc(user.subscriptionExpiresAt).toDate();
    if (now > expiresAt) {
      // Subscription expired, set balance to 0 and update status
      subscriptionBalance = 0;
      await User.findByIdAndUpdate(userId, {
        monthlySubscriptionCreditBalance: 0,
        subscriptionStatus: "expired",
      });
    }
  }

  let totalBalance = topUpBalance + subscriptionBalance;
  
  if (amount > totalBalance) {
    throw new AppError("Insufficient credit balance", 422);
  }

  let subscriptionDeductable = amount;
  let topUpDeductable = 0;

  // Deduct from subscription balance first, then top-up
  if (amount > subscriptionBalance) {
    subscriptionDeductable = subscriptionBalance;
    topUpDeductable = amount - subscriptionDeductable;
  }

  // Calculate new balances
  const newSubscriptionBalance = subscriptionBalance - subscriptionDeductable;
  const newTopUpBalance = topUpBalance - topUpDeductable;

  // Create transaction record
  await CreditTransaction.create({
    user: user._id,
    source: consumptionReason,
    amount: amount,
    type: "debit",
    status: "active",
  });

  // Update user balances directly in User model
  await User.findByIdAndUpdate(userId, {
    monthlySubscriptionCreditBalance: newSubscriptionBalance,
    topUpCreditBalance: newTopUpBalance,
  });

  // Update active subscription's currentCycleBalance if subscription credits were deducted
  if (subscriptionDeductable > 0) {
    // Find the first active subscription (user should only have one, but pick first if multiple)
    const activeSubscription = await SubscriptionHistory.findOne({
      user: new mongoose.Types.ObjectId(userId),
      status: "active",
      $or: [
        { subscriptionEndDate: { $gte: moment.utc().toDate() } },
        { subscriptionEndDate: null },
      ],
    })
      .sort({ createdAt: -1 }); // Latest first

    if (activeSubscription) {
      // Update currentCycleBalance to match the new subscription balance
      // This ensures currentCycleBalance always reflects the actual remaining balance
      await SubscriptionHistory.findByIdAndUpdate(activeSubscription._id, {
        currentCycleBalance: newSubscriptionBalance,
      });
    }
  }

  return true;
};

/**
 * Sync user's subscription status and expiration
 * Marks expired subscriptions as expired and updates user subscription info
 * Ensures only ONE active subscription exists (marks others as upgraded)
 * Note: Balance is now stored in User model, not calculated from SubscriptionHistory
 * 
 * @param {String} userId - User ID
 * @returns {Promise<Boolean>} True if sync was successful
 */
exports.syncUserBalanceFromSubscriptions = async (userId) => {
  const now = moment.utc().toDate();
  
  // Mark expired subscriptions as expired
  await SubscriptionHistory.updateMany(
    {
      user: new mongoose.Types.ObjectId(userId),
      status: "active",
      subscriptionEndDate: { $lt: now },
    },
    {
      status: "expired",
    }
  );

  // Get all active (non-expired) subscriptions
  const activeSubscriptions = await SubscriptionHistory.find({
    user: new mongoose.Types.ObjectId(userId),
    status: "active",
    $or: [
      { subscriptionEndDate: { $gte: now } },
      { subscriptionEndDate: null },
    ],
  })
    .sort({ createdAt: -1 }); // Latest first

  // If user has multiple active subscriptions, mark all but the latest as upgraded
  if (activeSubscriptions.length > 1) {
    const latestSubscription = activeSubscriptions[0];
    const olderSubscriptions = activeSubscriptions.slice(1);
    
    for (const oldSub of olderSubscriptions) {
      const latestPlan = await SubscriptionPlan.findById(latestSubscription.subscriptionPlan);
      const oldPlan = await SubscriptionPlan.findById(oldSub.subscriptionPlan);
      const upgradeNote = `Upgraded to ${latestPlan?.name || 'new plan'}. Multiple active subscriptions consolidated.`;
      
      await SubscriptionHistory.findByIdAndUpdate(oldSub._id, {
        status: "upgraded",
        cancellationReason: upgradeNote,
        remarks: oldSub.remarks 
          ? `${oldSub.remarks} | ${upgradeNote}`
          : upgradeNote,
      });
    }
  }

  // Get the latest active subscription (user should only have one now)
  const activeSubscription = activeSubscriptions.length > 0 ? activeSubscriptions[0] : null;

  // Update user subscription info (balance is already in User model)
  const updateData = {};

  if (activeSubscription) {
    updateData.subscriptionExpiresAt = activeSubscription.subscriptionEndDate;
    updateData.subscriptionPlan = activeSubscription.subscriptionPlan;
    updateData.subscriptionStatus = "active";
    
    // Sync currentCycleBalance with monthlySubscriptionCreditBalance
    // Get current user balance
    const user = await User.findById(userId);
    if (user) {
      const currentBalance = Number(user.monthlySubscriptionCreditBalance || 0);
      // Update subscription's currentCycleBalance to match user's balance
      // This ensures they stay in sync
      await SubscriptionHistory.findByIdAndUpdate(activeSubscription._id, {
        currentCycleBalance: currentBalance,
      });
    }
  } else {
    // Check if subscription expired
    const user = await User.findById(userId);
    if (user?.subscriptionExpiresAt) {
      const expiresAt = moment.utc(user.subscriptionExpiresAt).toDate();
      if (now > expiresAt) {
        // Subscription expired, zero out balance
        updateData.subscriptionStatus = "expired";
        updateData.monthlySubscriptionCreditBalance = 0;
      } else {
        updateData.subscriptionStatus = "none";
      }
    } else {
      updateData.subscriptionStatus = "none";
    }
    updateData.subscriptionExpiresAt = null;
    updateData.subscriptionPlan = null;
  }

  if (Object.keys(updateData).length > 0) {
    await User.findByIdAndUpdate(userId, updateData);
  }

  return true;
};

/**
 * Get balance summary for a user
 * Balance is read directly from User model (source of truth)
 * 
 * @param {String} userId - User ID
 * @returns {Promise<Object>} Balance summary object
 */
exports.getBalanceSummary = async (userId) => {
  // Sync subscription status (expiration, etc.) but not balance
  await exports.syncUserBalanceFromSubscriptions(userId);

  const user = await User.findById(userId).select(
    "topUpCreditBalance monthlySubscriptionCreditBalance subscriptionExpiresAt subscriptionStatus subscriptionPlan"
  );

  if (!user) {
    throw new AppError("User not found", 404);
  }

  // Get balances directly from User model
  let topUpBalance = Number(user?.topUpCreditBalance ?? 0);
  let subscriptionBalance = Number(user?.monthlySubscriptionCreditBalance ?? 0);
  let isSubscriptionExpired = false;

  // Check if subscription has expired
  if (user?.subscriptionExpiresAt) {
    const now = moment.utc().toDate();
    const expiresAt = moment.utc(user.subscriptionExpiresAt).toDate();
    if (now > expiresAt) {
      isSubscriptionExpired = true;
      // If expired, balance should already be 0, but ensure it
      if (subscriptionBalance > 0) {
        subscriptionBalance = 0;
        // Update user model if balance is not zero
        await User.findByIdAndUpdate(userId, {
          monthlySubscriptionCreditBalance: 0,
          subscriptionStatus: "expired",
        });
      }
    }
  }

  const totalBalance = Number(topUpBalance) + Number(subscriptionBalance);

  return {
    topUpBalance: Number(topUpBalance),
    subscriptionBalance: Number(subscriptionBalance),
    totalBalance: Number(totalBalance),
    subscriptionExpiresAt: user?.subscriptionExpiresAt || null,
    isSubscriptionExpired,
    subscriptionStatus: user?.subscriptionStatus || "none",
    subscriptionPlan: user?.subscriptionPlan || null,
  };
};

/**
 * Create a credit transaction
 * 
 * @param {Object} transactionData - Transaction data
 * @param {String} transactionData.userId - User ID
 * @param {Number} transactionData.amount - Transaction amount
 * @param {String} transactionData.type - Transaction type (credit/debit)
 * @param {String} transactionData.source - Source/reason for transaction
 * @param {String} [transactionData.subscriptionPlan] - Subscription plan ID
 * @param {String} [transactionData.subscriptionHistory] - Subscription history ID
 * @param {String} [transactionData.topUpHistory] - Top-up history ID
 * @param {String} [transactionData.remarks] - Additional remarks
 * @returns {Promise<Object>} Created transaction
 */
exports.createTransaction = async (transactionData) => {
  const {
    userId,
    amount,
    type,
    source,
    subscriptionPlan = null,
    subscriptionHistory = null,
    topUpHistory = null,
    remarks = null,
  } = transactionData;

  if (!userId || !amount || !type || !source) {
    throw new AppError("Missing required transaction fields", 400);
  }

  if (!["credit", "debit"].includes(type)) {
    throw new AppError("Invalid transaction type", 400);
  }

  if (amount <= 0) {
    throw new AppError("Transaction amount must be greater than 0", 400);
  }

  const transaction = await CreditTransaction.create({
    user: userId,
    amount: Number(amount),
    type,
    source,
    subscriptionPlan,
    subscriptionHistory,
    topUpHistory,
    remarks,
    status: "active",
  });

  return transaction;
};
