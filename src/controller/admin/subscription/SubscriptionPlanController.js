/**
 * @fileoverview Subscription Plan Controller
 *
 * This module provides controller functions for managing subscription plans.
 * It handles CRUD operations for subscription plans, including creation, retrieval,
 * updating, and soft deletion of subscription plans.
 *
 * @module SubscriptionPlanController
 * @requires mongoose
 * @requires ../../../exception/AppError
 * @requires ../../../exception/catchAsync
 * @requires ../../../model/SubscriptionPlan
 * @requires ../../../utils/dateQueryGenerator
 * @requires ../../../validator/simpleValidator
 * @requires ../../../config/file
 */

const AppError = require("../../../exception/AppError");
const catchAsync = require("../../../exception/catchAsync");
const SubscriptionPlan = require("../../../model/SubscriptionPlan");
const dateQueryGenerator = require("../../../utils/dateQueryGenerator");
const SimpleValidator = require("../../../validator/simpleValidator");
const { upload, deleteFileByPath } = require("../../../config/file");
const googlePlayBillingService = require("../../../services/GooglePlayBillingService");

/**
 * Creates a new subscription plan
 *
 * This function validates the input, creates a new subscription plan in the database,
 * and handles icon upload.
 *
 * @function createSubscriptionPlan
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body containing plan details
 * @param {string} req.body.name - Name of the subscription plan
 * @param {string} [req.body.subtitle] - Subtitle of the plan
 * @param {string} [req.body.description] - Description of the plan
 * @param {number} req.body.monthlyPrice - Monthly price of the plan
 * @param {number} req.body.monthlyCredit - Monthly credits for the plan
 * @param {number} req.body.annualMonthlyPrice - Annual monthly price (per month when billed annually)
 * @param {number} req.body.annualMonthlyCredit - Annual monthly credits (per month when billed annually)
 * @param {string} [req.body.color] - Theme color for the plan (hex color code)
 * @param {string} [req.body.actionButtonText] - Text for the action button
 * @param {Object} [req.file] - Uploaded icon file
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the created plan
 */
exports.createSubscriptionPlan = catchAsync(async (req, res) => {
  const isCustom = req.body.isCustom === true || req.body.isCustom === "true";
  
  // Conditional validation based on isCustom
  const validationRules = {
    name: "required|string",
  };

  if (isCustom) {
    validationRules.contactFormLink = "required|string|url";
  } else {
    validationRules.monthlyPrice = "required|numeric|min:0";
    validationRules.monthlyCredit = "required|numeric|min:0";
    validationRules.annualMonthlyPrice = "required|numeric|min:0";
    validationRules.annualMonthlyCredit = "required|numeric|min:0";
  }

  await SimpleValidator(req.body, validationRules);

  // Parse benefits array from form data (benefits[0], benefits[1], etc.)
  const benefits = [];
  if (req.body.benefits) {
    if (Array.isArray(req.body.benefits)) {
      benefits.push(...req.body.benefits.filter(b => b && b.trim()));
    } else {
      // Handle form data format: benefits[0], benefits[1], etc.
      Object.keys(req.body).forEach(key => {
        if (key.startsWith('benefits[') && key.endsWith(']')) {
          const value = req.body[key];
          if (value && value.trim()) {
            benefits.push(value.trim());
          }
        }
      });
    }
  }

  const {
    name,
    subtitle,
    description,
    monthlyPrice,
    monthlyCredit,
    annualMonthlyPrice,
    annualMonthlyCredit,
    actionButtonText,
    unlimitedCredit,
    unlimitedCreditCap,
    sortOrder,
    isPopular,
    isCustom: isCustomPlan,
    contactFormLink,
    color,
    stripeMonthlyPriceId,
    stripeYearlyPriceId,
    paypalMonthlyPlanId,
    paypalYearlyPlanId,
    paddleMonthlyPlanId,
    paddleYearlyPlanId,
  } = req.body;

  // Check if plan name already exists
  const existingPlan = await SubscriptionPlan.findOne({
    name,
    status: { $ne: "deleted" },
  });
  if (existingPlan) {
    throw new AppError("Subscription plan with this name already exists", 422);
  }

  // Create the subscription plan
  const planData = {
    name,
    subtitle: subtitle || null,
    description: description || null,
    benefits: benefits.length > 0 ? benefits : [],
    actionButtonText: actionButtonText || "Subscribe Now",
    unlimitedCredit: unlimitedCredit || "no",
    unlimitedCreditCap: unlimitedCreditCap ? parseInt(unlimitedCreditCap) : 0,
    sortOrder: sortOrder ? parseInt(sortOrder) : 0,
    isPopular: isPopular === true || isPopular === "true",
    isCustom: isCustomPlan === true || isCustomPlan === "true",
    contactFormLink: contactFormLink || null,
    color: color || "#2196F3",
    stripeMonthlyPriceId: stripeMonthlyPriceId || null,
    stripeYearlyPriceId: stripeYearlyPriceId || null,
    paypalMonthlyPlanId: paypalMonthlyPlanId || null,
    paypalYearlyPlanId: paypalYearlyPlanId || null,
    paddleMonthlyPlanId: paddleMonthlyPlanId || null,
    paddleYearlyPlanId: paddleYearlyPlanId || null,
    status: "active",
  };

  // Only add pricing/credit fields if not custom
  if (!isCustom) {
    planData.monthlyPrice = parseFloat(monthlyPrice);
    planData.monthlyCredit = parseInt(monthlyCredit);
    planData.annualMonthlyPrice = parseFloat(annualMonthlyPrice);
    planData.annualMonthlyCredit = parseInt(annualMonthlyCredit);
  } else {
    planData.monthlyPrice = 0;
    planData.monthlyCredit = 0;
    planData.annualMonthlyPrice = 0;
    planData.annualMonthlyCredit = 0;
  }

  const plan = await SubscriptionPlan.create(planData);

  // Handle icon upload if provided
  if (req.file) {
    let uploadData = await upload(req.file, "subscription-plan-icons", plan._id);
    const { Key } = uploadData;
    plan.icon = Key;
    await plan.save();
  }

  // Sync with Google Play Console (non-blocking)
  let googlePlaySyncResult = null;
  let syncMessage = null;
  if (!isCustom && (parseFloat(monthlyPrice) > 0 || parseFloat(annualMonthlyPrice) > 0)) {
    try {
      googlePlaySyncResult = await googlePlayBillingService.syncSubscriptionPlan(plan);
      
      if (googlePlaySyncResult.success) {
        // Update plan with Google Play product IDs
        // Note: Google Play subscriptions use the same product ID for both sandbox and production
        // The environment is determined by the test account, not the product ID
        if (googlePlaySyncResult.monthlyProductId) {
          plan.googlePlayMonthlySubscriptionId = googlePlaySyncResult.monthlyProductId;
          plan.googlePlaySandboxMonthlySubscriptionId = googlePlaySyncResult.monthlyProductId; // Same ID for sandbox
        }
        if (googlePlaySyncResult.annualProductId) {
          plan.googlePlayAnnualSubscriptionId = googlePlaySyncResult.annualProductId;
          plan.googlePlaySandboxAnnualSubscriptionId = googlePlaySyncResult.annualProductId; // Same ID for sandbox
        }
        plan.googlePlaySyncStatus = 'synced';
        plan.googlePlayLastSyncAt = new Date();
        await plan.save();
        console.log(`✅ Google Play sync successful for plan: ${plan.name}`);
        
        // Extract message from sync result if available
        if (googlePlaySyncResult.message) {
          syncMessage = googlePlaySyncResult.message;
        }
      } else if (googlePlaySyncResult.skipped) {
        console.log(`ℹ️ Google Play sync skipped for plan: ${plan.name} - ${googlePlaySyncResult.reason}`);
      } else {
        plan.googlePlaySyncStatus = 'failed';
        plan.googlePlaySyncError = googlePlaySyncResult.errors?.join(', ') || 'Unknown error';
        await plan.save();
        console.warn(`⚠️ Google Play sync failed for plan: ${plan.name}`);
      }
    } catch (syncError) {
      console.error(`❌ Google Play sync error for plan ${plan.name}:`, syncError.message);
      plan.googlePlaySyncStatus = 'failed';
      plan.googlePlaySyncError = syncError.message;
      await plan.save();
    }
  }

  // Build response message
  let responseMessage = "Subscription plan created successfully";
  if (syncMessage) {
    responseMessage += `\n\n${syncMessage}`;
  }

  res.status(201).json({
    message: responseMessage,
    data: plan,
    googlePlaySync: googlePlaySyncResult,
  });
});

/**
 * Retrieves all subscription plans with optional filtering and pagination
 *
 * This function fetches plans based on search criteria, date range,
 * status, and pagination parameters.
 *
 * @function getAllSubscriptionPlans
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.query - Query parameters
 * @param {string} [req.query.search] - Search term for plan name
 * @param {string} [req.query.fromDate] - Start date for filtering
 * @param {string} [req.query.toDate] - End date for filtering
 * @param {number} [req.query.page=1] - Page number for pagination
 * @param {number} [req.query.limit=10] - Number of items per page
 * @param {string} [req.query.status] - Plan status filter
 * @param {string} [req.query.sortBy="sortOrder"] - Field to sort by
 * @param {string} [req.query.sortOrder="asc"] - Sort order (asc or desc)
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with paginated plan data
 */
exports.getAllSubscriptionPlans = catchAsync(async (req, res) => {
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

  // Generate date query using the provided function
  let dateQuery = dateQueryGenerator(fromDate, toDate);

  // Create the main query object
  let query = {
    ...dateQuery,
    ...(status ? { status } : { status: { $ne: "deleted" } }),
    ...(search && {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { subtitle: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ],
    }),
  };

  // Aggregation pipeline
  const aggregatedQuery = SubscriptionPlan.aggregate([
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
  const data = await SubscriptionPlan.aggregatePaginate(aggregatedQuery, options);

  res.json({
    message: "Fetched successfully",
    data,
  });
});

/**
 * Retrieves a specific subscription plan by ID
 *
 * This function fetches a single plan based on the provided ID.
 *
 * @function getSubscriptionPlan
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - Plan ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the plan data
 * @throws {AppError} If the plan is not found
 */
exports.getSubscriptionPlan = catchAsync(async (req, res) => {
  const plan = await SubscriptionPlan.findOne({
    _id: req.params.id,
    status: { $ne: "deleted" },
  });

  if (!plan) {
    throw new AppError("Subscription plan not found", 404);
  }

  res.json({
    message: "Subscription plan fetched successfully",
    data: plan,
  });
});

/**
 * Updates a specific subscription plan by ID
 *
 * This function validates the input and updates the plan details,
 * including the icon if a new one is provided.
 *
 * @function updateSubscriptionPlan
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - Plan ID
 * @param {Object} req.body - Request body containing updated plan details
 * @param {string} [req.body.name] - Updated name of the plan
 * @param {string} [req.body.subtitle] - Updated subtitle
 * @param {string} [req.body.description] - Updated description
 * @param {number} [req.body.monthlyPrice] - Updated monthly price
 * @param {number} [req.body.monthlyCredit] - Updated monthly credits
 * @param {number} [req.body.annualMonthlyPrice] - Updated annual monthly price
 * @param {number} [req.body.annualMonthlyCredit] - Updated annual monthly credits
 * @param {string} [req.body.color] - Updated theme color for the plan
 * @param {string} [req.body.actionButtonText] - Updated action button text
 * @param {Object} [req.file] - New icon file
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with the updated plan
 * @throws {AppError} If the plan is not found or validation fails
 */
exports.updateSubscriptionPlan = catchAsync(async (req, res) => {
  const planId = req.params.id;

  // Find the plan
  const plan = await SubscriptionPlan.findOne({
    _id: planId,
    status: { $ne: "deleted" },
  });
  if (!plan) {
    throw new AppError("Subscription plan not found", 404);
  }

  // Parse benefits array from form data (benefits[0], benefits[1], etc.)
  const benefits = [];
  if (req.body.benefits !== undefined) {
    if (Array.isArray(req.body.benefits)) {
      benefits.push(...req.body.benefits.filter(b => b && b.trim()));
    } else {
      // Handle form data format: benefits[0], benefits[1], etc.
      Object.keys(req.body).forEach(key => {
        if (key.startsWith('benefits[') && key.endsWith(']')) {
          const value = req.body[key];
          if (value && value.trim()) {
            benefits.push(value.trim());
          }
        }
      });
    }
  }

  const {
    name,
    subtitle,
    description,
    monthlyPrice,
    monthlyCredit,
    annualMonthlyPrice,
    annualMonthlyCredit,
    actionButtonText,
    unlimitedCredit,
    unlimitedCreditCap,
    sortOrder,
    isPopular,
    isCustom: isCustomPlan,
    contactFormLink,
    color,
    status,
    stripeMonthlyPriceId,
    stripeYearlyPriceId,
    paypalMonthlyPlanId,
    paypalYearlyPlanId,
    paddleMonthlyPlanId,
    paddleYearlyPlanId,
  } = req.body;

  // Validate custom plan requirements
  const isCustom = isCustomPlan === true || isCustomPlan === "true" || plan.isCustom;
  if (isCustom && !contactFormLink && contactFormLink !== null) {
    throw new AppError("Contact form link is required for custom plans", 400);
  }

  // Check if name is being updated and if it conflicts with another plan
  if (name && name !== plan.name) {
    const existingPlan = await SubscriptionPlan.findOne({
      name,
      _id: { $ne: planId },
      status: { $ne: "deleted" },
    });
    if (existingPlan) {
      throw new AppError("Subscription plan with this name already exists", 422);
    }
    plan.name = name;
  }

  // Update fields if provided
  if (subtitle !== undefined) {
    plan.subtitle = subtitle || null;
  }
  if (description !== undefined) {
    plan.description = description || null;
  }
  if (req.body.benefits !== undefined) {
    plan.benefits = benefits;
  }
  if (monthlyPrice !== undefined) {
    plan.monthlyPrice = parseFloat(monthlyPrice);
  }
  if (monthlyCredit !== undefined) {
    plan.monthlyCredit = parseInt(monthlyCredit);
  }
  if (annualMonthlyPrice !== undefined && !isCustom) {
    plan.annualMonthlyPrice = parseFloat(annualMonthlyPrice);
  }
  if (annualMonthlyCredit !== undefined && !isCustom) {
    plan.annualMonthlyCredit = parseInt(annualMonthlyCredit);
  }
  if (isCustomPlan !== undefined) {
    plan.isCustom = isCustomPlan === true || isCustomPlan === "true";
    // If switching to custom, reset pricing/credits
    if (plan.isCustom) {
      plan.monthlyPrice = 0;
      plan.monthlyCredit = 0;
      plan.annualMonthlyPrice = 0;
      plan.annualMonthlyCredit = 0;
    }
  }
  if (contactFormLink !== undefined) {
    plan.contactFormLink = contactFormLink || null;
  }
  if (color !== undefined) {
    plan.color = color || "#2196F3";
  }
  if (actionButtonText !== undefined) {
    plan.actionButtonText = actionButtonText;
  }
  if (unlimitedCredit !== undefined) {
    plan.unlimitedCredit = unlimitedCredit;
  }
  if (unlimitedCreditCap !== undefined) {
    plan.unlimitedCreditCap = parseInt(unlimitedCreditCap);
  }
  if (sortOrder !== undefined) {
    plan.sortOrder = parseInt(sortOrder);
  }
  if (isPopular !== undefined) {
    plan.isPopular = isPopular === true || isPopular === "true";
  }
  if (status !== undefined) {
    plan.status = status;
  }
  if (stripeMonthlyPriceId !== undefined) {
    plan.stripeMonthlyPriceId = stripeMonthlyPriceId || null;
  }
  if (stripeYearlyPriceId !== undefined) {
    plan.stripeYearlyPriceId = stripeYearlyPriceId || null;
  }
  if (paypalMonthlyPlanId !== undefined) {
    plan.paypalMonthlyPlanId = paypalMonthlyPlanId || null;
  }
  if (paypalYearlyPlanId !== undefined) {
    plan.paypalYearlyPlanId = paypalYearlyPlanId || null;
  }
  if (paddleMonthlyPlanId !== undefined) {
    plan.paddleMonthlyPlanId = paddleMonthlyPlanId || null;
  }
  if (paddleYearlyPlanId !== undefined) {
    plan.paddleYearlyPlanId = paddleYearlyPlanId || null;
  }

  // Handle icon upload if provided
  if (req.file) {
    if (plan.icon) {
      await deleteFileByPath(plan.icon);
    }
    let uploadData = await upload(req.file, "subscription-plan-icons", plan._id);
    const { Key } = uploadData;
    plan.icon = Key;
  }

  await plan.save();

  // Sync updates to Google Play Console if subscriptions exist
  let googlePlaySyncResult = null;
  if (!plan.isCustom && (plan.googlePlayMonthlySubscriptionId || plan.googlePlayAnnualSubscriptionId)) {
    try {
      console.log(`Syncing plan updates to Google Play for: ${plan.name}`);
      
      // Update monthly subscription if it exists
      if (plan.googlePlayMonthlySubscriptionId) {
        await googlePlayBillingService.updateSubscription({
          productId: plan.googlePlayMonthlySubscriptionId,
          name: `${plan.name} (Monthly)`,
          description: plan.description || `${plan.name} monthly subscription`,
        });
      }

      // Update annual subscription if it exists
      if (plan.googlePlayAnnualSubscriptionId) {
        await googlePlayBillingService.updateSubscription({
          productId: plan.googlePlayAnnualSubscriptionId,
          name: `${plan.name} (Annual)`,
          description: plan.description || `${plan.name} annual subscription`,
        });
      }

      plan.googlePlayLastSyncAt = new Date();
      await plan.save();
      
      googlePlaySyncResult = { success: true, updated: true };
      console.log(`✅ Google Play sync successful for updated plan: ${plan.name}`);
    } catch (syncError) {
      console.error(`❌ Google Play sync error for updated plan ${plan.name}:`, syncError.message);
      googlePlaySyncResult = { success: false, error: syncError.message };
    }
  }

  res.json({
    message: "Subscription plan updated successfully",
    data: plan,
    googlePlaySync: googlePlaySyncResult,
  });
});

/**
 * Sync a subscription plan with Google Play Console
 * Creates or updates the subscription products in Google Play
 *
 * @function syncPlanWithGooglePlay
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - Plan ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with sync result
 * @throws {AppError} If the plan is not found
 */
exports.syncPlanWithGooglePlay = catchAsync(async (req, res) => {
  const planId = req.params.id;

  const plan = await SubscriptionPlan.findOne({
    _id: planId,
    status: { $ne: "deleted" },
  });

  if (!plan) {
    throw new AppError("Subscription plan not found", 404);
  }

  if (plan.isCustom) {
    throw new AppError("Custom plans cannot be synced with Google Play", 400);
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
    const syncResult = await googlePlayBillingService.syncSubscriptionPlan(plan);

    if (syncResult.success) {
      // Update plan with Google Play product IDs
      // Note: Google Play subscriptions use the same product ID for both sandbox and production
      if (syncResult.monthlyProductId) {
        plan.googlePlayMonthlySubscriptionId = syncResult.monthlyProductId;
        plan.googlePlaySandboxMonthlySubscriptionId = syncResult.monthlyProductId; // Same ID for sandbox
      }
      if (syncResult.annualProductId) {
        plan.googlePlayAnnualSubscriptionId = syncResult.annualProductId;
        plan.googlePlaySandboxAnnualSubscriptionId = syncResult.annualProductId; // Same ID for sandbox
      }
      plan.googlePlaySyncStatus = 'synced';
      plan.googlePlaySyncError = null;
      plan.googlePlayLastSyncAt = new Date();
      await plan.save();

      res.json({
        message: "Subscription plan synced with Google Play successfully",
        data: plan,
        syncResult: syncResult,
      });
    } else {
      plan.googlePlaySyncStatus = 'failed';
      plan.googlePlaySyncError = syncResult.errors?.join(', ') || syncResult.reason || 'Unknown error';
      await plan.save();

      throw new AppError(
        `Google Play sync failed: ${plan.googlePlaySyncError}`,
        500
      );
    }
  } catch (error) {
    plan.googlePlaySyncStatus = 'failed';
    plan.googlePlaySyncError = error.message;
    await plan.save();

    throw error;
  }
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
  
  let subscriptions = [];
  if (status.initialized) {
    try {
      subscriptions = await googlePlayBillingService.listSubscriptions();
    } catch (error) {
      console.error("Failed to list subscriptions:", error);
    }
  }

  res.json({
    message: "Google Play Billing status retrieved",
    data: {
      ...status,
      subscriptionCount: subscriptions.length,
      subscriptions: subscriptions.map(s => ({
        productId: s.productId,
        packageName: s.packageName,
      })),
    },
  });
});

/**
 * Sync all subscription plans with Google Play Console
 *
 * @function syncAllPlansWithGooglePlay
 * @async
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response with sync results
 */
exports.syncAllPlansWithGooglePlay = catchAsync(async (req, res) => {
  // Check if Google Play service is initialized
  const serviceStatus = googlePlayBillingService.getStatus();
  if (!serviceStatus.initialized) {
    throw new AppError(
      "Google Play Billing service is not configured. Please set up service account credentials.",
      503
    );
  }

  const plans = await SubscriptionPlan.find({
    status: "active",
    isCustom: { $ne: true },
    $or: [
      { monthlyPrice: { $gt: 0 } },
      { annualMonthlyPrice: { $gt: 0 } },
    ],
  });

  const results = {
    total: plans.length,
    success: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  for (const plan of plans) {
    try {
      const syncResult = await googlePlayBillingService.syncSubscriptionPlan(plan);

      if (syncResult.success) {
        // Note: Google Play subscriptions use the same product ID for both sandbox and production
        if (syncResult.monthlyProductId) {
          plan.googlePlayMonthlySubscriptionId = syncResult.monthlyProductId;
          plan.googlePlaySandboxMonthlySubscriptionId = syncResult.monthlyProductId; // Same ID for sandbox
        }
        if (syncResult.annualProductId) {
          plan.googlePlayAnnualSubscriptionId = syncResult.annualProductId;
          plan.googlePlaySandboxAnnualSubscriptionId = syncResult.annualProductId; // Same ID for sandbox
        }
        plan.googlePlaySyncStatus = 'synced';
        plan.googlePlaySyncError = null;
        plan.googlePlayLastSyncAt = new Date();
        await plan.save();

        results.success++;
        results.details.push({
          planId: plan._id,
          planName: plan.name,
          status: 'success',
          monthlyProductId: syncResult.monthlyProductId,
          annualProductId: syncResult.annualProductId,
        });
      } else if (syncResult.skipped) {
        results.skipped++;
        results.details.push({
          planId: plan._id,
          planName: plan.name,
          status: 'skipped',
          reason: syncResult.reason,
        });
      } else {
        plan.googlePlaySyncStatus = 'failed';
        plan.googlePlaySyncError = syncResult.errors?.join(', ') || 'Unknown error';
        await plan.save();

        results.failed++;
        results.details.push({
          planId: plan._id,
          planName: plan.name,
          status: 'failed',
          errors: syncResult.errors,
        });
      }
    } catch (error) {
      plan.googlePlaySyncStatus = 'failed';
      plan.googlePlaySyncError = error.message;
      await plan.save();

      results.failed++;
      results.details.push({
        planId: plan._id,
        planName: plan.name,
        status: 'failed',
        error: error.message,
      });
    }
  }

  res.json({
    message: `Synced ${results.success} of ${results.total} plans with Google Play`,
    data: results,
  });
});

/**
 * Soft deletes a specific subscription plan by ID
 *
 * This function marks a plan as deleted without removing it from the database.
 *
 * @function deleteSubscriptionPlan
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.id - Plan ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response confirming the deletion
 * @throws {AppError} If the plan is not found
 */
exports.deleteSubscriptionPlan = catchAsync(async (req, res) => {
  const planId = req.params.id;

  // Find the plan
  const plan = await SubscriptionPlan.findOne({
    _id: planId,
    status: { $ne: "deleted" },
  });
  if (!plan) {
    throw new AppError("Subscription plan not found", 404);
  }

  // Archive subscriptions in Google Play Console if they exist
  let googlePlayArchiveResult = null;
  if (!plan.isCustom && (plan.googlePlayMonthlySubscriptionId || plan.googlePlayAnnualSubscriptionId)) {
    try {
      console.log(`Archiving Google Play subscriptions for: ${plan.name}`);
      
      // Archive monthly subscription if it exists
      if (plan.googlePlayMonthlySubscriptionId) {
        await googlePlayBillingService.archiveSubscription(plan.googlePlayMonthlySubscriptionId);
        console.log(`✅ Archived monthly subscription: ${plan.googlePlayMonthlySubscriptionId}`);
      }

      // Archive annual subscription if it exists
      if (plan.googlePlayAnnualSubscriptionId) {
        await googlePlayBillingService.archiveSubscription(plan.googlePlayAnnualSubscriptionId);
        console.log(`✅ Archived annual subscription: ${plan.googlePlayAnnualSubscriptionId}`);
      }

      googlePlayArchiveResult = { success: true, archived: true };
      console.log(`✅ Google Play subscriptions archived for deleted plan: ${plan.name}`);
    } catch (archiveError) {
      console.error(`❌ Google Play archive error for plan ${plan.name}:`, archiveError.message);
      googlePlayArchiveResult = { success: false, error: archiveError.message };
      // Continue with soft delete even if Google Play archive fails
    }
  }

  // Soft delete the plan by setting status to "deleted"
  plan.status = "deleted";
  await plan.save();

  res.json({
    message: "Subscription plan deleted successfully",
    googlePlayArchive: googlePlayArchiveResult,
  });
});

