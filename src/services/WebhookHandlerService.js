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
    const { notificationType, subscriptionNotification } = notificationData;

    // Extract subscription identifiers
    const purchaseToken = subscriptionNotification?.purchaseToken;
    const subscriptionId = subscriptionNotification?.subscriptionId;
    const notificationVersion = subscriptionNotification?.version || notificationData.version;

    if (!purchaseToken || !subscriptionId) {
      throw new Error("Missing purchaseToken or subscriptionId in notification");
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
      const subscriptionHistory = await SubscriptionHistory.findOne({
        googlePlayPurchaseToken: purchaseToken,
      }).populate("user subscriptionPlan");

      if (!subscriptionHistory) {
        console.warn(
          `WebhookHandlerService: SubscriptionHistory not found for purchaseToken: ${purchaseToken}`
        );
        webhookLog.status = "ignored";
        webhookLog.errorMessage = "SubscriptionHistory not found";
        await webhookLog.save();
        return {
          success: false,
          message: "SubscriptionHistory not found",
        };
      }

      // Update webhook log with subscription and user info
      webhookLog.subscriptionHistory = subscriptionHistory._id;
      const userId = subscriptionHistory.user?._id 
        ? subscriptionHistory.user._id 
        : subscriptionHistory.user;
      webhookLog.user = userId;

      // Process based on notification type
      let result;
      switch (notificationType) {
        case "SUBSCRIPTION_PURCHASED":
        case "SUBSCRIPTION_RESTARTED":
          result = await this.handleSubscriptionPurchased(
            subscriptionHistory,
            purchaseToken,
            subscriptionId
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
            subscriptionId
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
          // These events don't change subscription status, just update metadata
          result = await this.handleSubscriptionMetadataUpdate(
            subscriptionHistory,
            purchaseToken,
            subscriptionId
          );
          break;

        default:
          console.warn(
            `WebhookHandlerService: Unhandled notification type: ${notificationType}`
          );
          result = {
            success: true,
            message: "Notification type not handled",
          };
      }

      // Update webhook log
      webhookLog.status = "processed";
      webhookLog.processedAt = new Date();
      webhookLog.processingTimeMs = Date.now() - startTime;
      if (result.message) {
        webhookLog.errorMessage = result.message;
      }
      await webhookLog.save();

      // Update subscription history with webhook info
      await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
        webhookProcessedAt: new Date(),
        lastWebhookEventType: notificationType,
      });

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
  async handleSubscriptionPurchased(subscriptionHistory, purchaseToken, subscriptionId) {
    // Verify subscription with Google Play
    const verification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );

    if (!verification.active) {
      throw new Error("Subscription is not active");
    }

    // Calculate expiration date
    const expiryTime = moment(verification.expiryTimeMillis);
    const subscriptionEndDate = expiryTime.toDate();

    // Update subscription history
    await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
      status: "active",
      subscriptionEndDate,
      autoRenewing: verification.autoRenewing,
      googlePlayOrderId: verification.orderId,
      googlePlayAcknowledged: true,
    });

    // Sync user balance
    const userId = subscriptionHistory.user?._id 
      ? subscriptionHistory.user._id.toString() 
      : subscriptionHistory.user?.toString() || subscriptionHistory.user;
    
    if (userId) {
      await BalanceService.syncUserBalanceFromSubscriptions(userId);
    }

    return {
      success: true,
      message: "Subscription activated",
    };
  }

  /**
   * Handle SUBSCRIPTION_RENEWED
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

    // Calculate new expiration and credits based on cycle type
    const expiryTime = moment(verification.expiryTimeMillis);
    const subscriptionEndDate = expiryTime.toDate();
    
    let creditToAdd = 0;
    if (subscriptionHistory.cycleType === "monthly" || subscriptionHistory.cycleType === "Monthly") {
      creditToAdd = Number(plan.monthlyCredit || 0);
    } else if (subscriptionHistory.cycleType === "yearly" || subscriptionHistory.cycleType === "Yearly") {
      creditToAdd = Number(plan.annualMonthlyCredit || 0);
    }

    // Update subscription history
    await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
      status: "active",
      subscriptionEndDate,
      autoRenewing: verification.autoRenewing,
      googlePlayOrderId: verification.orderId,
      cycleCompleted: (subscriptionHistory.cycleCompleted || 0) + 1,
      currentCycleBalance: (subscriptionHistory.currentCycleBalance || 0) + creditToAdd,
    });

    // Add credits for renewal
    if (creditToAdd > 0) {
      const userId = subscriptionHistory.user?._id 
        ? subscriptionHistory.user._id.toString() 
        : subscriptionHistory.user?.toString() || subscriptionHistory.user;
      const planId = subscriptionHistory.subscriptionPlan?._id 
        ? subscriptionHistory.subscriptionPlan._id 
        : subscriptionHistory.subscriptionPlan;
      
      if (userId && planId) {
        await BalanceService.createTransaction({
          userId,
          amount: creditToAdd,
          type: "credit",
          source: "subscriptionRenewal",
          subscriptionPlan: planId,
          subscriptionHistory: subscriptionHistory._id,
          remarks: `Subscription renewal - ${subscriptionHistory.cycleType}`,
        });
      }
    }

    // Sync user balance
    const userId = subscriptionHistory.user?._id 
      ? subscriptionHistory.user._id.toString() 
      : subscriptionHistory.user?.toString() || subscriptionHistory.user;
    
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

    // Update subscription - keep active but mark auto-renewing as false
    await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
      autoRenewing: false,
      cancellationReason: `User canceled subscription. Will remain active until ${moment(verification.expiryTimeMillis).format("YYYY-MM-DD")}`,
      status: "active", // Keep active until expiration
    });

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
    };
  }

  /**
   * Handle SUBSCRIPTION_EXPIRED or SUBSCRIPTION_REVOKED
   */
  async handleSubscriptionExpired(subscriptionHistory, purchaseToken, subscriptionId) {
    // Mark subscription as expired
    await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
      status: "expired",
      autoRenewing: false,
      cancellationReason: "Subscription expired or revoked",
      subscriptionEndDate: moment().utc().toDate(),
    });

    // Sync user balance (will zero out subscription balance if no other active subscriptions)
    const userId = subscriptionHistory.user?._id 
      ? subscriptionHistory.user._id.toString() 
      : subscriptionHistory.user?.toString() || subscriptionHistory.user;
    
    if (userId) {
      await BalanceService.syncUserBalanceFromSubscriptions(userId);
    }

    return {
      success: true,
      message: "Subscription expired",
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

    // Update subscription
    await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
      gracePeriodEndsAt,
      autoRenewing: verification.autoRenewing,
      status: inGracePeriod ? "active" : subscriptionHistory.status,
      cancellationReason: inGracePeriod
        ? "Payment failed - subscription in grace period"
        : "Recovered from grace period",
    });

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

    // Update expiration if changed
    if (verification.expiryTimeMillis) {
      const expiryTime = moment(verification.expiryTimeMillis);
      await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
        subscriptionEndDate: expiryTime.toDate(),
        autoRenewing: verification.autoRenewing,
      });
    }

    return {
      success: true,
      message: "Price change confirmed",
    };
  }

  /**
   * Handle metadata updates (paused, deferred, etc.)
   */
  async handleSubscriptionMetadataUpdate(subscriptionHistory, purchaseToken, subscriptionId) {
    // Verify subscription with Google Play to get latest status
    const verification = await googlePlayBillingService.verifySubscription(
      purchaseToken,
      subscriptionId
    );

    // Update metadata
    await SubscriptionHistory.findByIdAndUpdate(subscriptionHistory._id, {
      autoRenewing: verification.autoRenewing,
      subscriptionEndDate: verification.expiryTimeMillis
        ? moment(verification.expiryTimeMillis).toDate()
        : subscriptionHistory.subscriptionEndDate,
    });

    return {
      success: true,
      message: "Subscription metadata updated",
    };
  }
}

module.exports = new WebhookHandlerService();

