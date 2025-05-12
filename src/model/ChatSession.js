/**
 * @fileoverview ChatSession model definition
 *
 * This module defines the schema for tracking active chat sessions between users,
 * including timestamps for last interaction and last seen message.
 *
 * @module models/ChatSession
 * @requires mongoose
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const chatSessionSchema = new Schema(
  {
    title: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ["personal", "group"],
      default: "personal",
    },
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "pending", "rejected"],
      default: "active",
    },
    receipients: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        role: {
          type: String,
          enum: ["admin", "member"],
          default: "member",
        },
        isMute: {
          type: Boolean,
          default: false,
        },
        status: {
          type: String,
          enum: ["active", "pending", "rejected"],
          default: "active",
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

chatSessionSchema.plugin(aggregatePaginate);

// Ensure uniqueness for participant pairs (regardless of order)
chatSessionSchema.index(
  {
    participants: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model("ChatSession", chatSessionSchema);
