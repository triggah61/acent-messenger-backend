const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Import controllers and middleware
const walletController = require('../controller/WalletController');
const authMiddleware = require('../middleware/auth'); // Assuming you have auth middleware
const {
  createWalletValidation,
  importWalletValidation,
  sendTransactionValidation,
  walletIdValidation,
  transactionIdValidation,
  transactionHistoryValidation,
  estimateFeeValidation,
  validateAddressValidation,
  bitcoinPriceValidation,
  walletStatisticsValidation
} = require('../validations/walletValidation');

// Rate limiting configurations
const createWalletLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Limit each IP to 3 wallet creations per windowMs
  message: {
    success: false,
    message: 'Too many wallet creation attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const sendTransactionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 transactions per minute
  message: {
    success: false,
    message: 'Too many transaction attempts, please try again later.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all wallet routes
router.use(generalLimiter);

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @route   POST /api/wallet/create
 * @desc    Create a new Bitcoin wallet
 * @access  Private
 * @body    { password, mnemonic?, label? }
 */
router.post('/create', 
  createWalletLimiter,
  createWalletValidation,
  walletController.createWallet
);

/**
 * @route   POST /api/wallet/import
 * @desc    Import wallet from mnemonic phrase
 * @access  Private
 * @body    { mnemonic, password, label? }
 */
router.post('/import',
  createWalletLimiter,
  importWalletValidation,
  walletController.importWallet
);

/**
 * @route   GET /api/wallet/list
 * @desc    Get all wallets for authenticated user
 * @access  Private
 */
router.get('/list',
  walletController.getUserWallets
);

/**
 * @route   GET /api/wallet/:walletId/balance
 * @desc    Get wallet balance
 * @access  Private
 * @params  walletId
 */
router.get('/:walletId/balance',
  walletIdValidation,
  walletController.getWalletBalance
);

/**
 * @route   POST /api/wallet/send
 * @desc    Send Bitcoin transaction
 * @access  Private
 * @body    { walletId, toAddress, amount, password, priority?, description? }
 */
router.post('/send',
  sendTransactionLimiter,
  sendTransactionValidation,
  walletController.sendTransaction
);

/**
 * @route   GET /api/wallet/:walletId/transactions
 * @desc    Get transaction history for a wallet
 * @access  Private
 * @params  walletId
 * @query   page?, limit?, type?, status?
 */
router.get('/:walletId/transactions',
  transactionHistoryValidation,
  walletController.getTransactionHistory
);

/**
 * @route   GET /api/wallet/transaction/:transactionId
 * @desc    Get transaction details
 * @access  Private
 * @params  transactionId
 */
router.get('/transaction/:transactionId',
  transactionIdValidation,
  walletController.getTransactionDetails
);

/**
 * @route   POST /api/wallet/estimate-fee
 * @desc    Estimate transaction fees
 * @access  Private
 * @body    { walletId, amount, priority? }
 */
router.post('/estimate-fee',
  estimateFeeValidation,
  walletController.estimateTransactionFee
);

/**
 * @route   GET /api/wallet/bitcoin-price
 * @desc    Get current Bitcoin price
 * @access  Private
 * @query   currency?
 */
router.get('/bitcoin-price',
  bitcoinPriceValidation,
  walletController.getBitcoinPrice
);

/**
 * @route   POST /api/wallet/validate-address
 * @desc    Validate Bitcoin address
 * @access  Private
 * @body    { address }
 */
router.post('/validate-address',
  validateAddressValidation,
  walletController.validateAddress
);

/**
 * @route   GET /api/wallet/:walletId/statistics
 * @desc    Get wallet statistics
 * @access  Private
 * @params  walletId
 */
router.get('/:walletId/statistics',
  walletStatisticsValidation,
  walletController.getWalletStatistics
);

/**
 * @route   GET /api/wallet/test-connection
 * @desc    Test QuickNode connection and configuration
 * @access  Private
 */
router.get('/test-connection',
  authMiddleware,
  walletController.testConnection
);

/**
 * @route   POST /api/wallet/trigger-listener
 * @desc    Manually trigger transaction listener scan
 * @access  Private
 */
router.post('/trigger-listener',
  authMiddleware,
  walletController.triggerTransactionListener
);

module.exports = router;