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
const { toBtc } = require("../services/BtcWalletService");
const BtcWalletService = require("../services/BtcWalletService");
const { ethers } = require("ethers");
const currencyConverter = require("../services/CurrencyConverter");

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
    let exchangeData = await currencyConverter.getExchangeData();
    try {
      let btcToUsdRate = exchangeData.BTC.USD;
      let ethToUsdRate = exchangeData.ETH.USD;
      let bscToUsdRate = exchangeData.BNB.USD;
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

    usdBalance += await currencyConverter.convertToUsd(btcBalance, "BTC");
    usdBalance += await currencyConverter.convertToUsd(ethBalance, "ETH");
    usdBalance += await currencyConverter.convertToUsd(bscBalance, "BNB");

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
        exchangeData: exchangeData,
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

  console.log("req.body", req.body);

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
exports.estimateTransactionFee = catchAsync(async (req, res, next) => {
  try {
    const { amount, currency } = req.body;
    const userId = req.user._id;

    console.log("amount", amount, "currency", currency);

    // Validate currency
    if (!["BTC", "ETH", "BNB"].includes(currency)) {
      return next(
        new AppError("Unsupported currency. Use BTC, ETH, or BNB", 400)
      );
    }

    // Verify wallet belongs to user
    const wallet = await Wallet.findOne({
      userId,
    });
    if (!wallet) {
      return next(new AppError("Wallet not found or access denied", 404));
    }

    let fees, dustHandling, estimatedConfirmationTime;

    if (currency === "BTC") {
      // Bitcoin fee estimation

      // Get UTXOs to estimate input count
      const utxos = await BtcWalletService.getUTXOs(wallet.btcAddress);
      const inputCount = Math.min(utxos.length, 10); // Limit to 10 inputs for estimation
      console.log("inputCount", inputCount);

      // Calculate fees
      const networkFee = {
        low: BtcWalletService.calculateTransactionFee(inputCount, 2, "low"),
        medium: BtcWalletService.calculateTransactionFee(
          inputCount,
          2,
          "medium"
        ),
        high: BtcWalletService.calculateTransactionFee(inputCount, 2, "high"),
      };

      const platformFeeAmount = BtcWalletService.calculatePlatformFee(amount);
      const dustThreshold = 546; // Bitcoin dust threshold

      fees = {
        low: {
          network: toBtc(networkFee.low),
          platform: toBtc(platformFeeAmount),
          total: toBtc(networkFee.low + platformFeeAmount),
          networkSatoshis: networkFee.low,
          platformSatoshis: platformFeeAmount,
          totalSatoshis: networkFee.low + platformFeeAmount,
        },
        medium: {
          network: toBtc(networkFee.medium),
          platform: toBtc(platformFeeAmount),
          total: toBtc(networkFee.medium + platformFeeAmount),
          networkSatoshis: networkFee.medium,
          platformSatoshis: platformFeeAmount,
          totalSatoshis: networkFee.medium + platformFeeAmount,
        },
        high: {
          network: toBtc(networkFee.high),
          platform: toBtc(platformFeeAmount),
          total: toBtc(networkFee.high + platformFeeAmount),
          networkSatoshis: networkFee.high,
          platformSatoshis: platformFeeAmount,
          totalSatoshis: networkFee.high + platformFeeAmount,
        },
      };

      dustHandling = {
        dustThreshold: dustThreshold,
        platformFeeIsDust: platformFeeAmount < dustThreshold,
        note:
          platformFeeAmount < dustThreshold
            ? "Platform fee is below dust threshold - will be added to network fee for miners, but you still pay the full platform fee"
            : "Platform fee will be sent to admin wallet",
      };

      estimatedConfirmationTime = {
        low: "60-120 minutes",
        medium: "10-30 minutes",
        high: "5-15 minutes",
      };
    } else if (currency === "ETH") {
      // Ethereum fee estimation
      const platformFeeAmount = EthWalletService.calculatePlatformFee(amount);

      // Get base network fee
      let baseFee;
      try {
        baseFee = await EthWalletService.calculateTransactionFee();

        // If the fee is unreasonably low (less than $0.50 worth), use realistic fallback
        if (baseFee < 0.0001) {
          console.log("ETH fee too low, using fallback");
          // Use realistic ETH gas prices: 20-50 Gwei for current mainnet
          const { ethers } = require("ethers");
          const gasLimit = 21000;
          const realisticGasPrice = ethers.parseUnits("30", "gwei"); // 30 Gwei baseline
          baseFee = parseFloat(
            ethers.formatEther(BigInt(gasLimit) * realisticGasPrice)
          );
        }
      } catch (error) {
        console.log(
          "ETH fee calculation failed, using fallback:",
          error.message
        );
        // Fallback to realistic fees
        const { ethers } = require("ethers");
        const gasLimit = 21000;
        const fallbackGasPrice = ethers.parseUnits("30", "gwei");
        baseFee = parseFloat(
          ethers.formatEther(BigInt(gasLimit) * fallbackGasPrice)
        );
      }

      // Calculate priority-based fees
      const networkFee = {
        low: baseFee * 0.7, // 70% for low priority
        medium: baseFee, // Base fee for medium
        high: baseFee * 1.5, // 150% for high priority
      };

      fees = {
        low: {
          network: networkFee.low,
          platform: platformFeeAmount,
          total: networkFee.low + platformFeeAmount,
        },
        medium: {
          network: networkFee.medium,
          platform: platformFeeAmount,
          total: networkFee.medium + platformFeeAmount,
        },
        high: {
          network: networkFee.high,
          platform: platformFeeAmount,
          total: networkFee.high + platformFeeAmount,
        },
      };

      dustHandling = {
        minimumTransactionAmount: 0.001, // Minimum ETH transaction
        note: "Platform fee will be sent in a separate transaction to admin wallet",
      };

      estimatedConfirmationTime = {
        low: "5-10 minutes",
        medium: "2-5 minutes",
        high: "1-2 minutes",
      };
    } else if (currency === "BNB") {
      // BSC (BNB) fee estimation
      const platformFeeAmount = BscWalletService.calculatePlatformFee(amount);

      // Get base network fee
      let baseFee;
      try {
        baseFee = await BscWalletService.calculateTransactionFee();

        // If the fee is unreasonably low, use realistic fallback
        // Current BSC fees should be around $0.10-$0.50 (0.0003-0.0015 BNB at ~$300/BNB)
        if (baseFee < 0.0003) {
          console.log("BNB fee too low, using realistic fallback");
          // Use realistic BSC gas prices: 10-20 Gwei for current BSC mainnet
          const { ethers } = require("ethers");
          const gasLimit = 21000;
          const realisticGasPrice = ethers.parseUnits("15", "gwei"); // 15 Gwei baseline for BSC
          baseFee = parseFloat(
            ethers.formatEther(BigInt(gasLimit) * realisticGasPrice)
          );
        }
      } catch (error) {
        console.log(
          "BSC fee calculation failed, using fallback:",
          error.message
        );
        // Fallback to realistic BSC fees
        const { ethers } = require("ethers");
        const gasLimit = 21000;
        const fallbackGasPrice = ethers.parseUnits("15", "gwei"); // Higher baseline for realistic fees
        baseFee = parseFloat(
          ethers.formatEther(BigInt(gasLimit) * fallbackGasPrice)
        );
      }

      // Calculate priority-based fees
      const networkFee = {
        low: baseFee * 0.7, // 70% for low priority
        medium: baseFee, // Base fee for medium
        high: baseFee * 1.4, // 140% for high priority
      };

      fees = {
        low: {
          network: networkFee.low,
          platform: platformFeeAmount,
          total: networkFee.low + platformFeeAmount,
        },
        medium: {
          network: networkFee.medium,
          platform: platformFeeAmount,
          total: networkFee.medium + platformFeeAmount,
        },
        high: {
          network: networkFee.high,
          platform: platformFeeAmount,
          total: networkFee.high + platformFeeAmount,
        },
      };

      dustHandling = {
        minimumTransactionAmount: 0.01, // Minimum BNB transaction
        note: "Platform fee will be sent in a separate transaction to admin wallet",
      };

      estimatedConfirmationTime = {
        low: "10-20 seconds",
        medium: "5-10 seconds",
        high: "3-5 seconds",
      };
    }

    res.status(200).json({
      success: true,
      message: "Transaction fees estimated successfully",
      data: {
        currency: currency,
        amount: amount,
        fees,
        dustHandling,
        estimatedConfirmationTime,
        recommendations: {
          low: "Slower confirmation, lowest cost",
          medium: "Balanced speed and cost (recommended)",
          high: "Fastest confirmation, highest cost",
        },
        note: "Actual fees may vary based on network conditions at the time of transaction.",
      },
    });
  } catch (error) {
    next(error);
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
