/**
 * @fileoverview TranslationSession model definition
 *
 * This module defines the schema for tracking real-time translation sessions,
 * including session metadata, duration, cost, and speaker configurations.
 *
 * @module models/TranslationSession
 * @requires mongoose
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const translationSessionSchema = new Schema(
  {
    // User who initiated the translation session
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Session status
    status: {
      type: String,
      enum: ["started", "active", "ended", "cancelled", "error"],
      default: "started",
      index: true,
    },

    // Session timestamps
    sessionStartTime: {
      type: Date,
      required: true,
      default: Date.now,
    },

    sessionEndTime: {
      type: Date,
      default: null,
    },

    // Total session duration in seconds
    totalDuration: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Speaker configurations
    speaker1Language: {
      type: String, // Language code (e.g., 'en', 'bn', 'ja')
      required: true,
    },

    speaker2Language: {
      type: String, // Language code (e.g., 'en', 'bn', 'ja')
      required: true,
    },

    speaker1Earpiece: {
      type: String,
      enum: ["left", "right"],
      default: "left",
    },

    speaker2Earpiece: {
      type: String,
      enum: ["left", "right"],
      default: "right",
    },

    speaker1Gender: {
      type: String,
      enum: ["male", "female"],
      default: "male",
    },

    speaker2Gender: {
      type: String,
      enum: ["male", "female"],
      default: "female",
    },

    // Audio/Speech input metrics
    totalAudioDurationSec: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalInputTokens: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Text output metrics
    totalTranscriptionCharacters: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalTranslationCharacters: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalOutputTokens: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Speaker-specific metrics
    speaker1TranscriptionCharacters: {
      type: Number,
      default: 0,
      min: 0,
    },

    speaker1TranslationCharacters: {
      type: Number,
      default: 0,
      min: 0,
    },

    speaker2TranscriptionCharacters: {
      type: Number,
      default: 0,
      min: 0,
    },

    speaker2TranslationCharacters: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Translation count
    totalTranslations: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Cost breakdown (in credits)
    inputCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    outputCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Fee rates applied during this session (stored for historical accuracy)
    appliedFeeRates: {
      inputCreditPerSec: {
        type: Number,
        default: 0,
      },
      outputCreditPerChar: {
        type: Number,
        default: 0,
      },
    },

    // User balance before and after session
    balanceBeforeSession: {
      type: Number,
      default: 0,
    },

    balanceAfterSession: {
      type: Number,
      default: null,
    },

    // Translation quality metrics
    averageLatencyMs: {
      type: Number,
      default: 0,
      min: 0,
    },

    // TWS/Bluetooth connection status
    twsConnected: {
      type: Boolean,
      default: false,
    },

    twsDeviceName: {
      type: String,
      default: null,
    },

    // Session mode
    mode: {
      type: String,
      enum: ["realtime", "manual"],
      default: "realtime",
    },

    // Error information (if session ended with error)
    errorMessage: {
      type: String,
      default: null,
    },

    // Reference to credit transaction
    creditTransaction: {
      type: Schema.Types.ObjectId,
      ref: "CreditTransaction",
      default: null,
    },

    // Metadata
    metadata: {
      clientPlatform: {
        type: String,
        enum: ["android", "ios", "web"],
        default: null,
      },
      appVersion: {
        type: String,
        default: null,
      },
      deviceModel: {
        type: String,
        default: null,
      },
    },

    // Remarks/notes
    remarks: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
translationSessionSchema.index({ user: 1, createdAt: -1 });
translationSessionSchema.index({ status: 1, createdAt: -1 });
translationSessionSchema.index({ user: 1, status: 1, createdAt: -1 });

// Plugin for pagination
translationSessionSchema.plugin(aggregatePaginate);

module.exports = mongoose.model("TranslationSession", translationSessionSchema);

