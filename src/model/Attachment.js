/**
 * @fileoverview Message model definition
 *
 * This module defines the schema for storing chat messages between users.
 * It includes fields for sender, receiver, content, message type,
 * and message status tracking.
 *
 * @module models/Message
 * @requires mongoose
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const attachmentSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    criteria: {
      type: String,
      enum: ["message", "profile", "cover", "story"],
      default: "message",
    },
    type: {
      type: String,
      enum: ["image", "video", "audio", "document", "sticker", "gif", null],
      default: null,
    },
    url: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      default: null,
    },
    size: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

attachmentSchema.plugin(aggregatePaginate);

module.exports = mongoose.model("Attachment", attachmentSchema);
