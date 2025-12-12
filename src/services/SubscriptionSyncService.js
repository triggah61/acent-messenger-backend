const SubscriptionHistory = require("../model/SubscriptionHistory");
const User = require("../model/User");
const BalanceService = require("./BalanceService");
const googlePlayBillingService = require("./GooglePlayBillingService");
const moment = require("moment");
const mongoose = require("mongoose");

/**
 * Subscription Sync Service
 * Periodically verifies subscription status with Google Play API
 * and syncs local database
 */
class SubscriptionSyncService {
  /**
   * Sync all active subscriptions with Google Play
   * @returns {Promise<Object>} Sync results
   */
  async syncAllActiveSubscriptions() {
    const results = {
      total: 0,
      synced: 0,
      expired: 0,
      errors: 0,
      errorDetails: [],
    };

    try {
      // Get all active subscriptions with Google Play purchase tokens
      const activeSubscriptions = await SubscriptionHistory.find({
        status: "active",
        googlePlayPurchaseToken: { $ne: null },
        googlePlayProductId: { $ne: null },
      }).populate("user subscriptionPlan");

      results.total = activeSubscriptions.length;

      console.log(
        `SubscriptionSyncService: Syncing ${results.total} active subscriptions...`
      );

      // Process each subscription
      for (const subscription of activeSubscriptions) {
        try {
          await this.syncSingleSubscription(subscription);
          results.synced++;
        } catch (error) {
          results.errors++;
          results.errorDetails.push({
            subscriptionId: subscription._id,
            error: error.message,
          });
          console.error(
            `SubscriptionSyncService: Error syncing subscription ${subscription._id}:`,
            error
          );
        }
      }

      // Check for expired subscriptions (past expiration date)
      const expiredCount = await this.checkAndMarkExpiredSubscriptions();
      results.expired = expiredCount;

      console.log(
        `SubscriptionSyncService: Sync completed - Synced: ${results.synced}, Expired: ${results.expired}, Errors: ${results.errors}`
      );

      return {
        success: true,
        ...results,
      };
    } catch (error) {
      console.error("SubscriptionSyncService: Error in syncAllActiveSubscriptions:", error);
      return {
        success: false,
        error: error.message,
        ...results,
      };
    }
  }

  /**
   * Sync a single subscription with Google Play
   * @param {Object} subscription - SubscriptionHistory document
   * @returns {Promise<Boolean>} Success status
   */
  async syncSingleSubscription(subscription) {
    const { googlePlayPurchaseToken, googlePlayProductId } = subscription;

    if (!googlePlayPurchaseToken || !googlePlayProductId) {
      throw new Error("Missing Google Play purchase token or product ID");
    }

    // Verify subscription with Google Play
    const verification = await googlePlayBillingService.verifySubscription(
      googlePlayPurchaseToken,
      googlePlayProductId
    );

    // Check if subscription is still active
    const now = moment();
    const expiryTime = moment(verification.expiryTimeMillis);
    const isActive = expiryTime.isAfter(now);

    // Update subscription based on verification
    const updateData = {
      autoRenewing: verification.autoRenewing,
      subscriptionEndDate: expiryTime.toDate(),
    };

    // If subscription expired, mark as expired
    if (!isActive) {
      updateData.status = "expired";
      updateData.cancellationReason = "Subscription expired (verified via sync)";
    } else {
      // Update order ID if changed
      if (verification.orderId) {
        updateData.googlePlayOrderId = verification.orderId;
      }
    }

    await SubscriptionHistory.findByIdAndUpdate(subscription._id, updateData);

    // Sync user balance
    if (subscription.user?._id) {
      await BalanceService.syncUserBalanceFromSubscriptions(
        subscription.user._id.toString()
      );
    }

    return true;
  }

  /**
   * Check and mark expired subscriptions
   * @returns {Promise<Number>} Number of expired subscriptions
   */
  async checkAndMarkExpiredSubscriptions() {
    const now = moment().utc().toDate();

    // Find subscriptions that should be expired
    const expiredSubscriptions = await SubscriptionHistory.find({
      status: "active",
      subscriptionEndDate: { $lt: now },
    });

    let expiredCount = 0;

    for (const subscription of expiredSubscriptions) {
      // Mark as expired
      await SubscriptionHistory.findByIdAndUpdate(subscription._id, {
        status: "expired",
        cancellationReason: "Subscription expired (expiration date passed)",
      });

      // Sync user balance
      if (subscription.user) {
        await BalanceService.syncUserBalanceFromSubscriptions(
          subscription.user.toString()
        );
      }

      expiredCount++;
    }

    return expiredCount;
  }

  /**
   * Check and handle grace period expirations
   * @returns {Promise<Number>} Number of grace periods expired
   */
  async checkGracePeriodExpirations() {
    const now = moment().utc().toDate();

    // Find subscriptions in grace period that should be expired
    const gracePeriodExpired = await SubscriptionHistory.find({
      status: "active",
      gracePeriodEndsAt: { $ne: null, $lt: now },
    });

    let expiredCount = 0;

    for (const subscription of gracePeriodExpired) {
      // Mark as expired
      await SubscriptionHistory.findByIdAndUpdate(subscription._id, {
        status: "expired",
        cancellationReason: "Grace period expired - subscription expired",
        gracePeriodEndsAt: null,
      });

      // Sync user balance
      if (subscription.user) {
        await BalanceService.syncUserBalanceFromSubscriptions(
          subscription.user.toString()
        );
      }

      expiredCount++;
    }

    return expiredCount;
  }
}

module.exports = new SubscriptionSyncService();

