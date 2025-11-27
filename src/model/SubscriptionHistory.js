const mongoose = require("mongoose");
const Schema = mongoose.Schema;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const defaults = {
  type: String,
  default: null,
};
const dDefaults = {
  type: Date,
  default: null,
};

const subscriptionHistorySchema = new Schema(
  {
    user: {
      type: Schema.ObjectId,
      ref: "User",
      default: null,
    },
    subscriptionPlan: {
      type: mongoose.Types.ObjectId,
      ref: "SubscriptionPlan",
      default: null,
    },
    cycleType: {
      type: String,
      default: "monthly",
    },
    totalCycle: {
      type: Number,
      default: 0,
    },
    cycleCompleted: {
      type: Number,
      default: 0,
    },
    currentCycleBalance: {
      type: Number,
      default: 0,
    },
    nextCycleAt: {
      ...dDefaults,
    },
    subscriptionStartedAt: {
      ...dDefaults,
    },
    subscriptionEndDate: {
      ...dDefaults,
    },
    membership: {
      type: String,
      enum: ["pro", "free"],
      default: "pro",
    },
    remarks: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled", "upgraded"],
      default: "active",
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      default: 0,
    },
    transactionType: {
      type: String,
      default: null,
    },
    transactionId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);
subscriptionHistorySchema.plugin(aggregatePaginate);
module.exports = mongoose.model("SubscriptionHistory", subscriptionHistorySchema);
