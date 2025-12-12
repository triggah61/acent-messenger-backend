const { transactionConfirmationJob } = require("./transactionConfirmation");
const { btcTransactionListenerJob } = require("./bitcoinTransactionListener");
const { ethTransactionListenerJob } = require("./ethTransactionListener");
const { bscTransactionListenerJob } = require("./bscTransactionListener");
const marketPriceCronjob = require("./MarketPriceCronjob");
const { subscriptionCycleJob } = require("./subscriptionCycle");
const {
  subscriptionSyncJob,
  expiredSubscriptionCleanupJob,
  gracePeriodMonitoringJob,
} = require("./subscriptionSync");

// Start transaction confirmation monitor (every 1 minute)
transactionConfirmationJob.start();

// Start transaction listener for incoming transactions (every 5 minutes)
btcTransactionListenerJob.start();

// Start transaction listener for incoming transactions (every 5 minutes)
ethTransactionListenerJob.start();

// Start transaction listener for incoming transactions (every 5 minutes)
bscTransactionListenerJob.start();

// Start market price cronjob (every 1 minute)
marketPriceCronjob.start();

// Start subscription cycle processing (every 10 minutes)
subscriptionCycleJob.start();

// Start subscription sync job (every 6 hours)
subscriptionSyncJob.start();

// Start expired subscription cleanup job (daily at 2 AM UTC)
expiredSubscriptionCleanupJob.start();

// Start grace period monitoring job (every hour)
gracePeriodMonitoringJob.start();

console.log("✅ All cron jobs started successfully");
console.log("📊 Transaction Confirmation: Running every 1 minute");
console.log("🔍 Transaction Listener: Running every 5 minutes");
console.log("🔄 Subscription Cycle Processing: Running every 10 minutes");
console.log("🔄 Subscription Sync: Running every 6 hours");
console.log("🧹 Expired Subscription Cleanup: Running daily at 2 AM UTC");
console.log("⏰ Grace Period Monitoring: Running every hour");
