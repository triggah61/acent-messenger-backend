/**
 * @fileoverview Contact model definition
 *
 * This module defines the schema for managing user contacts,
 * including contact status and relationship management.
 *
 * @module models/Post
 * @requires mongoose
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const postSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    attachment: {
      type: Schema.Types.ObjectId,
      ref: "Attachment",
      default: null,
    },
    caption: {
      type: String,
      default: null,
    },
    likes: {
      type: Number,
      default: 0,
    },

    seenBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

postSchema.plugin(aggregatePaginate);

module.exports = mongoose.model("Post", postSchema);
