const cron = require("node-cron");
const logger = require("../config/logger");
const SubscriptionCycleService = require("../services/SubscriptionCycleService");

/**
 * Subscription Cycle Processing Cron Job
 * Runs every 10 minutes to:
 * 1. Process active subscriptions that need cycle renewal
 * 2. Mark expired subscriptions
 * 
 * Schedule: Every 10 minutes (* * * * *)
 */
exports.subscriptionCycleJob = cron.schedule(
  "*/10 * * * * *",
  async () => {
    logger.info("Starting subscription cycle processing job...");

    try {
      const result = await SubscriptionCycleService.processSubscriptionCycles();

      if (result.success) {
        logger.info(
          `Subscription cycle job completed successfully. Processed: ${result.processed}, Expired: ${result.expired}, Errors: ${result.errors}`
        );

        if (result.errors > 0) {
          logger.warn(`Subscription cycle job had ${result.errors} errors:`, result.errorDetails);
        }
      } else {
        logger.error("Subscription cycle job failed:", result.errorDetails);
      }
    } catch (error) {
      logger.error("Error in subscription cycle job:", error);
    }
  },
  {
    scheduled: false,
    timezone: "UTC",
  }
);

