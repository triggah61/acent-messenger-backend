const bitcoinWalletService = require('../services/BitcoinWalletService');
const Transaction = require('../model/Transaction');
const Wallet = require('../model/Wallet');
const AppError = require('../exception/AppError');
const { validationResult } = require('express-validator');

/**
 * Create a new Bitcoin wallet for the authenticated user
 */
const createWallet = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const { password, mnemonic, label } = req.body;
    const userId = req.user.id;

    // Check if user already has a main wallet
    const existingWallet = await Wallet.findMainWallet(userId);
    if (existingWallet && !mnemonic) {
      return next(new AppError('User already has a main wallet. Use import functionality for additional wallets.', 400));
    }

    const result = await bitcoinWalletService.createWallet(userId, password, mnemonic, label);

    res.status(201).json({
      success: true,
      message: 'Wallet created successfully',
      data: {
        wallet: result.wallet,
        mnemonic: result.mnemonic, // Important: User should backup this immediately
        warning: 'Please backup your mnemonic phrase immediately. It cannot be recovered if lost.'
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Import wallet from mnemonic phrase
 */
const importWallet = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const { mnemonic, password, label } = req.body;
    const userId = req.user.id;

    const result = await bitcoinWalletService.importWallet(userId, mnemonic, password, label);

    res.status(201).json({
      success: true,
      message: 'Wallet imported successfully',
      data: {
        wallet: result.wallet
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Get all wallets for the authenticated user
 */
const getUserWallets = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const wallets = await bitcoinWalletService.getUserWallets(userId);

    res.status(200).json({
      success: true,
      message: 'Wallets retrieved successfully',
      data: {
        wallets,
        count: wallets.length
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Get wallet balance
 */
const getWalletBalance = async (req, res, next) => {
  try {
    const { walletId } = req.params;
    const userId = req.user.id;

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({ _id: walletId, userId, status: 'active' });
    if (!wallet) {
      return next(new AppError('Wallet not found or access denied', 404));
    }

    const balanceInfo = await bitcoinWalletService.updateWalletBalance(walletId);
    const btcPrice = await bitcoinWalletService.getBitcoinPrice();

    res.status(200).json({
      success: true,
      message: 'Balance retrieved successfully',
      data: {
        address: wallet.address,
        balance: {
          satoshis: balanceInfo.balance,
          btc: bitcoinWalletService.satoshisToBTC(balanceInfo.balance),
          usd: bitcoinWalletService.satoshisToBTC(balanceInfo.balance) * btcPrice
        },
        unconfirmedBalance: {
          satoshis: balanceInfo.unconfirmedBalance,
          btc: bitcoinWalletService.satoshisToBTC(balanceInfo.unconfirmedBalance)
        },
        totalReceived: {
          satoshis: balanceInfo.totalReceived,
          btc: bitcoinWalletService.satoshisToBTC(balanceInfo.totalReceived)
        },
        totalSent: {
          satoshis: balanceInfo.totalSent,
          btc: bitcoinWalletService.satoshisToBTC(balanceInfo.totalSent)
        },
        transactionCount: balanceInfo.nTx
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Send Bitcoin transaction
 */
const sendTransaction = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const { walletId, toAddress, amount, password, priority, description } = req.body;
    const userId = req.user.id;

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({ _id: walletId, userId, status: 'active' });
    if (!wallet) {
      return next(new AppError('Wallet not found or access denied', 404));
    }

    // Validate recipient address
    if (!bitcoinWalletService.validateAddress(toAddress)) {
      return next(new AppError('Invalid recipient address', 400));
    }

    // Convert amount to satoshis if provided in BTC
    const amountInSatoshis = typeof amount === 'number' && amount < 1 
      ? bitcoinWalletService.btcToSatoshis(amount)
      : amount;

    // Additional security: Log transaction attempt
    console.log(`Transaction attempt: User ${userId}, Wallet ${walletId}, Amount: ${amountInSatoshis}, To: ${toAddress}`);

    const result = await bitcoinWalletService.sendTransaction(
      walletId,
      toAddress,
      amountInSatoshis,
      password,
      priority || 'medium',
      description
    );

    res.status(200).json({
      success: true,
      message: result.success ? 'Transaction sent successfully' : 'Transaction failed',
      data: {
        transactionId: result.transactionId,
        txHash: result.txHash,
        amount: {
          satoshis: result.amount,
          btc: bitcoinWalletService.satoshisToBTC(result.amount)
        },
        fees: {
          network: {
            satoshis: result.fee,
            btc: bitcoinWalletService.satoshisToBTC(result.fee)
          },
          platform: {
            satoshis: result.platformFee,
            btc: bitcoinWalletService.satoshisToBTC(result.platformFee)
          }
        },
        status: result.status
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Get transaction history for a wallet
 */
const getTransactionHistory = async (req, res, next) => {
  try {
    const { walletId } = req.params;
    const { page = 1, limit = 10, type, status } = req.query;
    const userId = req.user.id;

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({ _id: walletId, userId });
    if (!wallet) {
      return next(new AppError('Wallet not found or access denied', 404));
    }

    // Build query
    const query = {
      $or: [
        { fromAddress: wallet.address },
        { toAddress: wallet.address }
      ]
    };

    if (type) query.type = type;
    if (status) query.status = status;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: 'userId'
    };

    const transactions = await Transaction.aggregatePaginate(
      Transaction.aggregate([
        { $match: query }
      ]),
      options
    );

    // Format transactions for response
    const formattedTransactions = transactions.docs.map(tx => ({
      id: tx._id,
      txHash: tx.txHash,
      type: tx.type,
      direction: tx.fromAddress === wallet.address ? 'sent' : 'received',
      amount: {
        satoshis: tx.amount,
        btc: bitcoinWalletService.satoshisToBTC(tx.amount)
      },
      fee: {
        satoshis: tx.fee,
        btc: bitcoinWalletService.satoshisToBTC(tx.fee)
      },
      adminFee: {
        satoshis: tx.adminFee,
        btc: bitcoinWalletService.satoshisToBTC(tx.adminFee)
      },
      netAmount: {
        satoshis: tx.netAmount,
        btc: bitcoinWalletService.satoshisToBTC(tx.netAmount)
      },
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      status: tx.status,
      confirmations: tx.confirmations,
      description: tx.description,
      submittedAt: tx.submittedAt,
      confirmedAt: tx.confirmedAt,
      createdAt: tx.createdAt
    }));

    res.status(200).json({
      success: true,
      message: 'Transaction history retrieved successfully',
      data: {
        transactions: formattedTransactions,
        pagination: {
          page: transactions.page,
          limit: transactions.limit,
          totalPages: transactions.totalPages,
          totalDocs: transactions.totalDocs,
          hasNextPage: transactions.hasNextPage,
          hasPrevPage: transactions.hasPrevPage
        }
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Get single transaction details
 */
const getTransactionDetails = async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;

    const transaction = await Transaction.findOne({
      _id: transactionId,
      userId
    }).populate('userId relatedTransactions');

    if (!transaction) {
      return next(new AppError('Transaction not found', 404));
    }

    // Get blockchain details if transaction is confirmed
    let blockchainDetails = null;
    if (transaction.txHash) {
      try {
        blockchainDetails = await bitcoinWalletService.getTransactionDetails(transaction.txHash);
      } catch (error) {
        console.error('Error fetching blockchain details:', error.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Transaction details retrieved successfully',
      data: {
        transaction: {
          id: transaction._id,
          internalId: transaction.internalId,
          txHash: transaction.txHash,
          type: transaction.type,
          amount: {
            satoshis: transaction.amount,
            btc: bitcoinWalletService.satoshisToBTC(transaction.amount)
          },
          fee: {
            satoshis: transaction.fee,
            btc: bitcoinWalletService.satoshisToBTC(transaction.fee)
          },
          adminFee: {
            satoshis: transaction.adminFee,
            btc: bitcoinWalletService.satoshisToBTC(transaction.adminFee)
          },
          netAmount: {
            satoshis: transaction.netAmount,
            btc: bitcoinWalletService.satoshisToBTC(transaction.netAmount)
          },
          fromAddress: transaction.fromAddress,
          toAddress: transaction.toAddress,
          status: transaction.status,
          confirmations: transaction.confirmations,
          blockNumber: transaction.blockNumber,
          blockHash: transaction.blockHash,
          priority: transaction.priority,
          description: transaction.description,
          tags: transaction.tags,
          submittedAt: transaction.submittedAt,
          processedAt: transaction.processedAt,
          confirmedAt: transaction.confirmedAt,
          createdAt: transaction.createdAt,
          inputs: transaction.inputs,
          outputs: transaction.outputs,
          relatedTransactions: transaction.relatedTransactions
        },
        blockchainDetails
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Estimate transaction fees
 */
const estimateTransactionFee = async (req, res, next) => {
  try {
    const { walletId, amount, priority = 'medium' } = req.body;
    const userId = req.user.id;

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({ _id: walletId, userId, status: 'active' });
    if (!wallet) {
      return next(new AppError('Wallet not found or access denied', 404));
    }

    // Get UTXOs to estimate input count
    const utxos = await bitcoinWalletService.getUTXOs(wallet.address);
    const inputCount = Math.min(utxos.length, 10); // Limit to 10 inputs for estimation

    // Calculate fees
    const networkFee = bitcoinWalletService.calculateTransactionFee(inputCount, 2, priority);
    const platformFee = bitcoinWalletService.calculatePlatformFee(amount);
    const totalFees = networkFee + platformFee;

    res.status(200).json({
      success: true,
      message: 'Transaction fees estimated successfully',
      data: {
        fees: {
          network: {
            satoshis: networkFee,
            btc: bitcoinWalletService.satoshisToBTC(networkFee)
          },
          platform: {
            satoshis: platformFee,
            btc: bitcoinWalletService.satoshisToBTC(platformFee),
            percentage: (bitcoinWalletService.platformFeePercentage * 100).toFixed(2) + '%'
          },
          total: {
            satoshis: totalFees,
            btc: bitcoinWalletService.satoshisToBTC(totalFees)
          }
        },
        totalRequired: {
          satoshis: amount + totalFees,
          btc: bitcoinWalletService.satoshisToBTC(amount + totalFees)
        },
        priority,
        estimatedConfirmationTime: {
          low: '60-120 minutes',
          medium: '10-30 minutes',
          high: '5-15 minutes'
        }[priority] || '10-30 minutes'
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Get current Bitcoin price
 */
const getBitcoinPrice = async (req, res, next) => {
  try {
    const { currency = 'USD' } = req.query;
    const price = await bitcoinWalletService.getBitcoinPrice(currency);

    res.status(200).json({
      success: true,
      message: 'Bitcoin price retrieved successfully',
      data: {
        price,
        currency,
        timestamp: new Date()
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Validate Bitcoin address
 */
const validateAddress = async (req, res, next) => {
  try {
    const { address } = req.body;
    const isValid = bitcoinWalletService.validateAddress(address);

    res.status(200).json({
      success: true,
      message: 'Address validation completed',
      data: {
        address,
        isValid,
        network: bitcoinWalletService.network === require('bitcoinjs-lib').networks.bitcoin ? 'mainnet' : 'testnet'
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Get wallet statistics
 */
const getWalletStatistics = async (req, res, next) => {
  try {
    const { walletId } = req.params;
    const userId = req.user.id;

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({ _id: walletId, userId });
    if (!wallet) {
      return next(new AppError('Wallet not found or access denied', 404));
    }

    // Get transaction statistics
    const stats = await Transaction.aggregate([
      {
        $match: {
          $or: [
            { fromAddress: wallet.address },
            { toAddress: wallet.address }
          ],
          status: 'confirmed'
        }
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalSent: {
            $sum: {
              $cond: [
                { $eq: ['$fromAddress', wallet.address] },
                { $add: ['$amount', '$fee', '$adminFee'] },
                0
              ]
            }
          },
          totalReceived: {
            $sum: {
              $cond: [
                { $eq: ['$toAddress', wallet.address] },
                '$netAmount',
                0
              ]
            }
          },
          totalFeesPaid: {
            $sum: {
              $cond: [
                { $eq: ['$fromAddress', wallet.address] },
                { $add: ['$fee', '$adminFee'] },
                0
              ]
            }
          }
        }
      }
    ]);

    const statistics = stats[0] || {
      totalTransactions: 0,
      totalSent: 0,
      totalReceived: 0,
      totalFeesPaid: 0
    };

    res.status(200).json({
      success: true,
      message: 'Wallet statistics retrieved successfully',
      data: {
        wallet: {
          address: wallet.address,
          label: wallet.label,
          createdAt: wallet.createdAt,
          lastUsed: wallet.lastUsed
        },
        statistics: {
          totalTransactions: statistics.totalTransactions,
          totalSent: {
            satoshis: statistics.totalSent,
            btc: bitcoinWalletService.satoshisToBTC(statistics.totalSent)
          },
          totalReceived: {
            satoshis: statistics.totalReceived,
            btc: bitcoinWalletService.satoshisToBTC(statistics.totalReceived)
          },
          totalFeesPaid: {
            satoshis: statistics.totalFeesPaid,
            btc: bitcoinWalletService.satoshisToBTC(statistics.totalFeesPaid)
          },
          currentBalance: {
            satoshis: wallet.balance,
            btc: bitcoinWalletService.satoshisToBTC(wallet.balance)
          }
        }
      }
    });

  } catch (error) {
    next(error);
  }
};

module.exports = {
  createWallet,
  importWallet,
  getUserWallets,
  getWalletBalance,
  sendTransaction,
  getTransactionHistory,
  getTransactionDetails,
  estimateTransactionFee,
  getBitcoinPrice,
  validateAddress,
  getWalletStatistics
}; 