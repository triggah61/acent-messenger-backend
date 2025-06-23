const bitcoinWalletService = require("../services/BitcoinWalletService");
const Transaction = require("../model/Transaction");
const Wallet = require("../model/Wallet");
const AppError = require("../exception/AppError");
const { validationResult } = require("express-validator");
const SimpleValidator = require("../validator/simpleValidator");
const catchAsync = require("../exception/catchAsync");

/**
 * Create a new Bitcoin wallet for the authenticated user
 */
exports.createWallet = catchAsync(async (req, res, next) => {
  let checkWallet = await Wallet.findOne({ userId: req.user._id });
  if (checkWallet) {
    throw new AppError("Wallet already exists", 400);
  }

  try {
    const userId = req.user._id;
    const result = await bitcoinWalletService.createWallet(
      userId,
      "Main Wallet"
    );

    res.status(201).json({
      success: true,
      message: "Wallet created successfully",
      data: {
        wallet: result.wallet,
      },
    });
  } catch (error) {
    next(error);
  }
});

exports.walletInformation = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const wallet = await Wallet.findOne({ userId });

  if (!wallet) {
    throw new AppError("Wallet not found", 400);
  }

  const btcBalanceData = await bitcoinWalletService.getWalletBalance(
    wallet.btcAddress
  );

  let availableBtcBalance = Number(btcBalanceData.balance);

  if (Number(btcBalanceData.unconfirmedBalance) < 0) {
    availableBtcBalance += Number(btcBalanceData.unconfirmedBalance);
  }

  let btcBalance = bitcoinWalletService.satoshisToBTC(availableBtcBalance);

  let btcPrice = await bitcoinWalletService.getBitcoinPrice("USD");

  let usdBalance = btcPrice * btcBalance;

  res.status(200).json({
    success: true,
    message: "Wallet information retrieved successfully",
    data: {
      _id: wallet._id,
      btcAddress: wallet.btcAddress,
      ethAddress: wallet.ethAddress,
      bscAddress: wallet.bscAddress,
      label: wallet.label,
      createdAt: wallet.createdAt,
      lastUsed: wallet.lastUsed,
      network: wallet.network,
      // balance: balance,
      availableBtcBalance: availableBtcBalance,
      btcBalance: btcBalance,
      ethBalance: 0,
      bscBalance: 0,
      usdBalance: usdBalance,
      // networkFee,
      platformFeePercentage: bitcoinWalletService.platformFeePercentage,
    },
  });
});

/**
 * Send Bitcoin transaction
 */
exports.sendTransaction = catchAsync(async (req, res) => {
  SimpleValidator(req.body, {
    toAddress: "required|string",
    amount: "required|numeric",
    priority: "required|in:low,medium,high,custom",
  });
  console.log(req.body);
  let { walletId, toAddress, amount, priority, description } = req.body;
  const userId = req.user._id;

  // Verify wallet belongs to user
  const wallet = await Wallet.findOne({
    userId,
    status: "active",
  });
  if (!wallet) {
    throw new AppError("Wallet not found or access denied", 404);
  }

  // Validate recipient address
  if (!bitcoinWalletService.validateAddress(toAddress)) {
    throw new AppError("Invalid recipient address", 400);
  }

  // Convert amount to satoshis if provided in BTC
  let amountInSatoshis = amount;
  if (typeof amount === "number" && amount < 1) {
    amountInSatoshis = bitcoinWalletService.btcToSatoshis(amount);
  }

  // Additional security: Log transaction attempt
  console.log(
    `Transaction attempt: User ${userId}, Wallet ${walletId}, Amount: ${amountInSatoshis}, To: ${toAddress}`
  );

  const result = await bitcoinWalletService.sendTransaction(
    wallet._id,
    toAddress,
    amountInSatoshis,
    process.env.WALLET_ENCRYPTION_KEY,
    priority || "medium",
    description
  );

  res.status(200).json({
    success: true,
    message: result.success
      ? "Transaction sent successfully"
      : "Transaction failed",
    data: {
      transactionId: result.transactionId,
      txHash: result.txHash,
      amount: {
        satoshis: result.amount,
        btc: bitcoinWalletService.satoshisToBTC(result.amount),
      },
      fees: {
        network: {
          satoshis: result.fee,
          btc: bitcoinWalletService.satoshisToBTC(result.fee),
        },
        platform: {
          satoshis: result.platformFee,
          btc: bitcoinWalletService.satoshisToBTC(result.platformFee),
        },
      },
      status: result.status,
    },
  });
});

/**
 * Get transaction history for a wallet
 */
exports.getTransactionHistory = async (req, res, next) => {
  try {
    const { walletId } = req.params;
    const { page = 1, limit = 10, type, status } = req.query;
    const userId = req.user._id;

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return next(new AppError("Wallet not found or access denied", 404));
    }

    // Build query
    const query = {
      userId: userId,
    };

    if (type) query.type = type;
    if (status) query.status = status;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: "userId",
    };

    const transactions = await Transaction.aggregatePaginate(
      Transaction.aggregate([{ $match: query }]),
      options
    );

    // Format transactions for response
    const formattedTransactions = transactions.docs.map((tx) => ({
      id: tx._id,
      txHash: tx.txHash,
      type: tx.type,
      direction: tx.fromAddress === wallet.btcAddress ? "sent" : "received",
      amount: {
        satoshis: tx.amount,
        btc: bitcoinWalletService.satoshisToBTC(tx.amount),
      },
      fee: {
        satoshis: tx.fee,
        btc: bitcoinWalletService.satoshisToBTC(tx.fee),
      },
      adminFee: {
        satoshis: tx.adminFee,
        btc: bitcoinWalletService.satoshisToBTC(tx.adminFee),
      },
      netAmount: {
        satoshis: tx.netAmount,
        btc: bitcoinWalletService.satoshisToBTC(tx.netAmount),
      },
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      status: tx.status,
      confirmations: tx.confirmations,
      description: tx.description,
      submittedAt: tx.submittedAt,
      confirmedAt: tx.confirmedAt,
      createdAt: tx.createdAt,
    }));

    res.status(200).json({
      success: true,
      message: "Transaction history retrieved successfully",
      data: {
        transactions: formattedTransactions,
        pagination: {
          page: transactions.page,
          limit: transactions.limit,
          totalPages: transactions.totalPages,
          totalDocs: transactions.totalDocs,
          hasNextPage: transactions.hasNextPage,
          hasPrevPage: transactions.hasPrevPage,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single transaction details
 */
exports.getTransactionDetails = async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user._id;

    const transaction = await Transaction.findOne({
      _id: transactionId,
      userId,
    }).populate("userId relatedTransactions");

    if (!transaction) {
      return next(new AppError("Transaction not found", 404));
    }

    // Get blockchain details if transaction is confirmed
    let blockchainDetails = null;
    if (transaction.txHash) {
      try {
        blockchainDetails = await bitcoinWalletService.getTransactionDetails(
          transaction.txHash
        );
      } catch (error) {
        console.error("Error fetching blockchain details:", error.message);
      }
    }

    res.status(200).json({
      success: true,
      message: "Transaction details retrieved successfully",
      data: {
        transaction: {
          id: transaction._id,
          internalId: transaction.internalId,
          txHash: transaction.txHash,
          type: transaction.type,
          amount: {
            satoshis: transaction.amount,
            btc: bitcoinWalletService.satoshisToBTC(transaction.amount),
          },
          fee: {
            satoshis: transaction.fee,
            btc: bitcoinWalletService.satoshisToBTC(transaction.fee),
          },
          adminFee: {
            satoshis: transaction.adminFee,
            btc: bitcoinWalletService.satoshisToBTC(transaction.adminFee),
          },
          netAmount: {
            satoshis: transaction.netAmount,
            btc: bitcoinWalletService.satoshisToBTC(transaction.netAmount),
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
          relatedTransactions: transaction.relatedTransactions,
        },
        blockchainDetails,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Estimate transaction fees
 */
exports.estimateTransactionFee = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const userId = req.user._id;

    console.log("amount", amount);

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({
      userId,
    });
    if (!wallet) {
      return next(new AppError("Wallet not found or access denied", 404));
    }

    // Get UTXOs to estimate input count
    const utxos = await bitcoinWalletService.getUTXOs(wallet.btcAddress);
    const inputCount = Math.min(utxos.length, 10); // Limit to 10 inputs for estimation
    console.log("inputCount", inputCount);

    // Calculate fees
    const networkFee = {
      low: bitcoinWalletService.calculateTransactionFee(inputCount, 2, "low"),
      medium: bitcoinWalletService.calculateTransactionFee(
        inputCount,
        2,
        "medium"
      ),
      high: bitcoinWalletService.calculateTransactionFee(inputCount, 2, "high"),
    };

    const platformFeeAmount = bitcoinWalletService.calculatePlatformFee(amount);
    const dustThreshold = 546; // Bitcoin dust threshold

    let fees = {
      low: {
        network: {
          satoshis: networkFee.low,
          btc: bitcoinWalletService.satoshisToBTC(networkFee.low),
        },
        platform: {
          satoshis: platformFeeAmount, // Always show full platform fee
          btc: bitcoinWalletService.satoshisToBTC(platformFeeAmount),
        },
      },
      medium: {
        network: {
          satoshis: networkFee.medium,
          btc: bitcoinWalletService.satoshisToBTC(networkFee.medium),
        },
        platform: {
          satoshis: platformFeeAmount, // Always show full platform fee
          btc: bitcoinWalletService.satoshisToBTC(platformFeeAmount),
        },
      },
      high: {
        network: {
          satoshis: networkFee.high,
          btc: bitcoinWalletService.satoshisToBTC(networkFee.high),
        },
        platform: {
          satoshis: platformFeeAmount, // Always show full platform fee
          btc: bitcoinWalletService.satoshisToBTC(platformFeeAmount),
        },
      },
    };

    res.status(200).json({
      success: true,
      message: "Transaction fees estimated successfully",
      data: {
        fees,
        dustHandling: {
          dustThreshold: dustThreshold,
          platformFeeIsDust: platformFeeAmount < dustThreshold,
          note:
            platformFeeAmount < dustThreshold
              ? "Platform fee is below dust threshold - will be added to network fee for miners, but you still pay the full platform fee"
              : "Platform fee will be sent to admin wallet",
        },
        estimatedConfirmationTime: {
          low: "60-120 minutes",
          medium: "10-30 minutes",
          high: "5-15 minutes",
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current Bitcoin price
 */
exports.getBitcoinPrice = async (req, res, next) => {
  try {
    const { currency = "USD" } = req.query;
    const price = await bitcoinWalletService.getBitcoinPrice(currency);

    res.status(200).json({
      success: true,
      message: "Bitcoin price retrieved successfully",
      data: {
        price,
        currency,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Validate Bitcoin address
 */
exports.validateAddress = async (req, res, next) => {
  try {
    const { address } = req.body;
    const isValid = bitcoinWalletService.validateAddress(address);

    res.status(200).json({
      success: true,
      message: "Address validation completed",
      data: {
        address,
        isValid,
        network:
          bitcoinWalletService.network ===
          require("bitcoinjs-lib").networks.bitcoin
            ? "mainnet"
            : "testnet",
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get wallet statistics
 */
exports.getWalletStatistics = async (req, res, next) => {
  try {
    const { walletId } = req.params;
    const userId = req.user._id;

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({ _id: walletId, userId });
    if (!wallet) {
      return next(new AppError("Wallet not found or access denied", 404));
    }

    // Get transaction statistics
    const stats = await Transaction.aggregate([
      {
        $match: {
          userId: userId,
          status: "confirmed",
        },
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalSent: {
            $sum: {
              $cond: [
                { $eq: ["$fromAddress", wallet.btcAddress] },
                { $add: ["$amount", "$fee", "$adminFee"] },
                0,
              ],
            },
          },
          totalReceived: {
            $sum: {
              $cond: [
                { $eq: ["$toAddress", wallet.btcAddress] },
                "$netAmount",
                0,
              ],
            },
          },
          totalFeesPaid: {
            $sum: {
              $cond: [
                { $eq: ["$fromAddress", wallet.btcAddress] },
                { $add: ["$fee", "$adminFee"] },
                0,
              ],
            },
          },
        },
      },
    ]);

    const statistics = stats[0] || {
      totalTransactions: 0,
      totalSent: 0,
      totalReceived: 0,
      totalFeesPaid: 0,
    };

    res.status(200).json({
      success: true,
      message: "Wallet statistics retrieved successfully",
      data: {
        wallet: {
          btcAddress: wallet.btcAddress,
          ethAddress: wallet.ethAddress,
          bscAddress: wallet.bscAddress,
          label: wallet.label,
          createdAt: wallet.createdAt,
          lastUsed: wallet.lastUsed,
        },
        statistics: {
          totalTransactions: statistics.totalTransactions,
          totalSent: {
            satoshis: statistics.totalSent,
            btc: bitcoinWalletService.satoshisToBTC(statistics.totalSent),
          },
          totalReceived: {
            satoshis: statistics.totalReceived,
            btc: bitcoinWalletService.satoshisToBTC(statistics.totalReceived),
          },
          totalFeesPaid: {
            satoshis: statistics.totalFeesPaid,
            btc: bitcoinWalletService.satoshisToBTC(statistics.totalFeesPaid),
          },
          currentBalance: {
            satoshis: wallet.balance,
            btc: bitcoinWalletService.satoshisToBTC(wallet.balance),
          },
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Test QuickNode connection
 */
exports.testConnection = async (req, res, next) => {
  try {
    const result = await bitcoinWalletService.testConnection();

    res.status(200).json({
      success: true,
      message: "Connection test completed",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Manually trigger transaction listener scan
 */
exports.triggerTransactionListener = async (req, res, next) => {
  try {
    // Import the transaction listener service
    const {
      TransactionListenerService,
    } = require("../cronJob/transactionListener");
    const listener = new TransactionListenerService();

    // Run the scan manually
    await listener.scanForNewTransactions();

    res.status(200).json({
      success: true,
      message: "Transaction listener scan completed manually",
      data: {
        timestamp: new Date(),
        note: "Check server logs for detailed results",
      },
    });
  } catch (error) {
    next(error);
  }
};

// module.exports = {
//   createWallet,
//   sendTransaction,
//   getTransactionHistory,
//   getTransactionDetails,
//   estimateTransactionFee,
//   getBitcoinPrice,
//   validateAddress,
//   getWalletStatistics,
// };
