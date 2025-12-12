const cron = require("node-cron");
const logger = require("../config/logger");
const subscriptionSyncService = require("../services/SubscriptionSyncService");

/**
 * Subscription Status Sync Cron Job
 * Runs every 6 hours to:
 * 1. Verify all active subscriptions with Google Play API
 * 2. Update subscription status based on Google Play data
 * 3. Sync user balances
 * 
 */
exports.subscriptionSyncJob = cron.schedule(
  "0 */6 * * *", // Every 6 hours
  async () => {
    logger.info("Starting subscription sync job...");

    try {
      const result = await subscriptionSyncService.syncAllActiveSubscriptions();

      if (result.success) {
        logger.info(
          `Subscription sync job completed successfully. Total: ${result.total}, Synced: ${result.synced}, Expired: ${result.expired}, Errors: ${result.errors}`
        );

        if (result.errors > 0) {
          logger.warn(
            `Subscription sync job had ${result.errors} errors:`,
            result.errorDetails
          );
        }
      } else {
        logger.error("Subscription sync job failed:", result.error);
      }
    } catch (error) {
      logger.error("Error in subscription sync job:", error);
    }
  },
  {
    scheduled: false,
    timezone: "UTC",
  }
);

/**
 * Expired Subscription Cleanup Cron Job
 * Runs daily at 2 AM UTC to:
 * 1. Mark subscriptions as expired if past expiration date
 * 2. Update user subscription status
 * 3. Zero out subscription balance if expired
 * 
 * Schedule: Daily at 2 AM UTC (0 2 * * *)
 */
exports.expiredSubscriptionCleanupJob = cron.schedule(
  "0 2 * * *", // Daily at 2 AM UTC
  async () => {
    logger.info("Starting expired subscription cleanup job...");

    try {
      const expiredCount = await subscriptionSyncService.checkAndMarkExpiredSubscriptions();

      logger.info(
        `Expired subscription cleanup job completed. Expired: ${expiredCount}`
      );
    } catch (error) {
      logger.error("Error in expired subscription cleanup job:", error);
    }
  },
  {
    scheduled: false,
    timezone: "UTC",
  }
);

/**
 * Grace Period Monitoring Cron Job
 * Runs every hour to:
 * 1. Check subscriptions in grace period
 * 2. Expire subscriptions if grace period ended
 * 
 * Schedule: Every hour (0 * * * *)
 */
exports.gracePeriodMonitoringJob = cron.schedule(
  "0 * * * *", // Every hour
  async () => {
    logger.info("Starting grace period monitoring job...");

    try {
      const expiredCount = await subscriptionSyncService.checkGracePeriodExpirations();

      if (expiredCount > 0) {
        logger.info(
          `Grace period monitoring job completed. Grace periods expired: ${expiredCount}`
        );
      }
    } catch (error) {
      logger.error("Error in grace period monitoring job:", error);
    }
  },
  {
    scheduled: false,
    timezone: "UTC",
  }
);

