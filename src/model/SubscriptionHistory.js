const mongoose = require("mongoose");
const Schema = mongoose.Schema;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const defaults = {
  type: String,
  default: null,
};
const dDefaults = {
  type: Date,
  default: null,
};

/**
 * Subscription Event Schema
 * Tracks individual events in the subscription lifecycle
 */
const subscriptionEventSchema = new Schema({
  eventType: {
    type: String,
    required: true,
    enum: [
      "SUBSCRIPTION_PURCHASED",
      "SUBSCRIPTION_RENEWED",
      "SUBSCRIPTION_CANCELED",
      "SUBSCRIPTION_EXPIRED",
      "SUBSCRIPTION_RESTARTED",
      "SUBSCRIPTION_ON_HOLD",
      "SUBSCRIPTION_IN_GRACE_PERIOD",
      "SUBSCRIPTION_RECOVERED",
      "SUBSCRIPTION_PAUSED",
      "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
      "SUBSCRIPTION_DEFERRED",
      "SUBSCRIPTION_REVOKED",
      "MANUAL_ACTIVATION",
      "MANUAL_CANCELLATION",
      "UPGRADE",
      "DOWNGRADE",
    ],
  },
  eventTime: {
    type: Date,
    default: Date.now,
  },
  // Google Play specific data
  orderId: {
    type: String,
    default: null,
  },
  purchaseToken: {
    type: String,
    default: null,
  },
  // Subscription state at time of event
  expiryTimeAtEvent: {
    type: Date,
    default: null,
  },
  autoRenewingAtEvent: {
    type: Boolean,
    default: null,
  },
  // Credits added/removed during this event
  creditsChanged: {
    type: Number,
    default: 0,
  },
  // Additional metadata
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
  // Source of the event
  source: {
    type: String,
    enum: ["google_play_webhook", "app_purchase", "admin", "system", "manual"],
    default: "google_play_webhook",
  },
}, { _id: true, timestamps: false });

/**
 * Payment Record Schema
 * Tracks individual payment transactions
 */
const paymentRecordSchema = new Schema({
  paymentTime: {
    type: Date,
    default: Date.now,
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: "USD",
  },
  // Google Play order details
  orderId: {
    type: String,
    default: null,
  },
  transactionId: {
    type: String,
    default: null,
  },
  // Payment status
  status: {
    type: String,
    enum: ["pending", "completed", "failed", "refunded", "chargeback"],
    default: "completed",
  },
  // Payment type
  paymentType: {
    type: String,
    enum: ["initial", "renewal", "upgrade", "manual"],
    default: "initial",
  },
  // Billing period this payment covers
  periodStart: {
    type: Date,
    default: null,
  },
  periodEnd: {
    type: Date,
    default: null,
  },
  // Credits granted for this payment
  creditsGranted: {
    type: Number,
    default: 0,
  },
  // Additional metadata
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, { _id: true, timestamps: false });

const subscriptionHistorySchema = new Schema(
  {
    user: {
      type: Schema.ObjectId,
      ref: "User",
      default: null,
    },
    subscriptionPlan: {
      type: mongoose.Types.ObjectId,
      ref: "SubscriptionPlan",
      default: null,
    },
    cycleType: {
      type: String,
      default: "monthly",
    },
    totalCycle: {
      type: Number,
      default: 0,
    },
    cycleCompleted: {
      type: Number,
      default: 0,
    },
    currentCycleBalance: {
      type: Number,
      default: 0,
    },
    nextCycleAt: {
      ...dDefaults,
    },
    subscriptionStartedAt: {
      ...dDefaults,
    },
    subscriptionEndDate: {
      ...dDefaults,
    },
    remarks: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled", "upgraded", "paused", "on_hold", "in_grace_period"],
      default: "active",
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      default: 0,
    },
    transactionType: {
      type: String,
      default: null,
    },
    transactionId: {
      type: String,
      default: null,
    },
    // Google Play Billing fields
    googlePlayPurchaseToken: {
      type: String,
      default: null,
      trim: true,
      index: true, // Index for faster webhook lookups
    },
    googlePlayOrderId: {
      type: String,
      default: null,
      trim: true,
    },
    googlePlayTransactionId: {
      type: String,
      default: null,
      trim: true,
    },
    googlePlayProductId: {
      type: String,
      default: null,
      trim: true,
    },
    googlePlayAcknowledged: {
      type: Boolean,
      default: false,
    },
    // Webhook tracking fields
    webhookProcessedAt: {
      ...dDefaults,
    },
    lastWebhookEventType: {
      type: String,
      default: null,
    },
    gracePeriodEndsAt: {
      ...dDefaults,
    },
    autoRenewing: {
      type: Boolean,
      default: true,
    },
    
    // ============================================
    // NEW: Subscription Events History
    // ============================================
    // Tracks all events in the subscription lifecycle
    events: {
      type: [subscriptionEventSchema],
      default: [],
    },
    
    // ============================================
    // NEW: Payment Records
    // ============================================
    // Tracks all payments made for this subscription
    payments: {
      type: [paymentRecordSchema],
      default: [],
    },
    
    // ============================================
    // NEW: Renewal tracking
    // ============================================
    // Total number of successful renewals
    renewalCount: {
      type: Number,
      default: 0,
    },
    // Last successful renewal date
    lastRenewalAt: {
      type: Date,
      default: null,
    },
    // Total amount paid over lifetime
    totalAmountPaid: {
      type: Number,
      default: 0,
    },
    // Total credits received over lifetime
    totalCreditsReceived: {
      type: Number,
      default: 0,
    },
    
    // ============================================
    // NEW: Cancellation tracking
    // ============================================
    // When user cancelled (subscription remains active until expiry)
    cancelledAt: {
      type: Date,
      default: null,
    },
    // Who initiated the cancellation
    cancelledBy: {
      type: String,
      enum: ["user", "admin", "system", "google_play"],
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
subscriptionHistorySchema.index({ user: 1, status: 1 });
subscriptionHistorySchema.index({ googlePlayPurchaseToken: 1 });
subscriptionHistorySchema.index({ status: 1, subscriptionEndDate: 1 });

// Virtual to get the latest event
subscriptionHistorySchema.virtual('latestEvent').get(function() {
  if (this.events && this.events.length > 0) {
    return this.events[this.events.length - 1];
  }
  return null;
});

// Virtual to get the latest payment
subscriptionHistorySchema.virtual('latestPayment').get(function() {
  if (this.payments && this.payments.length > 0) {
    return this.payments[this.payments.length - 1];
  }
  return null;
});

// Method to add an event
subscriptionHistorySchema.methods.addEvent = function(eventData) {
  this.events.push({
    eventType: eventData.eventType,
    eventTime: eventData.eventTime || new Date(),
    orderId: eventData.orderId,
    purchaseToken: eventData.purchaseToken,
    expiryTimeAtEvent: eventData.expiryTimeAtEvent,
    autoRenewingAtEvent: eventData.autoRenewingAtEvent,
    creditsChanged: eventData.creditsChanged || 0,
    metadata: eventData.metadata || {},
    source: eventData.source || 'google_play_webhook',
  });
  this.lastWebhookEventType = eventData.eventType;
  this.webhookProcessedAt = new Date();
  return this;
};

// Method to add a payment record
subscriptionHistorySchema.methods.addPayment = function(paymentData) {
  this.payments.push({
    paymentTime: paymentData.paymentTime || new Date(),
    amount: paymentData.amount,
    currency: paymentData.currency || 'USD',
    orderId: paymentData.orderId,
    transactionId: paymentData.transactionId,
    status: paymentData.status || 'completed',
    paymentType: paymentData.paymentType || 'renewal',
    periodStart: paymentData.periodStart,
    periodEnd: paymentData.periodEnd,
    creditsGranted: paymentData.creditsGranted || 0,
    metadata: paymentData.metadata || {},
  });
  this.totalAmountPaid = (this.totalAmountPaid || 0) + paymentData.amount;
  if (paymentData.creditsGranted) {
    this.totalCreditsReceived = (this.totalCreditsReceived || 0) + paymentData.creditsGranted;
  }
  return this;
};

subscriptionHistorySchema.plugin(aggregatePaginate);
module.exports = mongoose.model("SubscriptionHistory", subscriptionHistorySchema);
