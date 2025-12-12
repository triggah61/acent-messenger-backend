const catchAsync = require("../../exception/catchAsync");
const AppError = require("../../exception/AppError");
const CreditPackage = require("../../model/CreditPackage");
const TopUpHistory = require("../../model/TopUpHistory");
const User = require("../../model/User");
const BalanceService = require("../../services/BalanceService");
const googlePlayBillingService = require("../../services/GooglePlayBillingService");
const SimpleValidator = require("../../validator/simpleValidator");

/**
 * Get all active credit packages for top-up
 * 
 * @route GET /api/user/topup/packages
 * @access Private
 */
exports.getTopUpPackages = catchAsync(async (req, res) => {
  const useSandbox = process.env.GOOGLE_PLAY_USE_SANDBOX === "true";
  
  const packages = await CreditPackage.find({
    status: "active",
  })
    .sort({ sortOrder: 1, usdPrice: 1 })
    .select("name description usdPrice credits isPopular googlePlayProductId googlePlaySandboxProductId");

  // Map packages to include the correct product ID based on environment
  const packagesWithProductId = packages.map((pkg) => {
    const packageObj = pkg.toObject();
    // Use sandbox product ID if in sandbox mode, otherwise use production
    packageObj.productId = useSandbox && pkg.googlePlaySandboxProductId
      ? pkg.googlePlaySandboxProductId
      : pkg.googlePlayProductId;
    // Remove internal fields
    delete packageObj.googlePlayProductId;
    delete packageObj.googlePlaySandboxProductId;
    return packageObj;
  });

  res.json({
    status: "success",
    message: "Credit packages fetched successfully",
    data: packagesWithProductId,
  });
});

/**
 * Verify and process Google Play one-time purchase for top-up
 * 
 * @route POST /api/user/topup/verify-google-play
 * @access Private
 */
exports.verifyGooglePlayTopUp = catchAsync(async (req, res) => {
  const { user } = req;

  console.log(req.body);

  // Validate input - packageId is now required, usdAmount is optional for backward compatibility
  await SimpleValidator(req.body, {
    purchaseToken: "required|string",
    productId: "required|string",
    packageId: "required|string",
  });

  const { purchaseToken, productId, packageId, usdAmount } = req.body;
  
  // Find the credit package
  const creditPackage = await CreditPackage.findOne({
      _id: packageId,
      status: "active",
    });
  
  if (!creditPackage) {
    throw new AppError("Credit package not found", 404);
  }

  // Verify product ID matches the package
  const useSandbox = process.env.GOOGLE_PLAY_USE_SANDBOX === "true";
  const expectedProductId = useSandbox && creditPackage.googlePlaySandboxProductId
    ? creditPackage.googlePlaySandboxProductId
    : creditPackage.googlePlayProductId;

  if (productId !== expectedProductId) {
    throw new AppError("Product ID does not match the selected package", 400);
  }

  // Use credits from package
  const creditsToAdd = creditPackage.credits;
  const usdPrice = creditPackage.usdPrice;

  // Check if this purchase has already been processed (idempotency)
  const existingTopUp = await TopUpHistory.findOne({
    user: user._id,
    googlePlayPurchaseToken: purchaseToken,
    status: "executed",
  });

  if (existingTopUp) {
    // Purchase already processed, return success with existing record
    const balanceSummary = await BalanceService.getBalanceSummary(user._id);
    return res.status(200).json({
      status: "success",
      message: "Purchase already processed",
      data: {
        topUpHistory: existingTopUp,
        balance: balanceSummary,
        alreadyProcessed: true,
      },
    });
  }

  // Verify purchase with Google Play
  let purchaseVerification;
  try {
    purchaseVerification = await googlePlayBillingService.verifyOneTimePurchase(
      purchaseToken,
      productId
    );
  } catch (error) {
    console.error("TopUpController: Google Play verification error:", error);
    throw new AppError(
      `Purchase verification failed: ${error.message}`,
      error.statusCode || 500
    );
  }

  // Check if purchase is valid and purchased
  if (!purchaseVerification.valid || !purchaseVerification.purchased) {
    throw new AppError("Invalid or cancelled purchase", 400);
  }

  // Check if purchase is already acknowledged
  if (purchaseVerification.acknowledgementState === 1) {
    // Already acknowledged, but not in our database - might be a duplicate
    // Check by order ID
    if (purchaseVerification.orderId) {
      const existingByOrderId = await TopUpHistory.findOne({
        googlePlayOrderId: purchaseVerification.orderId,
        status: "executed",
      });

      if (existingByOrderId) {
        const balanceSummary = await BalanceService.getBalanceSummary(
          user._id
        );
        return res.status(200).json({
          status: "success",
          message: "Purchase already processed",
          data: {
            topUpHistory: existingByOrderId,
            balance: balanceSummary,
            alreadyProcessed: true,
          },
        });
      }
    }
  }

  // Get current user
  const currentUser = await User.findById(user._id);
  if (!currentUser) {
    throw new AppError("User not found", 404);
  }

  // Create top-up history record with package reference
  const topUpHistory = await TopUpHistory.create({
    user: user._id,
    package: creditPackage._id, // Reference to the credit package
    amount: creditsToAdd,
    usdPrice: usdPrice,
    status: "executed",
    googlePlayPurchaseToken: purchaseToken,
    googlePlayOrderId: purchaseVerification.orderId || null,
    googlePlayTransactionId: purchaseVerification.orderId || null,
    googlePlayProductId: productId,
    googlePlayAcknowledged: purchaseVerification.acknowledgementState === 1,
  });

  // Update user's top-up balance
  const currentTopUpBalance = Number(currentUser.topUpCreditBalance ?? 0);
  const newTopUpBalance = currentTopUpBalance + creditsToAdd;

  await User.findByIdAndUpdate(user._id, {
    topUpCreditBalance: newTopUpBalance,
  });

  // Create credit transaction record
  await BalanceService.createTransaction({
    userId: user._id,
    amount: creditsToAdd,
    type: "credit",
    source: "topup",
    topUpHistory: topUpHistory._id,
    remarks: `Top-up: ${creditPackage.name} - ${usdPrice.toFixed(2)} USD`,
  });

  // Acknowledge purchase with Google Play (if not already acknowledged)
  if (purchaseVerification.acknowledgementState === 0) {
    try {
      await googlePlayBillingService.acknowledgeOneTimePurchase(
        purchaseToken,
        productId
      );
      // Update top-up history
      await TopUpHistory.findByIdAndUpdate(topUpHistory._id, {
        googlePlayAcknowledged: true,
      });
    } catch (ackError) {
      console.error(
        "TopUpController: Failed to acknowledge purchase:",
        ackError
      );
      // Don't fail the request if acknowledgment fails - purchase is already processed
    }
  }

  // Get updated balance summary
  const balanceSummary = await BalanceService.getBalanceSummary(user._id);

  res.status(201).json({
    status: "success",
    message: "Top-up credit added successfully",
    data: {
      topUpHistory,
      balance: balanceSummary,
      purchase: {
        orderId: purchaseVerification.orderId,
        purchaseTime: purchaseVerification.purchaseTimeMillis,
      },
    },
  });
});

/**
 * Get user's top-up history
 * 
 * @route GET /api/user/topup/history
 * @access Private
 */
exports.getTopUpHistory = catchAsync(async (req, res) => {
  const { user } = req;
  const { page = 1, limit = 20 } = req.query;

  const topUpHistory = await TopUpHistory.aggregate([
    {
      $match: {
        user: user._id,
      },
    },
    {
      $lookup: {
        from: "creditpackages",
        localField: "package",
        foreignField: "_id",
        as: "package",
      },
    },
    {
      $unwind: {
        path: "$package",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: { createdAt: -1 },
    },
    {
      $skip: (parseInt(page) - 1) * parseInt(limit),
    },
    {
      $limit: parseInt(limit),
    },
  ]);

  const total = await TopUpHistory.countDocuments({ user: user._id });

  res.json({
    status: "success",
    message: "Top-up history fetched successfully",
    data: {
      topUpHistory,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

