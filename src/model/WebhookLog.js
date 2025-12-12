const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * WebhookLog Model
 * Stores all webhook notifications received from Google Play for audit trail
 */
const webhookLogSchema = new Schema(
  {
    // Notification metadata
    notificationType: {
      type: String,
      required: true,
      trim: true,
    },
    version: {
      type: String,
      default: null,
    },
    notificationId: {
      type: String,
      default: null,
      trim: true,
      index: true, // For duplicate detection
    },
    
    // Subscription identifiers
    purchaseToken: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    subscriptionId: {
      type: String,
      default: null,
      trim: true,
    },
    orderId: {
      type: String,
      default: null,
      trim: true,
    },
    
    // Processing status
    status: {
      type: String,
      enum: ["pending", "processing", "processed", "failed", "ignored"],
      default: "pending",
      index: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    
    // Error tracking
    errorMessage: {
      type: String,
      default: null,
    },
    errorDetails: {
      type: Schema.Types.Mixed,
      default: null,
    },
    
    // Raw webhook data (for debugging)
    rawPayload: {
      type: Schema.Types.Mixed,
      default: null,
    },
    
    // Related subscription history
    subscriptionHistory: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionHistory",
      default: null,
    },
    
    // Related user
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    
    // Processing metadata
    processingTimeMs: {
      type: Number,
      default: null,
    },
    
    // Verification
    signatureVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
webhookLogSchema.index({ createdAt: -1 });
webhookLogSchema.index({ purchaseToken: 1, notificationType: 1 });
webhookLogSchema.index({ status: 1, createdAt: -1 });
webhookLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("WebhookLog", webhookLogSchema);

