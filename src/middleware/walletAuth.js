const rateLimit = require('express-rate-limit');
const Wallet = require('../model/Wallet');
const Transaction = require('../model/Transaction');
const AppError = require('../exception/AppError');
const logger = require('../config/logger');

/**
 * Enhanced rate limiting for sensitive wallet operations
 */
const createSensitiveOperationLimiter = (windowMs, max, operation) => {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => {
      // Combine IP and user ID for more granular rate limiting
      return `${req.ip}_${req.user?.id}_${operation}`;
    },
    message: {
      success: false,
      message: `Too many ${operation} attempts. Please try again later.`,
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    onLimitReached: (req, res, options) => {
      logger.warn(`Rate limit exceeded for ${operation}`, {
        ip: req.ip,
        userId: req.user?.id,
        userAgent: req.get('User-Agent'),
        operation
      });
    }
  });
};

/**
 * Rate limiter for wallet creation operations
 */
const walletCreationLimiter = createSensitiveOperationLimiter(
  15 * 60 * 1000, // 15 minutes
  3, // 3 attempts
  'wallet_creation'
);

/**
 * Rate limiter for transaction operations
 */
const transactionLimiter = createSensitiveOperationLimiter(
  60 * 1000, // 1 minute
  5, // 5 transactions
  'transaction'
);

/**
 * Rate limiter for password operations
 */
const passwordOperationLimiter = createSensitiveOperationLimiter(
  5 * 60 * 1000, // 5 minutes
  10, // 10 attempts
  'password_operation'
);

/**
 * Middleware to verify wallet ownership
 */
const verifyWalletOwnership = async (req, res, next) => {
  try {
    const { walletId } = req.params;
    const userId = req.user.id;

    if (!walletId) {
      return next(new AppError('Wallet ID is required', 400));
    }

    const wallet = await Wallet.findOne({ 
      _id: walletId, 
      userId,
      status: { $ne: 'deleted' }
    });

    if (!wallet) {
      logger.warn('Unauthorized wallet access attempt', {
        walletId,
        userId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      return next(new AppError('Wallet not found or access denied', 404));
    }

    // Attach wallet to request for use in controllers
    req.wallet = wallet;
    next();

  } catch (error) {
    next(new AppError('Error verifying wallet ownership', 500));
  }
};

/**
 * Middleware to log sensitive operations
 */
const logSensitiveOperation = (operation) => {
  return (req, res, next) => {
    const operationData = {
      operation,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date(),
      walletId: req.params?.walletId || req.body?.walletId,
      amount: req.body?.amount,
      toAddress: req.body?.toAddress
    };

    logger.info(`Sensitive operation: ${operation}`, operationData);

    // Log the operation completion after response
    const originalSend = res.send;
    res.send = function(data) {
      const responseData = typeof data === 'string' ? JSON.parse(data) : data;
      logger.info(`Sensitive operation completed: ${operation}`, {
        ...operationData,
        success: responseData.success,
        status: res.statusCode
      });
      originalSend.call(this, data);
    };

    next();
  };
};

/**
 * Middleware to validate transaction limits
 */
const validateTransactionLimits = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    // Daily transaction limit (in satoshis)
    const DAILY_LIMIT = parseInt(process.env.DAILY_TRANSACTION_LIMIT) || 100000000; // 1 BTC default
    
    // Get today's transactions
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayTransactions = await Transaction.aggregate([
      {
        $match: {
          userId: req.user.id,
          type: { $in: ['withdrawal', 'transfer'] },
          status: { $in: ['confirmed', 'processing', 'pending'] },
          createdAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    const todayTotal = todayTransactions[0]?.totalAmount || 0;
    const todayCount = todayTransactions[0]?.count || 0;

    // Check daily amount limit
    if (todayTotal + amount > DAILY_LIMIT) {
      return next(new AppError(
        `Daily transaction limit exceeded. Limit: ${DAILY_LIMIT} satoshis, Used: ${todayTotal} satoshis`,
        400
      ));
    }

    // Check daily transaction count limit
    const DAILY_COUNT_LIMIT = parseInt(process.env.DAILY_TRANSACTION_COUNT_LIMIT) || 50;
    if (todayCount >= DAILY_COUNT_LIMIT) {
      return next(new AppError(
        `Daily transaction count limit exceeded. Limit: ${DAILY_COUNT_LIMIT} transactions`,
        400
      ));
    }

    // Attach limits info to request
    req.transactionLimits = {
      dailyAmountUsed: todayTotal,
      dailyAmountLimit: DAILY_LIMIT,
      dailyCountUsed: todayCount,
      dailyCountLimit: DAILY_COUNT_LIMIT
    };

    next();

  } catch (error) {
    next(new AppError('Error validating transaction limits', 500));
  }
};

/**
 * Middleware to detect suspicious activities
 */
const detectSuspiciousActivity = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, toAddress } = req.body;

    // Check for rapid successive transactions
    const recentTransactions = await Transaction.find({
      userId,
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }, // Last 5 minutes
      status: { $in: ['pending', 'processing', 'confirmed'] }
    }).sort({ createdAt: -1 }).limit(5);

    // Flag if more than 3 transactions in 5 minutes
    if (recentTransactions.length >= 3) {
      logger.warn('Suspicious activity: Rapid transactions detected', {
        userId,
        recentTransactionCount: recentTransactions.length,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
    }

    // Check for unusual amounts (very large transactions)
    const LARGE_AMOUNT_THRESHOLD = parseInt(process.env.LARGE_AMOUNT_THRESHOLD) || 50000000; // 0.5 BTC
    if (amount > LARGE_AMOUNT_THRESHOLD) {
      logger.warn('Suspicious activity: Large transaction amount', {
        userId,
        amount,
        toAddress,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
    }

    // Check for transactions to previously flagged addresses
    // This would require a blacklist database/service in production
    const flaggedAddresses = process.env.FLAGGED_ADDRESSES?.split(',') || [];
    if (flaggedAddresses.includes(toAddress)) {
      logger.error('Transaction to flagged address attempted', {
        userId,
        toAddress,
        amount,
        ip: req.ip
      });
      return next(new AppError('Transaction to this address is not allowed', 403));
    }

    next();

  } catch (error) {
    logger.error('Error in suspicious activity detection', error);
    // Don't block the transaction for detection errors, just log
    next();
  }
};

/**
 * Middleware to require 2FA for high-value transactions
 */
const require2FAForHighValue = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const HIGH_VALUE_THRESHOLD = parseInt(process.env.HIGH_VALUE_2FA_THRESHOLD) || 20000000; // 0.2 BTC

    if (amount > HIGH_VALUE_THRESHOLD) {
      const { twoFactorToken } = req.body;
      
      if (!twoFactorToken) {
        return next(new AppError('Two-factor authentication required for high-value transactions', 400));
      }

      // Here you would verify the 2FA token
      // This is a placeholder - implement actual 2FA verification
      // const isValid2FA = await verify2FAToken(req.user.id, twoFactorToken);
      // if (!isValid2FA) {
      //   return next(new AppError('Invalid two-factor authentication token', 400));
      // }
    }

    next();

  } catch (error) {
    next(new AppError('Error in 2FA verification', 500));
  }
};

/**
 * Middleware to check wallet status
 */
const checkWalletStatus = async (req, res, next) => {
  try {
    const wallet = req.wallet;

    if (!wallet) {
      return next(new AppError('Wallet information not available', 500));
    }

    if (wallet.status === 'frozen') {
      return next(new AppError('Wallet is frozen. Contact support for assistance.', 403));
    }

    if (wallet.status === 'inactive') {
      return next(new AppError('Wallet is inactive. Please activate your wallet first.', 403));
    }

    if (wallet.status === 'deleted') {
      return next(new AppError('Wallet has been deleted.', 404));
    }

    next();

  } catch (error) {
    next(new AppError('Error checking wallet status', 500));
  }
};

module.exports = {
  walletCreationLimiter,
  transactionLimiter,
  passwordOperationLimiter,
  verifyWalletOwnership,
  logSensitiveOperation,
  validateTransactionLimits,
  detectSuspiciousActivity,
  require2FAForHighValue,
  checkWalletStatus
}; 