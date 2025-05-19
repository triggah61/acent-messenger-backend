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

const messageSchema = new Schema(
  {
    chatSession: {
      type: Schema.Types.ObjectId,
      ref: "ChatSession",
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      trim: true,
    },
    attachments: [
      {
        type: Schema.Types.ObjectId,
        ref: "Attachment",
      },
    ],
    status: {
      type: String,
      enum: ["sent", "delivered", "seen", "deleted"],
      default: "sent",
    },
    deletedFor: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    reactions: [
      {
        reaction: {
          type: String,
          enum: ["like", "love", "laugh", "sad", "angry", "wow", "cry"],
        },
        reactedBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        reactedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

messageSchema.plugin(aggregatePaginate);

module.exports = mongoose.model("Message", messageSchema);
