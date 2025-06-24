const { transactionConfirmationJob } = require("./transactionConfirmation");
const { btcTransactionListenerJob } = require("./bitcoinTransactionListener");

// Start transaction confirmation monitor (every 1 minute)
transactionConfirmationJob.start();

// Start transaction listener for incoming transactions (every 5 minutes)
btcTransactionListenerJob.start();

console.log("✅ All cron jobs started successfully");
console.log("📊 Transaction Confirmation: Running every 1 minute");
console.log("🔍 Transaction Listener: Running every 5 minutes");
