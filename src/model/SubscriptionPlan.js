const mongoose = require("mongoose");
const Schema = mongoose.Schema;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const PlanSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      default: null,
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    icon: {
      type: String,
      default: null,
    },
    actionButtonText: {
      type: String,
      default: "Subscribe Now",
      trim: true,
    },
    // Custom plan option
    isCustom: {
      type: Boolean,
      default: false,
    },
    contactFormLink: {
      type: String,
      default: null,
      trim: true,
    },
    // Monthly plan details
    monthlyPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    monthlyCredit: {
      type: Number,
      min: 0,
      default: 0,
    },
    // Annual plan details (per month when billed annually)
    annualMonthlyPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    annualMonthlyCredit: {
      type: Number,
      min: 0,
      default: 0,
    },
    // Payment gateway integration IDs
    stripeMonthlyPriceId: {
      type: String,
      default: null,
    },
    stripeYearlyPriceId: {
      type: String,
      default: null,
    },
    paypalMonthlyPlanId: {
      type: String,
      default: null,
    },
    paypalYearlyPlanId: {
      type: String,
      default: null,
    },
    paddleMonthlyPlanId: {
      type: String,
      default: null,
    },
    paddleYearlyPlanId: {
      type: String,
      default: null,
    },
    // Credit management
    unlimitedCredit: {
      type: String,
      enum: ["yes", "no"],
      default: "no",
    },
    unlimitedCreditCap: {
      type: Number,
      default: 0,
    },
    // Display and ordering
    sortOrder: {
      type: Number,
      default: 0,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    // Theme color for the plan (hex color code)
    color: {
      type: String,
      default: "#2196F3", // Default blue color
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "deleted"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

PlanSchema.plugin(aggregatePaginate);
module.exports = mongoose.model("SubscriptionPlan", PlanSchema);
