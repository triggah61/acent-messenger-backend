/**
 * @fileoverview Contact model definition
 *
 * This module defines the schema for managing user contacts,
 * including contact status and relationship management.
 *
 * @module models/Contact
 * @requires mongoose
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const contactSchema = new Schema(
  {
    userOne: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userTwo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      default: Date.now(),
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    blockedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "blocked"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

contactSchema.plugin(aggregatePaginate);

// Ensure uniqueness for userId and phoneNumber combination
contactSchema.index({ userId: 1, phoneNumber: 1 }, { unique: true });

module.exports = mongoose.model("Contact", contactSchema);
