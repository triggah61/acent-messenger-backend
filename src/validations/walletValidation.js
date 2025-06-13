const { body, param, query } = require('express-validator');

/**
 * Validation rules for creating a new wallet
 */
const createWalletValidation = [
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  body('mnemonic')
    .optional()
    .isLength({ min: 10 })
    .withMessage('Mnemonic phrase is too short')
    .custom((value) => {
      if (value) {
        const words = value.trim().split(/\s+/);
        if (words.length < 12 || words.length > 24) {
          throw new Error('Mnemonic must contain between 12 and 24 words');
        }
        // Basic validation - real validation happens in service layer
        if (!/^[a-z\s]+$/.test(value.toLowerCase())) {
          throw new Error('Mnemonic can only contain lowercase letters and spaces');
        }
      }
      return true;
    }),
  
  body('label')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Label must be between 1 and 100 characters')
    .trim()
    .escape()
];

/**
 * Validation rules for importing a wallet
 */
const importWalletValidation = [
  body('mnemonic')
    .notEmpty()
    .withMessage('Mnemonic phrase is required')
    .isLength({ min: 10 })
    .withMessage('Mnemonic phrase is too short')
    .custom((value) => {
      const words = value.trim().split(/\s+/);
      if (words.length < 12 || words.length > 24) {
        throw new Error('Mnemonic must contain between 12 and 24 words');
      }
      if (!/^[a-z\s]+$/.test(value.toLowerCase())) {
        throw new Error('Mnemonic can only contain lowercase letters and spaces');
      }
      return true;
    }),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  body('label')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Label must be between 1 and 100 characters')
    .trim()
    .escape()
];

/**
 * Validation rules for sending transactions
 */
const sendTransactionValidation = [
  body('walletId')
    .isMongoId()
    .withMessage('Invalid wallet ID'),
  
  body('toAddress')
    .notEmpty()
    .withMessage('Recipient address is required')
    .isLength({ min: 26, max: 62 })
    .withMessage('Invalid Bitcoin address length')
    .matches(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^(bc1|tb1)[a-z0-9]{39,59}$/)
    .withMessage('Invalid Bitcoin address format'),
  
  body('amount')
    .isInt({ min: 1 })
    .withMessage('Amount must be a positive integer (in satoshis)')
    .custom((value) => {
      // Maximum Bitcoin amount is 21 million BTC = 2,100,000,000,000,000 satoshis
      if (value > 2100000000000000) {
        throw new Error('Amount exceeds maximum possible Bitcoin value');
      }
      return true;
    }),
  
  body('password')
    .notEmpty()
    .withMessage('Wallet password is required')
    .isLength({ min: 1 })
    .withMessage('Password cannot be empty'),
  
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'custom'])
    .withMessage('Priority must be one of: low, medium, high, custom'),
  
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters')
    .trim()
    .escape()
];

/**
 * Validation rules for wallet ID parameter
 */
const walletIdValidation = [
  param('walletId')
    .isMongoId()
    .withMessage('Invalid wallet ID')
];

/**
 * Validation rules for transaction ID parameter
 */
const transactionIdValidation = [
  param('transactionId')
    .isMongoId()
    .withMessage('Invalid transaction ID')
];

/**
 * Validation rules for transaction history query parameters
 */
const transactionHistoryValidation = [
  param('walletId')
    .isMongoId()
    .withMessage('Invalid wallet ID'),
  
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('type')
    .optional()
    .isIn(['deposit', 'withdrawal', 'transfer', 'fee', 'admin_fee'])
    .withMessage('Invalid transaction type'),
  
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'failed', 'cancelled', 'processing'])
    .withMessage('Invalid transaction status')
];

/**
 * Validation rules for fee estimation
 */
const estimateFeeValidation = [
  body('walletId')
    .isMongoId()
    .withMessage('Invalid wallet ID'),
  
  body('amount')
    .isInt({ min: 1 })
    .withMessage('Amount must be a positive integer (in satoshis)')
    .custom((value) => {
      if (value > 2100000000000000) {
        throw new Error('Amount exceeds maximum possible Bitcoin value');
      }
      return true;
    }),
  
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'custom'])
    .withMessage('Priority must be one of: low, medium, high, custom')
];

/**
 * Validation rules for address validation
 */
const validateAddressValidation = [
  body('address')
    .notEmpty()
    .withMessage('Address is required')
    .isLength({ min: 26, max: 62 })
    .withMessage('Invalid Bitcoin address length')
];

/**
 * Validation rules for Bitcoin price query
 */
const bitcoinPriceValidation = [
  query('currency')
    .optional()
    .isLength({ min: 3, max: 3 })
    .withMessage('Currency code must be 3 characters')
    .isAlpha()
    .withMessage('Currency code must contain only letters')
    .toUpperCase()
];

/**
 * Validation rules for wallet statistics
 */
const walletStatisticsValidation = [
  param('walletId')
    .isMongoId()
    .withMessage('Invalid wallet ID')
];

module.exports = {
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
}; 