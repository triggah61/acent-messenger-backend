const mongoose = require("mongoose"),
  bcrypt = require("bcryptjs");
const Schema = mongoose.Schema;
const userSchema = new Schema(
  {
    traceId: {
      type: String,
      default: null,
    },
    user: {
      type: mongoose.Types.ObjectId,
      default: null,
    },
    criteria: {
      type: String,
      enum: [
        "USER_RESET_PASSWORD",
        "CHANGE_PASSWORD",
        "USER_REGISTER",
        "USER_LOGIN",
      ],
      default: "USER_REGISTER",
    },
    phoneWithDialCode: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: null,
    },
    via: {
      type: String,
      enum: ["email", "phone"], // Add additional methods if needed
      default: "phone",
    },
    code: {
      type: String,
      default: null,
    },
    data: {
      type: Object,
      default: {},
    },
    expireAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "verified", "expired"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);
module.exports = mongoose.model("OtpVerification", userSchema);
