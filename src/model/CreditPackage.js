const mongoose = require("mongoose");
const Schema = mongoose.Schema;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const CreditPackageSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    usdPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    credits: {
      type: Number,
      required: true,
      min: 0,
    },
    // Google Play Billing product IDs
    googlePlayProductId: {
      type: String,
      default: null,
      trim: true,
    },
    googlePlaySandboxProductId: {
      type: String,
      default: null,
      trim: true,
    },
    // Google Play sync status
    googlePlaySyncStatus: {
      type: String,
      enum: ['pending', 'synced', 'failed', 'not_applicable'],
      default: 'pending',
    },
    googlePlaySyncError: {
      type: String,
      default: null,
    },
    googlePlayLastSyncAt: {
      type: Date,
      default: null,
    },
    // Display order
    sortOrder: {
      type: Number,
      default: 0,
    },
    isPopular: {
      type: Boolean,
      default: false,
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

CreditPackageSchema.plugin(aggregatePaginate);
module.exports = mongoose.model("CreditPackage", CreditPackageSchema);

