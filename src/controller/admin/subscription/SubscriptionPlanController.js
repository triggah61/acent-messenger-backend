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

  res.status(201).json({
    message: "Subscription plan created successfully",
    data: plan,
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

  res.json({
    message: "Subscription plan updated successfully",
    data: plan,
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

  // Soft delete the plan by setting status to "deleted"
  plan.status = "deleted";
  await plan.save();

  res.json({
    message: "Subscription plan deleted successfully",
  });
});

