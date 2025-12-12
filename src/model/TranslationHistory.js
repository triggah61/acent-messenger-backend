/**
 * @fileoverview TranslationHistory model definition
 *
 * This module defines the schema for storing individual translation records
 * within a translation session, including transcription and translation for each speaker.
 *
 * @module models/TranslationHistory
 * @requires mongoose
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const translationHistorySchema = new Schema(
  {
    // Reference to the translation session
    translationSession: {
      type: Schema.Types.ObjectId,
      ref: "TranslationSession",
      required: true,
      index: true,
    },

    // User who owns this session
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Speaker index (0 or 1)
    speakerIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },

    // Speaker name (e.g., "Speaker 1", "Speaker 2")
    speakerName: {
      type: String,
      default: null,
    },

    // Original transcription text (speech-to-text output)
    transcriptionText: {
      type: String,
      required: true,
      trim: true,
    },

    // Translated text (translation output)
    translationText: {
      type: String,
      default: null,
      trim: true,
    },

    // Language codes
    sourceLanguage: {
      type: String, // Language code (e.g., 'en', 'bn', 'ja')
      required: true,
    },

    targetLanguage: {
      type: String, // Language code (e.g., 'en', 'bn', 'ja')
      default: null,
    },

    // Text metrics
    transcriptionCharacters: {
      type: Number,
      default: 0,
      min: 0,
    },

    translationCharacters: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Timestamp when this translation occurred
    translationTimestamp: {
      type: Date,
      default: Date.now,
    },

    // Translation latency in milliseconds
    latencyMs: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Translation service used
    translationService: {
      type: String,
      enum: ["soniox", "azure", "google", "manual"],
      default: "soniox",
    },

    // TTS (Text-to-Speech) information
    tts: {
      generated: {
        type: Boolean,
        default: false,
      },
      filePath: {
        type: String,
        default: null,
      },
      audioChannel: {
        type: String,
        enum: ["left", "right", "mono"],
        default: "mono",
      },
      gender: {
        type: String,
        enum: ["male", "female"],
        default: null,
      },
      played: {
        type: Boolean,
        default: false,
      },
      playedAt: {
        type: Date,
        default: null,
      },
    },

    // Sequence number within session (for ordering)
    sequenceNumber: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Whether this is a final translation or interim
    isFinal: {
      type: Boolean,
      default: true,
    },

    // Confidence score (if available from STT/translation service)
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },

    // Metadata
    metadata: {
      // Audio chunk information
      audioChunkDuration: {
        type: Number,
        default: 0,
      },
      // Whether this came from Soniox real-time or Azure fallback
      primaryServiceUsed: {
        type: Boolean,
        default: true,
      },
      // Any additional info
      notes: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
translationHistorySchema.index({ translationSession: 1, createdAt: 1 });
translationHistorySchema.index({ user: 1, createdAt: -1 });
translationHistorySchema.index({ translationSession: 1, sequenceNumber: 1 });

// Plugin for pagination
translationHistorySchema.plugin(aggregatePaginate);

module.exports = mongoose.model("TranslationHistory", translationHistorySchema);

