const mongoose = require("mongoose");
const Schema = mongoose.Schema;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const creditTransactionSchema = new Schema(
  {
    user: {
      type: Schema.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    source: {
      type: String,
      default: null,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "processed"],
      default: "active",
    },
    subscriptionPlan: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      default: null,
    },
    subscriptionHistory: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionHistory",
      default: null,
    },
    topUpHistory: {
      type: Schema.Types.ObjectId,
      ref: "TopUpHistory",
      default: null,
    },
    remarks: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ user: 1, type: 1 });
creditTransactionSchema.index({ status: 1 });

creditTransactionSchema.plugin(aggregatePaginate);
module.exports = mongoose.model("CreditTransaction", creditTransactionSchema);

