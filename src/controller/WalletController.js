const multiChainWalletService = require("../services/MultiChainWalletService");
const Transaction = require("../model/Transaction");
const Wallet = require("../model/Wallet");
const AppError = require("../exception/AppError");
const { validationResult } = require("express-validator");
const SimpleValidator = require("../validator/simpleValidator");
const catchAsync = require("../exception/catchAsync");
const { default: mongoose } = require("mongoose");
const EthWalletService = require("../services/EthWalletService");
const BscWalletService = require("../services/BscWalletService");

/**
 * Create a new multi-chain wallet for the authenticated user
 */
exports.createWallet = catchAsync(async (req, res, next) => {
  let checkWallet = await Wallet.findOne({ userId: req.user._id });
  if (checkWallet) {
    throw new AppError("Wallet already exists", 400);
  }

  try {
    const userId = req.user._id;
    const result = await multiChainWalletService.createWallet(
      userId,
      "Main Wallet"
    );

    res.status(201).json({
      success: true,
      message: "Multi-chain wallet created successfully",
      data: {
        wallet: result.wallet,
        supportedCurrencies: multiChainWalletService.getSupportedCurrencies(),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get wallet information for authenticated user
 */
exports.walletInformation = catchAsync(async (req, res) => {
  const userId = req.user._id;

  try {
    // Get user wallets
    const wallets = await multiChainWalletService.getUserWallets(userId);

    if (wallets.length === 0) {
      throw new AppError("No wallet found for this user", 404);
    }

    const wallet = wallets[0]; // Assuming one wallet per user for now

    // Get BTC balance (primary balance for backward compatibility)
    let btcBalanceInfo = { balance: 0 };
    let availableBtcBalance = 0;
    let btcBalance = 0;

    if (wallet.btcAddress) {
      try {
        btcBalanceInfo = await multiChainWalletService.getWalletBalance(
          wallet.btcAddress,
          "BTC"
        );
        availableBtcBalance = btcBalanceInfo.balance || 0; // Balance in satoshis
        btcBalance = availableBtcBalance / 100000000; // Convert to BTC
      } catch (error) {
        console.error("Failed to get BTC balance:", error.message);
      }
    }

    // Get USD value (using a simple rate for now - in production, use real-time rates)
    let usdBalance = 0;
    try {
      // Get Bitcoin price from Coinbase API
      const response = await require("axios").get(
        "https://api.coinbase.com/v2/exchange-rates?currency=BTC"
      );
      const btcToUsdRate = parseFloat(response.data.data.rates.USD);
      usdBalance = btcBalance * btcToUsdRate;
    } catch (error) {
      console.error("Failed to get BTC price:", error.message);
      // Fallback to a default rate if API fails
      usdBalance = btcBalance * 100000; // Approximate rate
    }

    let { balance: ethBalance } = await EthWalletService.getBalance(
      wallet.ethAddress
    );
    let { balance: bscBalance } = await BscWalletService.getBalance(
      wallet.bscAddress
    );

    // Get platform fee percentage from environment or service
    const platformFeePercentage =
      parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.005;

    // Return the response in the original format
    res.status(200).json({
      success: true,
      message: "Wallet information retrieved successfully",
      data: {
        _id: wallet.id,
        btcAddress: wallet.btcAddress,
        ethAddress: wallet.ethAddress,
        bscAddress: wallet.bscAddress,
        label: wallet.label,
        createdAt: wallet.createdAt,
        lastUsed: wallet.lastUsed,
        network: wallet.network,
        btcBalance: btcBalance,
        ethBalance: ethBalance,
        bscBalance: bscBalance,
        usdBalance: usdBalance,
        platformFeePercentage: platformFeePercentage,
      },
    });
  } catch (error) {
    throw new AppError(
      `Failed to get wallet information: ${error.message}`,
      500
    );
  }
});

/**
 * Send transaction (multi-chain support)
 */
exports.sendTransaction = catchAsync(async (req, res) => {
  SimpleValidator(req.body, {
    currency: "required|string|in:BTC,ETH,BNB",
    toAddress: "required|string",
    amount: "required|numeric",
    priority: "required|in:low,medium,high,custom",
  });

  let { currency, toAddress, amount, priority, description } = req.body;
  const userId = req.user._id;

  // Verify wallet belongs to user
  const wallet = await Wallet.findOne({
    userId,
    status: "active",
  });
  if (!wallet) {
    throw new AppError("Wallet not found or access denied", 404);
  }

  // Validate recipient address for the specific currency
  if (!multiChainWalletService.validateAddress(toAddress, currency)) {
    throw new AppError(`Invalid ${currency} recipient address`, 400);
  }

  // Convert amount based on currency
  let processedAmount = amount;
  if (currency === "BTC" && typeof amount === "number" && amount < 1) {
    // Convert BTC to satoshis if amount is less than 1 BTC
    processedAmount = Math.floor(amount * 100000000);
  }

  // Additional security: Log transaction attempt
  console.log(
    `Transaction attempt: User ${userId}, Currency: ${currency}, Amount: ${processedAmount}, To: ${toAddress}`
  );

  const result = await multiChainWalletService.sendTransaction(
    wallet._id,
    toAddress,
    processedAmount,
    currency,
    process.env.WALLET_ENCRYPTION_KEY,
    priority || "medium",
    description
  );

  // Format response based on currency
  let formattedAmount, formattedFees;
  if (currency === "BTC") {
    formattedAmount = {
      satoshis: result.amount,
      btc: result.amount / 100000000,
    };
    formattedFees = {
      network: {
        satoshis: result.fee,
        btc: result.fee / 100000000,
      },
      platform: {
        satoshis: result.platformFee || 0,
        btc: (result.platformFee || 0) / 100000000,
      },
    };
  } else {
    formattedAmount = {
      [currency.toLowerCase()]: result.amount,
    };
    formattedFees = {
      network: {
        [currency.toLowerCase()]: result.fee,
      },
      platform: {
        [currency.toLowerCase()]: result.platformFee || 0,
      },
    };
  }

  res.status(200).json({
    success: true,
    message: result.success
      ? `${currency} transaction sent successfully`
      : `${currency} transaction failed`,
    data: {
      transactionId: result.transactionId,
      txHash: result.txHash,
      currency: currency,
      amount: formattedAmount,
      fees: formattedFees,
      status: result.status,
    },
  });
});

/**
 * Get transaction history (multi-chain support)
 */
exports.getTransactionHistory = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, currency = "all" } = req.query;

  // Build query filter
  const filter = { userId };
  if (currency !== "all") {
    filter.currency = currency.toUpperCase();
  }

  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get transactions with pagination
  const transactions = await Transaction.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .select({
      rawTransaction: 0, // Exclude raw transaction data for performance
      metadata: 0,
    });

  const totalTransactions = await Transaction.countDocuments(filter);
  const totalPages = Math.ceil(totalTransactions / parseInt(limit));

  res.status(200).json({
    success: true,
    data: {
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalTransactions,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
      },
      filters: {
        currency: currency,
        supportedCurrencies: multiChainWalletService.getSupportedCurrencies(),
      },
    },
  });
});

/**
 * Get transaction details
 */
exports.getTransactionDetails = catchAsync(async (req, res) => {
  const { transactionId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(transactionId)) {
    throw new AppError("Invalid transaction ID", 400);
  }

  const transaction = await Transaction.findOne({
    _id: transactionId,
    userId,
  });

  if (!transaction) {
    throw new AppError("Transaction not found", 404);
  }

  // Get live transaction details from blockchain if available
  let blockchainDetails = null;
  if (transaction.txHash && transaction.currency) {
    try {
      blockchainDetails = await multiChainWalletService.getTransactionDetails(
        transaction.txHash,
        transaction.currency
      );
    } catch (error) {
      console.error("Failed to get blockchain details:", error.message);
    }
  }

  res.status(200).json({
    success: true,
    data: {
      transaction,
      blockchainDetails,
    },
  });
});

/**
 * Estimate transaction fee (multi-chain support)
 */
exports.estimateTransactionFee = catchAsync(async (req, res) => {
  const { currency = "BTC", amount, priority = "medium" } = req.query;

  try {
    const service = multiChainWalletService.getService(currency);
    let fee;

    if (currency === "BTC") {
      // For Bitcoin, estimate based on UTXOs (simplified estimation)
      fee = service.calculateTransactionFee(2, 2, priority); // Estimate with 2 inputs, 2 outputs
    } else if (currency === "ETH") {
      fee = await service.calculateTransactionFee();
    } else if (currency === "BNB") {
      fee = await service.calculateTransactionFee();
    }

    res.status(200).json({
      success: true,
      data: {
        currency,
        estimatedFee: fee,
        priority,
        note: "This is an estimated fee. Actual fee may vary based on network conditions.",
      },
    });
  } catch (error) {
    throw new AppError(`Failed to estimate fee: ${error.message}`, 500);
  }
});

/**
 * Get current Bitcoin price (legacy function)
 */
exports.getBitcoinPrice = catchAsync(async (req, res) => {
  const { currency = "USD" } = req.query;

  try {
    // Use external API for price data
    const response = await require("axios").get(
      `https://api.coinbase.com/v2/exchange-rates?currency=BTC`
    );
    const price = parseFloat(response.data.data.rates[currency]);

    res.status(200).json({
      success: true,
      data: {
        bitcoin: {
          price,
          currency,
          timestamp: new Date(),
        },
      },
    });
  } catch (error) {
    throw new AppError(`Failed to get Bitcoin price: ${error.message}`, 500);
  }
});

/**
 * Validate address (multi-chain support)
 */
exports.validateAddress = catchAsync(async (req, res) => {
  const { address, currency = "auto" } = req.query;

  if (!address) {
    throw new AppError("Address is required", 400);
  }

  const isValid = multiChainWalletService.validateAddress(address, currency);

  // If auto-detect, find which currency it belongs to
  let detectedCurrency = null;
  if (currency === "auto" && isValid) {
    const currencies = multiChainWalletService.getSupportedCurrencies();
    for (const curr of currencies) {
      if (multiChainWalletService.validateAddress(address, curr)) {
        detectedCurrency = curr;
        break;
      }
    }
  }

  res.status(200).json({
    success: true,
    data: {
      address,
      isValid,
      currency: currency === "auto" ? detectedCurrency : currency,
      supportedCurrencies: multiChainWalletService.getSupportedCurrencies(),
    },
  });
});

/**
 * Get wallet statistics
 */
exports.getWalletStatistics = catchAsync(async (req, res) => {
  const userId = req.user._id;

  try {
    // Get transaction statistics
    const totalTransactions = await Transaction.countDocuments({ userId });
    const currencies = multiChainWalletService.getSupportedCurrencies();

    const currencyStats = {};
    for (const currency of currencies) {
      const stats = await Transaction.aggregate([
        { $match: { userId: mongoose.Types.ObjectId(userId), currency } },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            totalAmount: { $sum: "$amount" },
            totalFees: { $sum: "$fee" },
          },
        },
      ]);

      currencyStats[currency.toLowerCase()] = {
        transactions: stats,
        totalCount: stats.reduce((sum, stat) => sum + stat.count, 0),
      };
    }

    // Get recent transaction activity
    const recentTransactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("currency type amount status createdAt");

    res.status(200).json({
      success: true,
      data: {
        totalTransactions,
        currencyStats,
        recentTransactions,
        supportedCurrencies: currencies,
      },
    });
  } catch (error) {
    throw new AppError(
      `Failed to get wallet statistics: ${error.message}`,
      500
    );
  }
});

/**
 * Test QuickNode connection
 */
exports.testConnection = async (req, res, next) => {
  try {
    const result = await multiChainWalletService.testConnection();

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
    } = require("../cronJob/bitcoinTransactionListener");
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
