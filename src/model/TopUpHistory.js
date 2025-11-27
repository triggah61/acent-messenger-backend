const mongoose = require("mongoose");
const Schema = mongoose.Schema;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const defaults = {
  type: String,
  default: null,
};

const schema = new Schema(
  {
    package: {
      type: mongoose.Types.ObjectId,
      ref: "CreditPackage",
      default: null,
    },
    user: {
      type: mongoose.Types.ObjectId,
      ref: "User",
      default: null,
    },
    paypalPaymentId: {
      type: String,
      default: null,
    },
    paypalPayerId: {
      type: String,
      default: null,
    },
    stripeSessionId: {
      type: String,
      default: null,
    },
    paypalToken: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      default: 0,
    },
    usdPrice: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["init", "executed", "failed"],
      default: "init",
    },
  },
  {
    timestamps: true,
  }
);
schema.plugin(aggregatePaginate);
module.exports = mongoose.model("TopUpHistory", schema);
