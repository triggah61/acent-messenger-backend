const cron = require('node-cron');
const logger = require('../config/logger');
const btcWalletService = require('../services/BtcWalletService');

/**
 * Monitor Bitcoin transactions for confirmations
 * Runs every 2 minutes to check pending transactions
 */
exports.transactionConfirmationJob = cron.schedule('*/2 * * * *', async () => {
  logger.info('Starting transaction confirmation job...');
  
  try {
    await btcWalletService.monitorTransactionConfirmations();
    logger.info('Transaction confirmation job completed successfully');
  } catch (error) {
    logger.error('Error in transaction confirmation job:', error);
  }
}, {
  scheduled: true,
  timezone: 'UTC'
});
