const moment = require("moment");
const mongoose = require("mongoose");
const User = require("../model/User");
const SubscriptionHistory = require("../model/SubscriptionHistory");
const SubscriptionPlan = require("../model/SubscriptionPlan");
const BalanceService = require("./BalanceService");
const logger = require("../config/logger");

/**
 * Process subscription cycles
 * 
 * This cron job handles monthly credit distribution for ANNUAL subscriptions:
 * - Annual subscriptions have totalCycle = 12 (or multiples after renewals)
 * - cycleCompleted starts at 1 (first month's credit given at purchase)
 * - Each month, this job increments cycleCompleted and adds annualMonthlyCredit
 * - Example: totalCycle=12, cycleCompleted goes 1->2->3...->12
 * - After renewal: totalCycle=24, cycleCompleted continues 13->14...->24
 * 
 * Monthly subscriptions (totalCycle = cycleCompleted) don't need this processing
 * as they receive all credits at purchase/renewal time.
 * 
 * Processing steps:
 * 1. Find active subscriptions where nextCycleAt has passed
 * 2. Add monthly credit to user balance
 * 3. Increment cycleCompleted
 * 4. Update nextCycleAt for next month (if more cycles remain)
 * 5. Create credit transaction
 * 6. Add event to subscription history
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
    // 2. nextCycleAt is set and has passed (time for next cycle credit)
    // Note: We'll filter cycleCompleted < totalCycle in code since MongoDB find doesn't support field comparison
    const subscriptionsToProcess = await SubscriptionHistory.find({
      status: "active",
      nextCycleAt: { $ne: null, $lt: now },
    })
      .populate("subscriptionPlan")
      .populate("user");

    // Filter subscriptions where cycleCompleted < totalCycle (has more cycles to process)
    const validSubscriptions = subscriptionsToProcess.filter(
      (sub) => sub.cycleCompleted < sub.totalCycle
    );

    logger.info(`SubscriptionCycleService: Found ${validSubscriptions.length} subscriptions to process for monthly credit distribution`);

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
          logger.warn(`SubscriptionCycleService: Subscription ${subscription._id} missing plan or user reference`);
          continue;
        }

        // Determine credit amount for this cycle
        // This is typically for annual subscriptions with monthly credit distribution
        let creditPerCycle = 0;
        
        // Check cycle type to determine correct credit amount
        const isYearly = ["yearly", "Yearly", "year"].includes(subscription.cycleType);
        const isMonthly = ["monthly", "Monthly", "month"].includes(subscription.cycleType);
        
        if (isYearly || subscription.totalCycle > 1) {
          // Annual subscription - use monthly credit amount for yearly plan
          creditPerCycle = Number(plan.annualMonthlyCredit || 0);
        } else if (isMonthly) {
          // Monthly subscription - this shouldn't normally run since nextCycleAt is null
          // But handle it just in case
          creditPerCycle = Number(plan.monthlyCredit || 0);
        } else {
          // Fallback based on totalCycle
          creditPerCycle = subscription.totalCycle > 1
            ? Number(plan.annualMonthlyCredit || 0)
            : Number(plan.monthlyCredit || 0);
        }

        // Handle unlimited credit
        if (plan.unlimitedCredit === "yes") {
          creditPerCycle = Number(plan.unlimitedCreditCap || 0);
        }

        if (creditPerCycle <= 0) {
          logger.warn(`SubscriptionCycleService: Subscription ${subscription._id} has zero or negative credit per cycle`);
          continue;
        }

        // Calculate new cycle completed
        const previousCycleCompleted = subscription.cycleCompleted;
        const newCycleCompleted = previousCycleCompleted + 1;
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
          logger.warn(`SubscriptionCycleService: User not found for subscription ${subscription._id}`);
          continue;
        }

        const currentSubscriptionBalance = Number(currentUser.monthlySubscriptionCreditBalance || 0);
        const expiredCredits = currentSubscriptionBalance; // Old credits expire (use it or lose it)
        
        // RESET balance to new credits only (old credits don't carry over)
        // Each month's credits are independent and expire at the end of that cycle
        const newSubscriptionBalance = creditPerCycle;

        // Re-fetch the subscription document to use addEvent method
        const subscriptionDoc = await SubscriptionHistory.findById(subscription._id);
        if (!subscriptionDoc) {
          logger.warn(`SubscriptionCycleService: Subscription document not found: ${subscription._id}`);
          continue;
        }

        // Add event to subscription history for monthly credit distribution
        if (subscriptionDoc.addEvent) {
          subscriptionDoc.addEvent({
            eventType: "SUBSCRIPTION_RENEWED", // Use RENEWED for monthly credit distribution too
            eventTime: new Date(),
            orderId: subscription.googlePlayOrderId,
            purchaseToken: subscription.googlePlayPurchaseToken,
            expiryTimeAtEvent: subscription.subscriptionEndDate,
            autoRenewingAtEvent: subscription.autoRenewing,
            creditsChanged: creditPerCycle,
            source: 'system',
            metadata: {
              cycleDistribution: true,
              previousCycleCompleted,
              newCycleCompleted,
              totalCycle: subscription.totalCycle,
              isLastCycle,
              nextCycleAt,
              creditType: 'monthly_distribution',
              expiredCredits: expiredCredits, // Track expired credits for audit
              previousBalance: currentSubscriptionBalance,
              newBalance: newSubscriptionBalance,
            },
          });
        }

        // Update subscription history
        const cycleNote = expiredCredits > 0
          ? `Cycle ${newCycleCompleted} of ${subscription.totalCycle} completed. ${expiredCredits} unused credits expired. ${creditPerCycle} new credits added.`
          : `Cycle ${newCycleCompleted} of ${subscription.totalCycle} completed. Added ${creditPerCycle} credits.`;
        const updatedRemarks = subscription.remarks
          ? `${subscription.remarks} | ${cycleNote}`
          : cycleNote;

        subscriptionDoc.cycleCompleted = newCycleCompleted;
        subscriptionDoc.nextCycleAt = nextCycleAt;
        // RESET currentCycleBalance to new credits only (old credits expired)
        // Each month's credits are independent and expire at cycle end
        subscriptionDoc.currentCycleBalance = newSubscriptionBalance;
        subscriptionDoc.remarks = updatedRemarks;
        
        await subscriptionDoc.save();

        // Update user balance - SET to new credits (old credits expired)
        await User.findByIdAndUpdate(userId, {
          monthlySubscriptionCreditBalance: newSubscriptionBalance,
        });
        
        // Log expired credits for audit
        if (expiredCredits > 0) {
          logger.info(
            `SubscriptionCycleService: ⚠️ ${expiredCredits} unused credits expired for subscription ${subscription._id}, user ${userId}`
          );
        }

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
          remarks: `Monthly credit distribution (cycle ${newCycleCompleted}/${subscription.totalCycle}): ${plan.name} - ${creditPerCycle} credits`,
        });

        processedCount++;
        logger.info(
          `SubscriptionCycleService: ✅ Processed cycle ${newCycleCompleted}/${subscription.totalCycle} for subscription ${subscription._id}, user ${userId}, credits: ${creditPerCycle}`
        );
      } catch (error) {
        errorCount++;
        errors.push({
          subscriptionId: subscription._id,
          error: error.message,
        });
        logger.error(`SubscriptionCycleService: ❌ Error processing subscription ${subscription._id}:`, error);
      }
    }

    // Now handle expired subscriptions
    // Find subscriptions where:
    // 1. status = "active"
    // 2. subscriptionEndDate < now (subscription has ended)
    // 3. All cycles have been completed (cycleCompleted >= totalCycle)
    // 4. autoRenewing is false (user cancelled or renewal failed)
    //
    // Note: Subscriptions that are autoRenewing should be handled by Google Play webhooks
    // This catches subscriptions that have expired without renewal
    const subscriptionsToExpire = await SubscriptionHistory.find({
      status: "active",
      subscriptionEndDate: { $ne: null, $lt: now },
    })
      .populate("user")
      .populate("subscriptionPlan");

    // Filter subscriptions where:
    // - All cycles completed OR end date passed for non-autoRenewing subscriptions
    const validExpiredSubscriptions = subscriptionsToExpire.filter((sub) => {
      // If all cycles completed and end date passed
      if (sub.cycleCompleted >= sub.totalCycle) {
        return true;
      }
      // If not auto-renewing and end date passed (even if cycles remain)
      if (sub.autoRenewing === false) {
        return true;
      }
      return false;
    });

    logger.info(`SubscriptionCycleService: Found ${validExpiredSubscriptions.length} subscriptions to mark as expired`);

    for (const subscription of validExpiredSubscriptions) {
      try {
        // Double-check conditions
        const endDatePassed = subscription.subscriptionEndDate && 
          moment.utc(subscription.subscriptionEndDate).toDate() < now;
        const allCyclesCompleted = subscription.cycleCompleted >= subscription.totalCycle;
        const notAutoRenewing = subscription.autoRenewing === false;

        if (subscription.status !== "active" || !endDatePassed) {
          continue;
        }

        // Determine expiration reason
        let expirationReason = "Subscription expired";
        if (allCyclesCompleted) {
          expirationReason = "Subscription completed all cycles and end date has passed";
        } else if (notAutoRenewing) {
          expirationReason = "Subscription cancelled by user and end date has passed";
        }

        // Re-fetch subscription document to use addEvent method
        const subscriptionDoc = await SubscriptionHistory.findById(subscription._id);
        if (!subscriptionDoc) {
          logger.warn(`SubscriptionCycleService: Subscription document not found: ${subscription._id}`);
          continue;
        }

        // Add expiration event
        if (subscriptionDoc.addEvent) {
          subscriptionDoc.addEvent({
            eventType: "SUBSCRIPTION_EXPIRED",
            eventTime: new Date(),
            orderId: subscription.googlePlayOrderId,
            purchaseToken: subscription.googlePlayPurchaseToken,
            expiryTimeAtEvent: subscription.subscriptionEndDate,
            autoRenewingAtEvent: subscription.autoRenewing,
            creditsChanged: 0,
            source: 'system',
            metadata: {
              expirationReason,
              totalCycle: subscription.totalCycle,
              cycleCompleted: subscription.cycleCompleted,
              totalAmountPaid: subscription.totalAmountPaid || 0,
              totalCreditsReceived: subscription.totalCreditsReceived || 0,
              renewalCount: subscription.renewalCount || 0,
              subscriptionDurationDays: subscription.subscriptionStartedAt
                ? moment().diff(moment(subscription.subscriptionStartedAt), 'days')
                : 0,
            },
          });
        }

        // Mark subscription as expired
        subscriptionDoc.status = "expired";
        subscriptionDoc.cancellationReason = expirationReason;
        subscriptionDoc.remarks = subscription.remarks
          ? `${subscription.remarks} | ${expirationReason}`
          : expirationReason;
        
        await subscriptionDoc.save();

        // Update user subscription status if this is their active subscription
        const user = subscription.user;
        if (user) {
          const userId = user._id ? user._id.toString() : user.toString();
          const subscriptionPlanId = subscription.subscriptionPlan?._id 
            ? subscription.subscriptionPlan._id.toString() 
            : subscription.subscriptionPlan?.toString();
          const currentUser = await User.findById(userId);
          
          if (currentUser && subscriptionPlanId && currentUser.subscriptionPlan && 
              currentUser.subscriptionPlan.toString() === subscriptionPlanId) {
            await User.findByIdAndUpdate(userId, {
              subscriptionStatus: "expired",
            });
          }
        }

        expiredCount++;
        logger.info(`SubscriptionCycleService: ✅ Marked subscription ${subscription._id} as expired - ${expirationReason}`);
      } catch (error) {
        errorCount++;
        errors.push({
          subscriptionId: subscription._id,
          error: error.message,
        });
        logger.error(`SubscriptionCycleService: ❌ Error expiring subscription ${subscription._id}:`, error);
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

