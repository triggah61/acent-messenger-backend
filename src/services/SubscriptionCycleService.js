const moment = require("moment");
const mongoose = require("mongoose");
const User = require("../model/User");
const SubscriptionHistory = require("../model/SubscriptionHistory");
const SubscriptionPlan = require("../model/SubscriptionPlan");
const BalanceService = require("./BalanceService");
const logger = require("../config/logger");

/**
 * Process subscription cycles
 * Finds active subscriptions that need cycle processing and handles:
 * 1. Incrementing cycleCompleted
 * 2. Adding credits to user balance
 * 3. Updating nextCycleAt
 * 4. Creating credit transactions
 * 5. Marking expired subscriptions
 * 
 * @returns {Promise<Object>} Processing results
 */
exports.processSubscriptionCycles = async () => {
  const now = moment.utc().toDate();
  let processedCount = 0;
  let expiredCount = 0;
  let errorCount = 0;
  const errors = [];

  try {
    // Find active subscriptions that need cycle processing
    // Conditions:
    // 1. status = "active"
    // 2. cycleCompleted < totalCycle (has more cycles)
    // 3. nextCycleAt < now (time for next cycle)
    // Note: We'll filter cycleCompleted < totalCycle in code since MongoDB find doesn't support field comparison
    const subscriptionsToProcess = await SubscriptionHistory.find({
      status: "active",
      nextCycleAt: { $ne: null, $lt: now },
    })
      .populate("subscriptionPlan")
      .populate("user");

    // Filter subscriptions where cycleCompleted < totalCycle
    const validSubscriptions = subscriptionsToProcess.filter(
      (sub) => sub.cycleCompleted < sub.totalCycle
    );

    logger.info(`Found ${validSubscriptions.length} subscriptions to process for cycle renewal`);

    // Process each subscription
    for (const subscription of validSubscriptions) {
      try {
        // Verify the subscription still meets criteria (double-check)
        if (
          subscription.status !== "active" ||
          subscription.cycleCompleted >= subscription.totalCycle ||
          !subscription.nextCycleAt ||
          moment.utc(subscription.nextCycleAt).toDate() >= now
        ) {
          continue;
        }

        const plan = subscription.subscriptionPlan;
        const user = subscription.user;

        if (!plan || !user) {
          logger.warn(`Subscription ${subscription._id} missing plan or user reference`);
          continue;
        }

        // Determine credit amount for this cycle
        // For yearly subscriptions (totalCycle > 1), use annualMonthlyCredit (monthly credit for yearly plan)
        // For monthly subscriptions (totalCycle = 1), use monthlyCredit
        // Note: Monthly subscriptions shouldn't have nextCycleAt, but handle it just in case
        let creditPerCycle = 0;
        if (subscription.totalCycle > 1) {
          // Yearly subscription - use monthly credit amount
          creditPerCycle = Number(plan.annualMonthlyCredit || 0);
        } else {
          // Monthly subscription - use monthly credit amount
          creditPerCycle = Number(plan.monthlyCredit || 0);
        }

        // Handle unlimited credit
        if (plan.unlimitedCredit === "yes") {
          creditPerCycle = Number(plan.unlimitedCreditCap || 0);
        }

        if (creditPerCycle <= 0) {
          logger.warn(`Subscription ${subscription._id} has zero or negative credit per cycle`);
          continue;
        }

        // Calculate new cycle completed
        const newCycleCompleted = subscription.cycleCompleted + 1;
        const isLastCycle = newCycleCompleted >= subscription.totalCycle;

        // Calculate next cycle date (if not last cycle)
        let nextCycleAt = null;
        if (!isLastCycle) {
          // Set nextCycleAt to 1 month from current nextCycleAt
          nextCycleAt = moment.utc(subscription.nextCycleAt).add(1, "month").toDate();
        }

        // Get user ID (handle both ObjectId and populated object)
        const userId = user._id ? user._id.toString() : user.toString();

        // Get current user balance
        const currentUser = await User.findById(userId);
        if (!currentUser) {
          logger.warn(`User not found for subscription ${subscription._id}`);
          continue;
        }

        const currentSubscriptionBalance = Number(currentUser.monthlySubscriptionCreditBalance || 0);
        const newSubscriptionBalance = currentSubscriptionBalance + creditPerCycle;

        // Update subscription history
        const cycleNote = `Cycle ${newCycleCompleted} of ${subscription.totalCycle} completed. Added ${creditPerCycle} credits.`;
        const updatedRemarks = subscription.remarks
          ? `${subscription.remarks} | ${cycleNote}`
          : cycleNote;

        await SubscriptionHistory.findByIdAndUpdate(subscription._id, {
          cycleCompleted: newCycleCompleted,
          nextCycleAt: nextCycleAt,
          currentCycleBalance: (subscription.currentCycleBalance || 0) + creditPerCycle,
          remarks: updatedRemarks,
        });

        // Update user balance
        await User.findByIdAndUpdate(userId, {
          monthlySubscriptionCreditBalance: newSubscriptionBalance,
        });

        // Create credit transaction
        const planId = plan._id ? plan._id.toString() : plan.toString();
        await BalanceService.createTransaction({
          userId: userId,
          amount: creditPerCycle,
          type: "credit",
          source: plan.unlimitedCredit === "yes"
            ? "subscriptionCycleWithUnlimitedCredit"
            : "subscriptionCycle",
          subscriptionPlan: planId,
          subscriptionHistory: subscription._id.toString(),
          remarks: `Subscription cycle ${newCycleCompleted}/${subscription.totalCycle}: ${plan.name} - ${creditPerCycle} credits added`,
        });

        processedCount++;
        logger.info(
          `Processed cycle ${newCycleCompleted}/${subscription.totalCycle} for subscription ${subscription._id}, user ${userId}`
        );
      } catch (error) {
        errorCount++;
        errors.push({
          subscriptionId: subscription._id,
          error: error.message,
        });
        logger.error(`Error processing subscription ${subscription._id}:`, error);
      }
    }

    // Now handle expired subscriptions
    // Find subscriptions where:
    // 1. status = "active"
    // 2. subscriptionEndDate < now (subscription has ended)
    // Note: We'll filter cycleCompleted == totalCycle in code
    const subscriptionsToExpire = await SubscriptionHistory.find({
      status: "active",
      subscriptionEndDate: { $ne: null, $lt: now },
    })
      .populate("user")
      .populate("subscriptionPlan");

    // Filter subscriptions where cycleCompleted == totalCycle
    const validExpiredSubscriptions = subscriptionsToExpire.filter(
      (sub) => sub.cycleCompleted >= sub.totalCycle
    );

    logger.info(`Found ${validExpiredSubscriptions.length} subscriptions to mark as expired`);

    for (const subscription of validExpiredSubscriptions) {
      try {
        // Double-check conditions
        if (
          subscription.status !== "active" ||
          subscription.cycleCompleted < subscription.totalCycle ||
          !subscription.subscriptionEndDate ||
          moment.utc(subscription.subscriptionEndDate).toDate() >= now
        ) {
          continue;
        }

        // Mark subscription as expired
        await SubscriptionHistory.findByIdAndUpdate(subscription._id, {
          status: "expired",
          cancellationReason: "Subscription completed all cycles and end date has passed",
          remarks: subscription.remarks
            ? `${subscription.remarks} | Subscription expired after completing all cycles`
            : "Subscription expired after completing all cycles",
        });

        // Update user subscription status if this is their active subscription
        const user = subscription.user;
        if (user) {
          const userId = user._id ? user._id.toString() : user.toString();
          const subscriptionPlanId = subscription.subscriptionPlan ? subscription.subscriptionPlan.toString() : null;
          const currentUser = await User.findById(userId);
          
          if (currentUser && subscriptionPlanId && currentUser.subscriptionPlan && currentUser.subscriptionPlan.toString() === subscriptionPlanId) {
            await User.findByIdAndUpdate(userId, {
              subscriptionStatus: "expired",
            });
          }
        }

        expiredCount++;
        logger.info(`Marked subscription ${subscription._id} as expired`);
      } catch (error) {
        errorCount++;
        errors.push({
          subscriptionId: subscription._id,
          error: error.message,
        });
        logger.error(`Error expiring subscription ${subscription._id}:`, error);
      }
    }

    return {
      success: true,
      processed: processedCount,
      expired: expiredCount,
      errors: errorCount,
      errorDetails: errors,
    };
  } catch (error) {
    logger.error("Error in processSubscriptionCycles:", error);
    return {
      success: false,
      processed: processedCount,
      expired: expiredCount,
      errors: errorCount + 1,
      errorDetails: [...errors, { error: error.message }],
    };
  }
};

