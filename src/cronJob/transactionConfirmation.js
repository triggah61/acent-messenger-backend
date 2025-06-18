const cron = require('node-cron');
const bitcoinWalletService = require('../services/BitcoinWalletService');
const logger = require('../config/logger');

/**
 * Monitor Bitcoin transactions for confirmations
 * Runs every 2 minutes to check pending transactions
 */
exports.transactionConfirmationJob = cron.schedule('*/1 * * * *', async () => {
  logger.info('Starting transaction confirmation job...');
  
  try {
    await bitcoinWalletService.monitorTransactionConfirmations();
    logger.info('Transaction confirmation job completed successfully');
  } catch (error) {
    logger.error('Error in transaction confirmation job:', error);
  }
}, {
  scheduled: true,
  timezone: 'UTC'
});
