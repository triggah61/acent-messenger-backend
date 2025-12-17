const WebhookLog = require("../model/WebhookLog");
const SubscriptionHistory = require("../model/SubscriptionHistory");
const User = require("../model/User");
const SubscriptionPlan = require("../model/SubscriptionPlan");
const BalanceService = require("./BalanceService");
const googlePlayBillingService = require("./GooglePlayBillingService");
const moment = require("moment");
const mongoose = require("mongoose");

/**
 * Webhook Handler Service
 * Processes Google Play Real-time Developer Notifications (RTDN)
 */
class WebhookHandlerService {
  /**
   * Process webhook notification
   * @param {Object} notificationData - Parsed notification data
   * @param {Object} rawPayload - Raw webhook payload for logging
   * @returns {Promise<Object>} Processing result
   */
  async processNotification(notificationData, rawPayload) {
    const startTime = Date.now();
    const { subscriptionNotification } = notificationData;

    // Extract subscription identifiers
    // Note: notificationType is INSIDE subscriptionNotification, not at top level
    const purchaseToken = subscriptionNotification?.purchaseToken;
    const subscriptionId = subscriptionNotification?.subscriptionId;
    const rawNotificationType = subscriptionNotification?.notificationType;
    const notificationVersion = subscriptionNotification?.version || notificationData.version;
    
    // Convert numeric notification type to string for database storage
    // Google Play sends numeric types: https://developer.android.com/google/play/billing/rtdn-reference#sub
    const notificationTypeMap = {
      1: "SUBSCRIPTION_RECOVERED",
      2: "SUBSCRIPTION_RENEWED",
      3: "SUBSCRIPTION_CANCELED",
      4: "SUBSCRIPTION_PURCHASED",
      5: "SUBSCRIPTION_ON_HOLD",
      6: "SUBSCRIPTION_IN_GRACE_PERIOD",
      7: "SUBSCRIPTION_RESTARTED",
      8: "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
      9: "SUBSCRIPTION_DEFERRED",
      10: "SUBSCRIPTION_PAUSED",
      11: "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED",
      12: "SUBSCRIPTION_REVOKED",
      13: "SUBSCRIPTION_EXPIRED",
      20: "SUBSCRIPTION_PENDING_PURCHASE_CANCELED",
    };

    // Normalize notification type to string
    const notificationType = typeof rawNotificationType === 'number' 
      ? (notificationTypeMap[rawNotificationType] || `UNKNOWN_${rawNotificationType}`)
      : rawNotificationType;
    
    console.log(`WebhookHandlerService: Processing notification type: ${rawNotificationType} -> ${notificationType}, subscriptionId: ${subscriptionId}`);

    if (!purchaseToken || !subscriptionId || notificationType === undefined || notificationType === null) {
      console.error("WebhookHandlerService: Missing required fields:");
      console.error(`  - purchaseToken: ${!!purchaseToken}`);
      console.error(`  - subscriptionId: ${!!subscriptionId}`);
      console.error(`  - notificationType: ${notificationType}`);
      throw new Error("Missing purchaseToken, subscriptionId, or notificationType in notification");
    }

    // Check for duplicate notification
    const existingLog = await WebhookLog.findOne({
      purchaseToken,
      notificationType,
      version: notificationVersion,
      status: "processed",
    });

    if (existingLog) {
      console.log(
        `WebhookHandlerService: Duplicate notification ignored - ${notificationType} for ${purchaseToken}`
      );
      return {
        success: true,
        duplicate: true,
        message: "Notification already processed",
      };
    }

    // Create webhook log entry
    const webhookLog = await WebhookLog.create({
      notificationType,
      version: notificationVersion,
      purchaseToken,
      subscriptionId,
      status: "processing",
      rawPayload,
    });

    try {
      // Find subscription history record
      let subscriptionHistory = await SubscriptionHistory.findOne({
        googlePlayPurchaseToken: purchaseToken,
      }).populate("user subscriptionPlan");

      // If subscription not found and this is a SUBSCRIPTION_PURCHASED event,
      // we may need to create the record from the webhook data
      if (!subscriptionHistory) {
        if (notificationType === "SUBSCRIPTION_PURCHASED") {
          console.log(`WebhookHandlerService: Creating subscription record from webhook for purchaseToken: ${purchaseToken}`);
          
          // Try to create subscription from webhook data
          subscriptionHistory = await this.createSubscriptionFromWebhook(
            purchaseToken,
            subscriptionId,
            notificationData
          );
          
          if (!subscriptionHistory) {
            console.warn(
              `WebhookHandlerService: Could not create subscription from webhook for purchaseToken: ${purchaseToken}`
            );
            webhookLog.status = "failed";
            webhookLog.errorMessage = "Could not create subscription from webhook - user or plan not identifiable";
            await webhookLog.save();
            return {
              success: false,
              message: "Could not create subscription from webhook",
            };
          }
          
          console.log(`WebhookHandlerService: ✅ Created subscription record from webhook: ${subscriptionHistory._id}`);
        } else {
          console.warn(
            `WebhookHandlerService: SubscriptionHistory not found for purchaseToken: ${purchaseToken}`
          );
          
          // Log the webhook for debugging but mark as pending
          // It might be processed later when the subscription record exists
          webhookLog.status = "ignored";
          webhookLog.errorMessage = `SubscriptionHistory not found for ${notificationType} event. Purchase may not have been processed yet.`;
          await webhookLog.save();
          return {
            success: false,
            message: "SubscriptionHistory not found - event logged for reference",
          };
        }
      }

      // Update webhook log with subscription and user info
      webhookLog.subscriptionHistory = subscriptionHistory._id;
      const userId = subscriptionHistory.user?._id 
        ? subscriptionHistory.user._id 
        : subscriptionHistory.user;
      webhookLog.user = userId;

      // Note: notificationType is already normalized to string at the top of the function
      console.log(`WebhookHandlerService: Handling notification type: ${notificationType}`);

      // Process based on notification type
      let result;
      switch (notificationType) {
        case "SUBSCRIPTION_PURCHASED":
        case "SUBSCRIPTION_RESTARTED":
          result = await this.handleSubscriptionPurchased(
            subscriptionHistory,
            purchaseToken,
            subscriptionId,
            notificationType // Pass the actual event type
          );
          break;

        case "SUBSCRIPTION_RENEWED":
          result = await this.handleSubscriptionRenewed(
            subscriptionHistory,
            purchaseToken,
            subscriptionId
          );
          break;

        case "SUBSCRIPTION_CANCELED":
          result = await this.handleSubscriptionCanceled(
            subscriptionHistory,
            purchaseToken,
            subscriptionId
          );
          break;

        case "SUBSCRIPTION_EXPIRED":
        case "SUBSCRIPTION_REVOKED":
          result = await this.handleSubscriptionExpired(
            subscriptionHistory,
            purchaseToken,
            subscriptionId,
            notificationType // Pass the actual event type
          );
          break;

        case "SUBSCRIPTION_IN_GRACE_PERIOD":
          result = await this.handleGracePeriod(
            subscriptionHistory,
            purchaseToken,
            subscriptionId,
            true
          );
          break;

        case "SUBSCRIPTION_RECOVERED":
          result = await this.handleGracePeriod(
            subscriptionHistory,
            purchaseToken,
            subscriptionId,
            false
          );
          break;

        case "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED":
          result = await this.handlePriceChangeConfirmed(
            subscriptionHistory,
            purchaseToken,
            subscriptionId
          );
          break;

        case "SUBSCRIPTION_DEFERRED":
        case "SUBSCRIPTION_PAUSED":
        case "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED":
        case "SUBSCRIPTION_ON_HOLD":
          // These events update status based on type
          result = await this.handleSubscriptionMetadataUpdate(
            subscriptionHistory,
            purchaseToken,
            subscriptionId,
            notificationType // Pass the actual event type
          );
          break;

        default:
          console.warn(
            `WebhookHandlerService: Unhandled notification type: ${notificationType}`
          );
          // Still add an event for unhandled types for audit purposes
          subscriptionHistory.addEvent({
            eventType: notificationType,
            eventTime: new Date(),
            purchaseToken: purchaseToken,
            source: 'google_play_webhook',
            metadata: {
              subscriptionId,
              unhandled: true,
            },
          });
          await subscriptionHistory.save();
          
          result = {
            success: true,
            message: `Notification type ${notificationType} logged but not handled`,
            eventAdded: true,
          };
      }

      // Update webhook log
      webhookLog.status = "processed";
      webhookLog.processedAt = new Date();
      webhookLog.processingTimeMs = Date.now() - startTime;
      webhookLog.resultMessage = result.message;
      await webhookLog.save();

      // Note: subscription history is already updated in individual handlers now
      // This is just a fallback to ensure lastWebhookEventType is always set
      if (!result.eventAdded) {
        await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
          webhookProcessedAt: new Date(),
          lastWebhookEventType: notificationType,
        });
      }

      return {
        success: result.success !== false,
        ...result,
      };
    } catch (error) {
      console.error(
        `WebhookHandlerService: Error processing notification ${notificationType}:`,
        error
      );

      // Update webhook log with error
      webhookLog.status = "failed";
      webhookLog.errorMessage = error.message;
      webhookLog.errorDetails = {
        stack: error.stack,
        name: error.name,
      };
      webhookLog.processingTimeMs = Date.now() - startTime;
      await webhookLog.save();

      throw error;
    }
  }

  /**
   * Handle SUBSCRIPTION_PURCHASED or SUBSCRIPTION_RESTARTED
   */
  async handleSubscriptionPurchased(subscriptionHistory, purchaseToken, subscriptionId, eventType = "SUBSCRIPTION_PURCHASED") {
    // Verify subscription with Google Play
    const verification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );

    if (!verification.active) {
      throw new Error("Subscription is not active");
    }

    // Get subscription plan to determine credits and amount
    const plan = await SubscriptionPlan.findById(subscriptionHistory.subscriptionPlan);
    
    // Calculate expiration date
    const expiryTime = moment(verification.expiryTimeMillis);
    const subscriptionEndDate = expiryTime.toDate();
    const startTime = verification.startTimeMillis ? moment(verification.startTimeMillis).toDate() : new Date();

    // Determine credits and amount based on cycle type
    let creditToAdd = 0;
    let amount = 0;
    if (plan) {
      if (subscriptionHistory.cycleType === "monthly" || subscriptionHistory.cycleType === "Monthly" || subscriptionHistory.cycleType === "month") {
        creditToAdd = Number(plan.monthlyCredit || 0);
        amount = Number(plan.monthlyPrice || 0);
      } else if (subscriptionHistory.cycleType === "yearly" || subscriptionHistory.cycleType === "Yearly" || subscriptionHistory.cycleType === "year") {
        creditToAdd = Number(plan.annualMonthlyCredit || plan.monthlyCredit || 0);
        amount = Number(plan.annualMonthlyPrice || plan.annualPrice || 0);
      }
    }

    // Add event to history
    subscriptionHistory.addEvent({
      eventType: eventType,
      eventTime: new Date(),
      orderId: verification.orderId,
      purchaseToken: purchaseToken,
      expiryTimeAtEvent: subscriptionEndDate,
      autoRenewingAtEvent: verification.autoRenewing,
      creditsChanged: creditToAdd,
      source: 'google_play_webhook',
      metadata: {
        subscriptionId,
        startTimeMillis: verification.startTimeMillis,
        expiryTimeMillis: verification.expiryTimeMillis,
        // Credit expiration tracking (if old subscription had balance)
        expiredCredits: expiredCredits, // Old credits that expired (use it or lose it)
        previousBalance: expiredCredits,
        newBalance: newSubscriptionBalance,
      },
    });

    // Add payment record for initial purchase
    if (amount > 0) {
      subscriptionHistory.addPayment({
        paymentTime: startTime,
        amount: amount,
        currency: 'USD',
        orderId: verification.orderId,
        transactionId: verification.orderId,
        status: 'completed',
        paymentType: eventType === "SUBSCRIPTION_RESTARTED" ? 'renewal' : 'initial',
        periodStart: startTime,
        periodEnd: subscriptionEndDate,
        creditsGranted: creditToAdd,
        metadata: {
          subscriptionId,
          purchaseToken,
          source: 'google_play_webhook',
        },
      });
    }

    // Get current user balance to track expired credits
    const userId = subscriptionHistory.user?._id 
      ? subscriptionHistory.user._id.toString() 
      : subscriptionHistory.user?.toString() || subscriptionHistory.user;
    
    let expiredCredits = 0;
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        // Old credits expire when new subscription starts (use it or lose it model)
        // Each subscription cycle's credits are independent and expire at cycle end
        expiredCredits = Number(user.monthlySubscriptionCreditBalance || 0);
      }
    }
    
    // RESET balance to new credits only (old credits don't carry over)
    // Each subscription cycle's credits are independent and expire at the end of that cycle
    const newSubscriptionBalance = creditToAdd;

    // Update subscription history fields
    subscriptionHistory.status = "active";
    subscriptionHistory.subscriptionEndDate = subscriptionEndDate;
    subscriptionHistory.subscriptionStartedAt = subscriptionHistory.subscriptionStartedAt || startTime;
    subscriptionHistory.autoRenewing = verification.autoRenewing;
    subscriptionHistory.googlePlayOrderId = verification.orderId;
    subscriptionHistory.googlePlayAcknowledged = true;
    subscriptionHistory.amount = amount;
    // RESET currentCycleBalance to match the new user balance (not add to existing)
    // This ensures currentCycleBalance always reflects the actual remaining balance
    subscriptionHistory.currentCycleBalance = newSubscriptionBalance;
    subscriptionHistory.cancelledAt = null; // Reset cancellation if restarted
    subscriptionHistory.cancelledBy = null;
    
    await subscriptionHistory.save();

    console.log(`WebhookHandlerService: ✅ ${eventType} processed - Added event and payment record`);

    // Sync user balance (userId already declared above)
    if (userId) {
      await BalanceService.syncUserBalanceFromSubscriptions(userId);
    }

    return {
      success: true,
      message: `Subscription ${eventType === "SUBSCRIPTION_RESTARTED" ? "restarted" : "activated"}`,
      eventAdded: true,
      paymentRecorded: amount > 0,
    };
  }

  /**
   * Handle SUBSCRIPTION_RENEWED
   * 
   * Cycle Management Logic:
   * - Monthly subscription: totalCycle += 1, cycleCompleted += 1, nextCycleAt = null
   *   (User gets full monthlyCredit on renewal, no cron job distribution needed)
   * - Annual subscription: totalCycle += 12, cycleCompleted += 1, nextCycleAt = 1 month from now
   *   (User gets first month's annualMonthlyCredit, cron job distributes remaining 11 months)
   * 
   * This uses increment approach for better historical tracking
   */
  async handleSubscriptionRenewed(subscriptionHistory, purchaseToken, subscriptionId) {
    // Verify subscription with Google Play
    const verification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );

    if (!verification.active) {
      throw new Error("Subscription is not active after renewal");
    }

    // Get subscription plan to determine credits
    const plan = await SubscriptionPlan.findById(subscriptionHistory.subscriptionPlan);
    if (!plan) {
      throw new Error("Subscription plan not found");
    }

    // Calculate previous expiry for period start
    const previousExpiryDate = subscriptionHistory.subscriptionEndDate || new Date();
    
    // Calculate new expiration and credits based on cycle type
    const expiryTime = moment(verification.expiryTimeMillis);
    const subscriptionEndDate = expiryTime.toDate();
    
    // Determine cycle type
    const isMonthly = ["monthly", "Monthly", "month"].includes(subscriptionHistory.cycleType);
    const isYearly = ["yearly", "Yearly", "year"].includes(subscriptionHistory.cycleType);
    
    // Calculate credits and amount based on cycle type
    let creditToAdd = 0;
    let amount = 0;
    let cyclesToAdd = 1; // Default for monthly
    let nextCycleAt = null; // Default for monthly (no cron distribution)
    
    if (isMonthly) {
      creditToAdd = Number(plan.monthlyCredit || 0);
      amount = Number(plan.monthlyPrice || 0);
      cyclesToAdd = 1;
      nextCycleAt = null; // Monthly subscriptions don't need cron distribution
    } else if (isYearly) {
      // For annual, user gets first month's credit immediately
      // Cron job will distribute remaining 11 months
      creditToAdd = Number(plan.annualMonthlyCredit || 0);
      amount = Number(plan.annualPrice || 0);
      cyclesToAdd = 12; // Add 12 more cycles to totalCycle
      // Set nextCycleAt to 1 month from now for cron job to pick up
      nextCycleAt = moment.utc().add(1, "month").toDate();
    }

    // Handle unlimited credit
    if (plan.unlimitedCredit === "yes") {
      creditToAdd = Number(plan.unlimitedCreditCap || 0);
    }

    // Store previous cycle values for logging
    const previousTotalCycle = subscriptionHistory.totalCycle || 0;
    const previousCycleCompleted = subscriptionHistory.cycleCompleted || 0;
    
    // Calculate new cycle values (increment approach for historical tracking)
    const newTotalCycle = previousTotalCycle + cyclesToAdd;
    const newCycleCompleted = previousCycleCompleted + 1; // First cycle of new period

    // Get current user balance to track expired credits BEFORE adding event
    // This must be done before addEvent because expiredCredits is used in metadata
    const userId = subscriptionHistory.user?._id 
      ? subscriptionHistory.user._id.toString() 
      : subscriptionHistory.user?.toString() || subscriptionHistory.user;
    
    let expiredCredits = 0;
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        // Old credits expire (use it or lose it model)
        // Each renewal cycle resets the balance to new credits only
        expiredCredits = Number(user.monthlySubscriptionCreditBalance || 0);
      }
    }
    
    // RESET balance to new credits only (old credits don't carry over)
    // Each renewal cycle's credits are independent and expire at the end of that cycle
    const newSubscriptionBalance = creditToAdd;

    // Add event to history
    subscriptionHistory.addEvent({
      eventType: "SUBSCRIPTION_RENEWED",
      eventTime: new Date(),
      orderId: verification.orderId,
      purchaseToken: purchaseToken,
      expiryTimeAtEvent: subscriptionEndDate,
      autoRenewingAtEvent: verification.autoRenewing,
      creditsChanged: creditToAdd,
      source: 'google_play_webhook',
      metadata: {
        subscriptionId,
        previousExpiryDate,
        newExpiryDate: subscriptionEndDate,
        renewalCount: (subscriptionHistory.renewalCount || 0) + 1,
        // Cycle tracking
        previousTotalCycle,
        previousCycleCompleted,
        newTotalCycle,
        newCycleCompleted,
        cyclesToAdd,
        nextCycleAt,
        // Credit expiration tracking
        expiredCredits: expiredCredits, // Old credits that expired (use it or lose it)
        previousBalance: expiredCredits,
        newBalance: newSubscriptionBalance,
      },
    });

    // Add payment record for renewal
    if (amount > 0) {
      subscriptionHistory.addPayment({
        paymentTime: new Date(),
        amount: amount,
        currency: 'USD',
        orderId: verification.orderId,
        transactionId: verification.orderId,
        status: 'completed',
        paymentType: 'renewal',
        periodStart: previousExpiryDate,
        periodEnd: subscriptionEndDate,
        creditsGranted: creditToAdd,
        metadata: {
          subscriptionId,
          purchaseToken,
          renewalNumber: (subscriptionHistory.renewalCount || 0) + 1,
          source: 'google_play_webhook',
        },
      });
    }

    // Update subscription history fields
    subscriptionHistory.status = "active";
    subscriptionHistory.subscriptionEndDate = subscriptionEndDate;
    subscriptionHistory.autoRenewing = verification.autoRenewing;
    subscriptionHistory.googlePlayOrderId = verification.orderId;
    
    // Cycle management - increment approach
    subscriptionHistory.totalCycle = newTotalCycle;
    subscriptionHistory.cycleCompleted = newCycleCompleted;
    subscriptionHistory.nextCycleAt = nextCycleAt; // Set for annual, null for monthly
    
    // RESET currentCycleBalance to match the new user balance (not just the renewal credits)
    // This ensures currentCycleBalance always reflects the actual remaining balance
    subscriptionHistory.currentCycleBalance = newSubscriptionBalance;
    
    subscriptionHistory.renewalCount = (subscriptionHistory.renewalCount || 0) + 1;
    subscriptionHistory.lastRenewalAt = new Date();
    subscriptionHistory.cancelledAt = null; // Reset cancellation on renewal
    subscriptionHistory.cancelledBy = null;
    
    await subscriptionHistory.save();

    console.log(`WebhookHandlerService: ✅ SUBSCRIPTION_RENEWED processed`);
    console.log(`  - Renewal #${subscriptionHistory.renewalCount}`);
    console.log(`  - Cycle type: ${subscriptionHistory.cycleType}`);
    console.log(`  - Cycles: ${previousTotalCycle}/${previousCycleCompleted} -> ${newTotalCycle}/${newCycleCompleted}`);
    console.log(`  - Next cycle at: ${nextCycleAt || 'N/A (monthly subscription)'}`);
    if (expiredCredits > 0) {
      console.log(`  - ⚠️ ${expiredCredits} unused credits expired (use it or lose it)`);
    }
    console.log(`  - New credits: ${creditToAdd}`);
    console.log(`  - New balance: ${newSubscriptionBalance} (old credits expired)`);

    // Add credits for renewal (first month's credit)
    // userId already declared above
    if (creditToAdd > 0 && userId) {
      const planId = subscriptionHistory.subscriptionPlan?._id 
        ? subscriptionHistory.subscriptionPlan._id 
        : subscriptionHistory.subscriptionPlan;
      
      if (planId) {
        await BalanceService.createTransaction({
          userId,
          amount: creditToAdd,
          type: "credit",
          source: "subscriptionRenewal",
          subscriptionPlan: planId,
          subscriptionHistory: subscriptionHistory._id,
          remarks: `Subscription renewal (cycle ${newCycleCompleted}/${newTotalCycle}) - ${subscriptionHistory.cycleType}`,
        });
      }
    }

    // Sync user balance (userId already declared above)
    if (userId) {
      await BalanceService.syncUserBalanceFromSubscriptions(userId);
    }

    return {
      success: true,
      message: "Subscription renewed",
      creditsAdded: creditToAdd,
    };
  }

  /**
   * Handle SUBSCRIPTION_CANCELED
   * Subscription is still active until expiration
   */
  async handleSubscriptionCanceled(subscriptionHistory, purchaseToken, subscriptionId) {
    // Verify subscription with Google Play
    const verification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );

    const expiryDate = verification.expiryTimeMillis 
      ? moment(verification.expiryTimeMillis).toDate() 
      : subscriptionHistory.subscriptionEndDate;

    // Add event to history
    subscriptionHistory.addEvent({
      eventType: "SUBSCRIPTION_CANCELED",
      eventTime: new Date(),
      orderId: verification.orderId,
      purchaseToken: purchaseToken,
      expiryTimeAtEvent: expiryDate,
      autoRenewingAtEvent: false,
      creditsChanged: 0,
      source: 'google_play_webhook',
      metadata: {
        subscriptionId,
        cancelledBy: 'user', // Assumed user cancelled from Play Store
        willExpireAt: expiryDate,
        remainingDays: expiryDate ? moment(expiryDate).diff(moment(), 'days') : 0,
      },
    });

    // Update subscription - keep active but mark auto-renewing as false
    subscriptionHistory.autoRenewing = false;
    subscriptionHistory.cancelledAt = new Date();
    subscriptionHistory.cancelledBy = 'google_play';
    subscriptionHistory.cancellationReason = `User canceled subscription. Will remain active until ${moment(expiryDate).format("YYYY-MM-DD")}`;
    subscriptionHistory.status = "active"; // Keep active until expiration
    
    await subscriptionHistory.save();

    console.log(`WebhookHandlerService: ✅ SUBSCRIPTION_CANCELED processed - Will expire on ${moment(expiryDate).format("YYYY-MM-DD")}`);

    // Update user subscription status (still active but not renewing)
    const userId = subscriptionHistory.user?._id 
      ? subscriptionHistory.user._id.toString() 
      : subscriptionHistory.user?.toString() || subscriptionHistory.user;
    
    if (userId) {
      await BalanceService.syncUserBalanceFromSubscriptions(userId);
    }

    return {
      success: true,
      message: "Subscription canceled (active until expiration)",
      eventAdded: true,
      willExpireAt: expiryDate,
    };
  }

  /**
   * Handle SUBSCRIPTION_EXPIRED or SUBSCRIPTION_REVOKED
   */
  async handleSubscriptionExpired(subscriptionHistory, purchaseToken, subscriptionId, eventType = "SUBSCRIPTION_EXPIRED") {
    const expiredAt = moment().utc().toDate();
    
    // Calculate subscription lifetime stats
    const subscriptionDurationDays = subscriptionHistory.subscriptionStartedAt 
      ? moment(expiredAt).diff(moment(subscriptionHistory.subscriptionStartedAt), 'days')
      : 0;

    // Add event to history
    subscriptionHistory.addEvent({
      eventType: eventType,
      eventTime: expiredAt,
      orderId: subscriptionHistory.googlePlayOrderId,
      purchaseToken: purchaseToken,
      expiryTimeAtEvent: expiredAt,
      autoRenewingAtEvent: false,
      creditsChanged: 0,
      source: 'google_play_webhook',
      metadata: {
        subscriptionId,
        subscriptionDurationDays,
        totalRenewals: subscriptionHistory.renewalCount || 0,
        totalAmountPaid: subscriptionHistory.totalAmountPaid || 0,
        totalCreditsReceived: subscriptionHistory.totalCreditsReceived || 0,
        wasAutoRenewing: subscriptionHistory.autoRenewing,
        previousStatus: subscriptionHistory.status,
      },
    });

    // Mark subscription as expired
    subscriptionHistory.status = "expired";
    subscriptionHistory.autoRenewing = false;
    subscriptionHistory.cancellationReason = eventType === "SUBSCRIPTION_REVOKED" 
      ? "Subscription revoked by Google Play" 
      : "Subscription expired";
    subscriptionHistory.subscriptionEndDate = expiredAt;
    
    await subscriptionHistory.save();

    console.log(`WebhookHandlerService: ✅ ${eventType} processed - Subscription ended after ${subscriptionDurationDays} days, ${subscriptionHistory.renewalCount || 0} renewals`);

    // Sync user balance (will zero out subscription balance if no other active subscriptions)
    const userId = subscriptionHistory.user?._id 
      ? subscriptionHistory.user._id.toString() 
      : subscriptionHistory.user?.toString() || subscriptionHistory.user;
    
    if (userId) {
      await BalanceService.syncUserBalanceFromSubscriptions(userId);
    }

    return {
      success: true,
      message: `Subscription ${eventType === "SUBSCRIPTION_REVOKED" ? "revoked" : "expired"}`,
      eventAdded: true,
      subscriptionDurationDays,
    };
  }

  /**
   * Handle SUBSCRIPTION_IN_GRACE_PERIOD or SUBSCRIPTION_RECOVERED
   */
  async handleGracePeriod(subscriptionHistory, purchaseToken, subscriptionId, inGracePeriod) {
    // Verify subscription with Google Play
    const verification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );

    let gracePeriodEndsAt = null;
    if (inGracePeriod && verification.expiryTimeMillis) {
      // Grace period typically extends expiration by a few days
      gracePeriodEndsAt = moment(verification.expiryTimeMillis).toDate();
    }

    const eventType = inGracePeriod ? "SUBSCRIPTION_IN_GRACE_PERIOD" : "SUBSCRIPTION_RECOVERED";
    const newStatus = inGracePeriod ? "in_grace_period" : "active";

    // Add event to history
    subscriptionHistory.addEvent({
      eventType: eventType,
      eventTime: new Date(),
      orderId: verification.orderId,
      purchaseToken: purchaseToken,
      expiryTimeAtEvent: gracePeriodEndsAt || subscriptionHistory.subscriptionEndDate,
      autoRenewingAtEvent: verification.autoRenewing,
      creditsChanged: 0,
      source: 'google_play_webhook',
      metadata: {
        subscriptionId,
        gracePeriodEndsAt,
        previousStatus: subscriptionHistory.status,
        paymentState: verification.paymentState,
      },
    });

    // Update subscription
    subscriptionHistory.gracePeriodEndsAt = gracePeriodEndsAt;
    subscriptionHistory.autoRenewing = verification.autoRenewing;
    subscriptionHistory.status = newStatus;
    subscriptionHistory.cancellationReason = inGracePeriod
      ? "Payment failed - subscription in grace period"
      : "Recovered from grace period";
    
    await subscriptionHistory.save();

    console.log(`WebhookHandlerService: ✅ ${eventType} processed - Status: ${newStatus}`);

    // Sync user balance
    const userId = subscriptionHistory.user?._id 
      ? subscriptionHistory.user._id.toString() 
      : subscriptionHistory.user?.toString() || subscriptionHistory.user;
    
    if (userId) {
      await BalanceService.syncUserBalanceFromSubscriptions(userId);
    }

    return {
      success: true,
      message: inGracePeriod ? "Subscription in grace period" : "Subscription recovered",
      eventAdded: true,
    };
  }

  /**
   * Handle SUBSCRIPTION_PRICE_CHANGE_CONFIRMED
   */
  async handlePriceChangeConfirmed(subscriptionHistory, purchaseToken, subscriptionId) {
    // Verify subscription with Google Play
    const verification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );

    const expiryDate = verification.expiryTimeMillis 
      ? moment(verification.expiryTimeMillis).toDate() 
      : subscriptionHistory.subscriptionEndDate;

    // Add event to history
    subscriptionHistory.addEvent({
      eventType: "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
      eventTime: new Date(),
      orderId: verification.orderId,
      purchaseToken: purchaseToken,
      expiryTimeAtEvent: expiryDate,
      autoRenewingAtEvent: verification.autoRenewing,
      creditsChanged: 0,
      source: 'google_play_webhook',
      metadata: {
        subscriptionId,
        previousAmount: subscriptionHistory.amount,
      },
    });

    // Update expiration if changed
    subscriptionHistory.subscriptionEndDate = expiryDate;
    subscriptionHistory.autoRenewing = verification.autoRenewing;
    
    await subscriptionHistory.save();

    console.log(`WebhookHandlerService: ✅ SUBSCRIPTION_PRICE_CHANGE_CONFIRMED processed`);

    return {
      success: true,
      message: "Price change confirmed",
      eventAdded: true,
    };
  }

  /**
   * Handle metadata updates (paused, deferred, on_hold, etc.)
   */
  async handleSubscriptionMetadataUpdate(subscriptionHistory, purchaseToken, subscriptionId, eventType) {
    // Verify subscription with Google Play to get latest status
    const verification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );

    const expiryDate = verification.expiryTimeMillis
      ? moment(verification.expiryTimeMillis).toDate()
      : subscriptionHistory.subscriptionEndDate;

    // Determine status based on event type
    let newStatus = subscriptionHistory.status;
    if (eventType === "SUBSCRIPTION_PAUSED") {
      newStatus = "paused";
    } else if (eventType === "SUBSCRIPTION_ON_HOLD") {
      newStatus = "on_hold";
    } else if (eventType === "SUBSCRIPTION_DEFERRED") {
      newStatus = "active"; // Deferred means subscription extends, stays active
    }

    // Add event to history
    subscriptionHistory.addEvent({
      eventType: eventType || "SUBSCRIPTION_METADATA_UPDATED",
      eventTime: new Date(),
      orderId: verification.orderId,
      purchaseToken: purchaseToken,
      expiryTimeAtEvent: expiryDate,
      autoRenewingAtEvent: verification.autoRenewing,
      creditsChanged: 0,
      source: 'google_play_webhook',
      metadata: {
        subscriptionId,
        previousStatus: subscriptionHistory.status,
        newStatus: newStatus,
        paymentState: verification.paymentState,
      },
    });

    // Update metadata
    subscriptionHistory.autoRenewing = verification.autoRenewing;
    subscriptionHistory.subscriptionEndDate = expiryDate;
    subscriptionHistory.status = newStatus;
    
    await subscriptionHistory.save();

    console.log(`WebhookHandlerService: ✅ ${eventType || "METADATA_UPDATE"} processed - Status: ${newStatus}`);

    return {
      success: true,
      message: "Subscription metadata updated",
      eventAdded: true,
      newStatus,
    };
  }

  /**
   * Create subscription record from webhook data when purchase verification hasn't happened yet
   * This handles cases where the webhook arrives before the app completes verification
   */
  async createSubscriptionFromWebhook(purchaseToken, subscriptionId, notificationData) {
    try {
      // Verify the subscription with Google Play to get full details
      const verification = await googlePlayBillingService.verifySubscription(
        purchaseToken,
        subscriptionId
      );

      if (!verification || !verification.active) {
        console.warn(`WebhookHandlerService: Cannot create subscription - verification failed`);
        return null;
      }

      // Try to extract user from obfuscatedAccountId or linkedPurchaseToken
      const obfuscatedAccountId = verification.obfuscatedAccountId || 
        verification.obfuscatedExternalAccountId;
      
      if (!obfuscatedAccountId) {
        console.warn(`WebhookHandlerService: Cannot create subscription - no user identifier in purchase`);
        return null;
      }

      // Find user by ID (obfuscatedAccountId should be the user's MongoDB ID)
      const User = require("../model/User");
      let user = await User.findById(obfuscatedAccountId);
      
      if (!user) {
        console.warn(`WebhookHandlerService: Cannot create subscription - user not found: ${obfuscatedAccountId}`);
        return null;
      }

      // Find subscription plan by Google Play product ID
      const SubscriptionPlan = require("../model/SubscriptionPlan");
      const plan = await SubscriptionPlan.findOne({
        $or: [
          { googlePlaySubscriptionId: subscriptionId },
          { "sandboxProductIds.googlePlay": subscriptionId },
          { "productionProductIds.googlePlay": subscriptionId },
        ]
      });

      if (!plan) {
        console.warn(`WebhookHandlerService: Cannot create subscription - plan not found for: ${subscriptionId}`);
        return null;
      }

      // Determine cycle type from subscription ID
      let cycleType = "monthly";
      if (subscriptionId.includes("annual") || subscriptionId.includes("yearly")) {
        cycleType = "yearly";
      }

      // Calculate credits and amount
      let creditAmount = 0;
      let amount = 0;
      if (cycleType === "monthly") {
        creditAmount = Number(plan.monthlyCredit || 0);
        amount = Number(plan.monthlyPrice || 0);
      } else {
        creditAmount = Number(plan.annualMonthlyCredit || plan.monthlyCredit || 0);
        amount = Number(plan.annualPrice || plan.monthlyPrice * 12 || 0);
      }

      // Create subscription history record
      const startTime = verification.startTimeMillis 
        ? moment(verification.startTimeMillis).toDate() 
        : new Date();
      const expiryTime = moment(verification.expiryTimeMillis).toDate();

      // Determine cycle configuration based on subscription type
      // - Monthly: totalCycle=1, cycleCompleted=1, nextCycleAt=null (all credits at purchase)
      // - Annual: totalCycle=12, cycleCompleted=1, nextCycleAt=1 month from now (cron distributes remaining)
      const isYearly = cycleType === "yearly";
      const totalCycle = isYearly ? 12 : 1;
      const cycleCompleted = 1; // First cycle is completed at purchase
      const nextCycleAt = isYearly 
        ? moment.utc().add(1, "month").toDate() // Cron will distribute remaining 11 months
        : null; // Monthly doesn't need cron distribution

      const subscriptionHistory = new SubscriptionHistory({
        user: user._id,
        subscriptionPlan: plan._id,
        cycleType,
        totalCycle,
        cycleCompleted,
        currentCycleBalance: creditAmount,
        nextCycleAt,
        subscriptionStartedAt: startTime,
        subscriptionEndDate: expiryTime,
        status: "active",
        amount,
        transactionType: "google_play",
        googlePlayPurchaseToken: purchaseToken,
        googlePlayOrderId: verification.orderId,
        googlePlayTransactionId: verification.orderId,
        googlePlayProductId: subscriptionId,
        googlePlayAcknowledged: true,
        autoRenewing: verification.autoRenewing !== false,
        totalAmountPaid: amount,
        totalCreditsReceived: creditAmount,
        renewalCount: 0,
        events: [{
          eventType: "SUBSCRIPTION_PURCHASED",
          eventTime: new Date(),
          orderId: verification.orderId,
          purchaseToken: purchaseToken,
          expiryTimeAtEvent: expiryTime,
          autoRenewingAtEvent: verification.autoRenewing,
          creditsChanged: creditAmount,
          source: 'google_play_webhook',
          metadata: {
            subscriptionId,
            createdFromWebhook: true,
            totalCycle,
            cycleCompleted,
            nextCycleAt,
          },
        }],
        payments: [{
          paymentTime: startTime,
          amount: amount,
          currency: 'USD',
          orderId: verification.orderId,
          transactionId: verification.orderId,
          status: 'completed',
          paymentType: 'initial',
          periodStart: startTime,
          periodEnd: expiryTime,
          creditsGranted: creditAmount,
          metadata: {
            subscriptionId,
            purchaseToken,
            createdFromWebhook: true,
          },
        }],
      });

      await subscriptionHistory.save();

      // Add credits to user
      if (creditAmount > 0) {
        await BalanceService.createTransaction({
          userId: user._id.toString(),
          amount: creditAmount,
          type: "credit",
          source: "subscriptionPurchase",
          subscriptionPlan: plan._id,
          subscriptionHistory: subscriptionHistory._id,
          remarks: `Subscription purchase (from webhook) - ${plan.name} ${cycleType}`,
        });
      }

      // Sync user balance
      await BalanceService.syncUserBalanceFromSubscriptions(user._id.toString());

      console.log(`WebhookHandlerService: ✅ Created subscription from webhook for user ${user._id}`);
      
      // Populate and return
      return await SubscriptionHistory.findById(subscriptionHistory._id)
        .populate("user subscriptionPlan");

    } catch (error) {
      console.error(`WebhookHandlerService: ❌ Error creating subscription from webhook:`, error);
      return null;
    }
  }
}

module.exports = new WebhookHandlerService();

