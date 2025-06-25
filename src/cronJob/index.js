const { transactionConfirmationJob } = require("./transactionConfirmation");
const { btcTransactionListenerJob } = require("./bitcoinTransactionListener");
const { ethTransactionListenerJob } = require("./ethTransactionListener");
const { bscTransactionListenerJob } = require("./bscTransactionListener");
const marketPriceCronjob = require("./MarketPriceCronjob");

// Start transaction confirmation monitor (every 1 minute)
transactionConfirmationJob.start();

// Start transaction listener for incoming transactions (every 5 minutes)
btcTransactionListenerJob.start();

// Start transaction listener for incoming transactions (every 5 minutes)
ethTransactionListenerJob.start();

// Start transaction listener for incoming transactions (every 5 minutes)
bscTransactionListenerJob.stop();

// Start market price cronjob (every 1 minute)
marketPriceCronjob.start();

console.log("✅ All cron jobs started successfully");
console.log("📊 Transaction Confirmation: Running every 1 minute");
console.log("🔍 Transaction Listener: Running every 5 minutes");
