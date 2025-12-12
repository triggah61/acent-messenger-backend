/**
 * @fileoverview Credit Package Controller
 *
 * This module provides controller functions for managing credit packages.
 * It handles CRUD operations for credit packages, including creation, retrieval,
 * updating, and soft deletion of packages.
 *
 * @module CreditPackageController
 * @requires mongoose
 * @requires ../../../exception/AppError
 * @requires ../../../exception/catchAsync
 * @requires ../../../model/CreditPackage
 * @requires ../../../utils/dateQueryGenerator
 * @requires ../../../validator/simpleValidator
 * @requires ../../../services/GooglePlayBillingService
 */

const AppError = require("../../../exception/AppError");
const catchAsync = require("../../../exception/catchAsync");
const CreditPackage = require("../../../model/CreditPackage");
const dateQueryGenerator = require("../../../utils/dateQueryGenerator");
const SimpleValidator = require("../../../validator/simpleValidator");
const googlePlayBillingService = require("../../../services/GooglePlayBillingService");

/**
 * Creates a new credit package
 *
 * @function createCreditPackage
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body containing package details
 * @param {string} req.body.name - Name of the credit package
 * @param {string} [req.body.description] - Description of the package
 * @param {number} req.body.usdPrice - Price in USD
 * @param {number} req.body.credits - Number of credits
 * @param {string} [req.body.googlePlayProductId] - Google Play product ID (optional, auto-generated if not provided)
 * @param {string} [req.body.googlePlaySandboxProductId] - Google Play sandbox product ID
 * @param {number} [req.body.sortOrder] - Display order
 * @param {boolean} [req.body.isPopular] - Whether package is popular
 * @param {string} [req.body.status] - Package status
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the created package
 */
exports.createCreditPackage = catchAsync(async (req, res) => {
  // Validation
  await SimpleValidator(req.body, {
    name: "required|string",
    usdPrice: "required|numeric|min:0.01",
    credits: "required|numeric|min:1",
  });

  const {
    name,
    description,
    usdPrice,
    credits,
    googlePlayProductId,
    googlePlaySandboxProductId,
    sortOrder,
    isPopular,
    status = "active",
  } = req.body;

  // Check if package name already exists
  const existingPackage = await CreditPackage.findOne({
    name,
    status: { $ne: "deleted" },
  });
  if (existingPackage) {
    throw new AppError("Credit package with this name already exists", 422);
  }

  // Generate product ID if not provided
  let finalProductId = googlePlayProductId;
  if (!finalProductId) {
    // Generate from name: "10 USD Package" -> "com.qmessenger.app.topup.10usdpackage"
    const cleanName = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .substring(0, 30);
    const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.qmessenger.app";
    finalProductId = `${packageName}.topup.${cleanName}`;
  }

  // Create the credit package
  const packageData = {
    name,
    description: description || null,
    usdPrice: parseFloat(usdPrice),
    credits: parseInt(credits),
    googlePlayProductId: finalProductId,
    googlePlaySandboxProductId: googlePlaySandboxProductId || finalProductId,
    sortOrder: sortOrder ? parseInt(sortOrder) : 0,
    isPopular: isPopular === true || isPopular === "true",
    status: status,
    googlePlaySyncStatus: "pending",
  };

  const creditPackage = await CreditPackage.create(packageData);

  // Google Play sync is currently not available via API
  // Mark as "not_applicable" and provide manual creation instructions
  creditPackage.googlePlaySyncStatus = "not_applicable";
  creditPackage.googlePlaySyncError = "Manual creation required - API not available. See GOOGLE_PLAY_INAPP_PRODUCTS_MANUAL_GUIDE.md";
  await creditPackage.save();

  console.log(`✅ Package created in database successfully: ${name}`);
  console.log(`⚠️  Google Play API sync is not available - manual creation required`);
  console.log(`📋 Product ID to create: ${finalProductId}`);
  console.log(`💰 Price: $${usdPrice}`);
  console.log(`🎯 Credits: ${credits}`);
  console.log(`📖 See GOOGLE_PLAY_INAPP_PRODUCTS_MANUAL_GUIDE.md for step-by-step instructions`);

  // Prepare manual creation instructions for response
  const manualCreationInstructions = {
    productId: finalProductId,
    price: `$${usdPrice}`,
    name: name,
    description: description || `${name} - ${credits} credits for $${usdPrice}`,
    credits: credits,
    type: "Consumable",
    status: "Active",
    guide: "See GOOGLE_PLAY_INAPP_PRODUCTS_MANUAL_GUIDE.md for detailed steps",
    quickSteps: [
      "Go to Play Console → Your App → Monetize → Products → In-app products",
      "Click 'Create product'",
      `Enter Product ID: ${finalProductId}`,
      `Set price: $${usdPrice}`,
      `Set name: ${name}`,
      "Set type to 'Consumable'",
      "Activate the product",
    ],
  };

  res.status(201).json({
    status: "success",
    message: "Credit package created successfully. Manual Google Play product creation required.",
    data: creditPackage,
    manualCreation: manualCreationInstructions,
  });
});

/**
 * Retrieves all credit packages with optional filtering and pagination
 *
 * @function getAllCreditPackages
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.query - Query parameters
 * @param {string} [req.query.search] - Search term for package name
 * @param {string} [req.query.fromDate] - Start date for filtering
 * @param {string} [req.query.toDate] - End date for filtering
 * @param {number} [req.query.page=1] - Page number for pagination
 * @param {number} [req.query.limit=10] - Number of items per page
 * @param {string} [req.query.status] - Package status filter
 * @param {string} [req.query.sortBy="sortOrder"] - Field to sort by
 * @param {string} [req.query.sortOrder="asc"] - Sort order (asc or desc)
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with paginated package data
 */
exports.getAllCreditPackages = catchAsync(async (req, res) => {
  const {
    search,
    fromDate,
    toDate,
    page = 1,
    limit = 10,
    status,
    sortBy = "sortOrder",
    sortOrder = "asc",
  } = req.query;

  // Generate date query
  let dateQuery = dateQueryGenerator(fromDate, toDate);

  // Create the main query object
  let query = {
    ...dateQuery,
    ...(status ? { status } : { status: { $ne: "deleted" } }),
    ...(search && {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ],
    }),
  };

  // Aggregation pipeline
  const aggregatedQuery = CreditPackage.aggregate([
    {
      $match: query,
    },
    {
      $sort: {
        [sortBy]: sortOrder === "desc" ? -1 : 1,
      },
    },
  ]);

  // Pagination options
  const options = {
    page: parseInt(page),
    limit: parseInt(limit) === -1 ? 9999999 : parseInt(limit),
  };

  // Fetch paginated data
  const data = await CreditPackage.aggregatePaginate(aggregatedQuery, options);

  res.json({
    message: "Fetched successfully",
    data,
  });
});

/**
 * Retrieves a specific credit package by ID
 *
 * @function getCreditPackage
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - Package ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the package data
 * @throws {AppError} If the package is not found
 */
exports.getCreditPackage = catchAsync(async (req, res) => {
  const package = await CreditPackage.findOne({
    _id: req.params.id,
    status: { $ne: "deleted" },
  });

  if (!package) {
    throw new AppError("Credit package not found", 404);
  }

  res.json({
    message: "Credit package fetched successfully",
    data: package,
  });
});

/**
 * Updates a specific credit package by ID
 *
 * @function updateCreditPackage
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - Package ID
 * @param {Object} req.body - Request body containing updated package details
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the updated package
 * @throws {AppError} If the package is not found or validation fails
 */
exports.updateCreditPackage = catchAsync(async (req, res) => {
  const packageId = req.params.id;

  // Find the package
  const creditPackage = await CreditPackage.findOne({
    _id: packageId,
    status: { $ne: "deleted" },
  });
  if (!creditPackage) {
    throw new AppError("Credit package not found", 404);
  }

  const {
    name,
    description,
    usdPrice,
    credits,
    googlePlayProductId,
    googlePlaySandboxProductId,
    sortOrder,
    isPopular,
    status,
  } = req.body;

  // Check if name is being updated and if it conflicts with another package
  if (name && name !== creditPackage.name) {
    const existingPackage = await CreditPackage.findOne({
      name,
      _id: { $ne: packageId },
      status: { $ne: "deleted" },
    });
    if (existingPackage) {
      throw new AppError("Credit package with this name already exists", 422);
    }
    creditPackage.name = name;
  }

  // Update fields if provided
  if (description !== undefined) {
    creditPackage.description = description || null;
  }
  if (usdPrice !== undefined) {
    creditPackage.usdPrice = parseFloat(usdPrice);
  }
  if (credits !== undefined) {
    creditPackage.credits = parseInt(credits);
  }
  if (googlePlayProductId !== undefined) {
    creditPackage.googlePlayProductId = googlePlayProductId || null;
  }
  if (googlePlaySandboxProductId !== undefined) {
    creditPackage.googlePlaySandboxProductId = googlePlaySandboxProductId || null;
  }
  if (sortOrder !== undefined) {
    creditPackage.sortOrder = parseInt(sortOrder);
  }
  if (isPopular !== undefined) {
    creditPackage.isPopular = isPopular === true || isPopular === "true";
  }
  if (status !== undefined) {
    creditPackage.status = status;
  }

  await creditPackage.save();

  res.json({
    message: "Credit package updated successfully",
    data: creditPackage,
  });
});

/**
 * Soft deletes a specific credit package by ID
 *
 * @function deleteCreditPackage
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - Package ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response confirming the deletion
 * @throws {AppError} If the package is not found
 */
exports.deleteCreditPackage = catchAsync(async (req, res) => {
  const packageId = req.params.id;

  // Find the package
  const package = await CreditPackage.findOne({
    _id: packageId,
    status: { $ne: "deleted" },
  });
  if (!package) {
    throw new AppError("Credit package not found", 404);
  }

  // Soft delete the package by setting status to "deleted"
  package.status = "deleted";
  await package.save();

  res.json({
    message: "Credit package deleted successfully",
  });
});

/**
 * Sync a credit package with Google Play Console
 * Creates or updates the in-app product in Google Play
 *
 * @function syncPackageWithGooglePlay
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - Package ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with sync result
 * @throws {AppError} If the package is not found
 */
exports.syncPackageWithGooglePlay = catchAsync(async (req, res) => {
  const packageId = req.params.id;

  const creditPackage = await CreditPackage.findOne({
    _id: packageId,
    status: { $ne: "deleted" },
  });

  if (!creditPackage) {
    throw new AppError("Credit package not found", 404);
  }

  // Check if Google Play service is initialized
  const serviceStatus = googlePlayBillingService.getStatus();
  if (!serviceStatus.initialized) {
    throw new AppError(
      "Google Play Billing service is not configured. Please set up service account credentials.",
      503
    );
  }

  try {
    const productId = creditPackage.googlePlayProductId;
    if (!productId) {
      throw new AppError("Package does not have a Google Play product ID", 400);
    }

    const syncResult = await googlePlayBillingService.createInAppProduct({
      productId: productId,
      name: creditPackage.name,
      description: creditPackage.description || `${creditPackage.name} - ${creditPackage.credits} credits for $${creditPackage.usdPrice}`,
      priceAmountMicros: Math.round(creditPackage.usdPrice * 1000000),
      priceCurrencyCode: "USD",
    });

    if (syncResult.success) {
      creditPackage.googlePlaySyncStatus = "synced";
      creditPackage.googlePlaySyncError = null;
      creditPackage.googlePlayLastSyncAt = new Date();
      await creditPackage.save();

      res.json({
        message: "Credit package synced with Google Play successfully",
        data: creditPackage,
        syncResult: syncResult,
      });
    } else {
      creditPackage.googlePlaySyncStatus = "failed";
      creditPackage.googlePlaySyncError = syncResult.errors?.join(", ") || "Unknown error";
      await creditPackage.save();

      throw new AppError(
        `Google Play sync failed: ${creditPackage.googlePlaySyncError}`,
        500
      );
    }
  } catch (error) {
    creditPackage.googlePlaySyncStatus = "failed";
    creditPackage.googlePlaySyncError = error.message;
    await creditPackage.save();

    throw error;
  }
});

/**
 * Sync all credit packages with Google Play Console
 *
 * @function syncAllPackagesWithGooglePlay
 * @async
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with sync results
 */
exports.syncAllPackagesWithGooglePlay = catchAsync(async (req, res) => {
  // Check if Google Play service is initialized
  const serviceStatus = googlePlayBillingService.getStatus();
  if (!serviceStatus.initialized) {
    throw new AppError(
      "Google Play Billing service is not configured. Please set up service account credentials.",
      503
    );
  }

  const packages = await CreditPackage.find({
    status: "active",
  });

  const results = {
    total: packages.length,
    success: 0,
    failed: 0,
    details: [],
  };

  for (const creditPackage of packages) {
    try {
      if (!creditPackage.googlePlayProductId) {
        results.failed++;
        results.details.push({
          packageId: creditPackage._id,
          packageName: creditPackage.name,
          status: "failed",
          error: "No Google Play product ID",
        });
        continue;
      }

      const syncResult = await googlePlayBillingService.createInAppProduct({
        productId: creditPackage.googlePlayProductId,
        name: creditPackage.name,
        description: creditPackage.description || `${creditPackage.name} - ${creditPackage.credits} credits for $${creditPackage.usdPrice}`,
        priceAmountMicros: Math.round(creditPackage.usdPrice * 1000000),
        priceCurrencyCode: "USD",
      });

      if (syncResult.success) {
        creditPackage.googlePlaySyncStatus = "synced";
        creditPackage.googlePlaySyncError = null;
        creditPackage.googlePlayLastSyncAt = new Date();
        await creditPackage.save();

        results.success++;
        results.details.push({
          packageId: creditPackage._id,
          packageName: creditPackage.name,
          status: "success",
          productId: creditPackage.googlePlayProductId,
        });
      } else {
        creditPackage.googlePlaySyncStatus = "failed";
        creditPackage.googlePlaySyncError = syncResult.errors?.join(", ") || "Unknown error";
        await creditPackage.save();

        results.failed++;
        results.details.push({
          packageId: creditPackage._id,
          packageName: creditPackage.name,
          status: "failed",
          errors: syncResult.errors,
        });
      }
    } catch (error) {
      creditPackage.googlePlaySyncStatus = "failed";
      creditPackage.googlePlaySyncError = error.message;
      await creditPackage.save();

      results.failed++;
      results.details.push({
        packageId: creditPackage._id,
        packageName: creditPackage.name,
        status: "failed",
        error: error.message,
      });
    }
  }

  res.json({
    message: `Synced ${results.success} of ${results.total} packages with Google Play`,
    data: results,
  });
});

/**
 * Get Google Play Billing service status
 *
 * @function getGooglePlayStatus
 * @async
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with service status
 */
exports.getGooglePlayStatus = catchAsync(async (req, res) => {
  const status = googlePlayBillingService.getStatus();

  res.json({
    message: "Google Play Billing status retrieved",
    data: status,
  });
});

