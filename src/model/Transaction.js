const mongoose = require("mongoose");
const { Schema } = mongoose;
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const transactionSchema = new Schema(
  {
    // Transaction hash from blockchain
    txHash: {
      type: String,
      unique: true,
      sparse: true, // For pending transactions that don't have hash yet
      index: true,
    },
    
    // Internal transaction ID
    internalId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    
    // Transaction type
    type: {
      type: String,
      enum: ["deposit", "withdrawal", "transfer", "fee", "admin_fee"],
      required: true,
      index: true,
    },
    
    // User involved in transaction
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    
    // From wallet address
    fromAddress: {
      type: String,
      required: true,
      index: true,
    },
    
    // To wallet address
    toAddress: {
      type: String,
      required: true,
      index: true,
    },
    
    // Amount in satoshis
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    
    // Fee amount in satoshis
    fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    
    // Admin fee (platform fee) in satoshis
    adminFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    
    // Net amount (amount - fee - adminFee)
    netAmount: {
      type: Number,
      required: true,
    },
    
    // Transaction status
    status: {
      type: String,
      enum: ["pending", "confirmed", "failed", "cancelled", "processing"],
      default: "pending",
      index: true,
    },
    
    // Confirmation count
    confirmations: {
      type: Number,
      default: 0,
    },
    
    // Block number where transaction was included
    blockNumber: {
      type: Number,
      sparse: true,
    },
    
    // Block hash where transaction was included
    blockHash: {
      type: String,
      sparse: true,
    },
    
    // Network (mainnet, testnet)
    network: {
      type: String,
      enum: ["mainnet", "testnet"],
      default: "testnet",
    },
    
    // Priority level for transaction
    priority: {
      type: String,
      enum: ["low", "medium", "high", "custom"],
      default: "medium",
    },
    
    // Raw transaction hex
    rawTransaction: {
      type: String,
      sparse: true,
    },
    
    // UTXOs used as inputs
    inputs: [{
      txid: String,
      vout: Number,
      value: Number,
      scriptPubKey: String,
    }],
    
    // Transaction outputs
    outputs: [{
      address: String,
      value: Number,
      scriptPubKey: String,
    }],
    
    // Security and audit fields
    ipAddress: {
      type: String,
      default: null,
    },
    
    userAgent: {
      type: String,
      default: null,
    },
    // Notes or description
    description: {
      type: String,
      default: null,
      maxlength: 500,
    },
    
    // Tags for categorization
    tags: [{
      type: String,
      trim: true,
      default: null,
    }],

    // Metadata for additional information (especially for auto-detected transactions)
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },

    // Processing timestamps
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    
    processedAt: {
      type: Date,
      default: null,
    },
    
    confirmedAt: {
      type: Date,
      default: null,
    },
    
  },
  {
    timestamps: true,
  }
);

// Indexes for performance and queries
transactionSchema.index({ userId: 1, status: 1, createdAt: -1 });
transactionSchema.index({ fromAddress: 1, createdAt: -1 });
transactionSchema.index({ toAddress: 1, createdAt: -1 });
transactionSchema.index({ type: 1, status: 1 });
transactionSchema.index({ txHash: 1 });
transactionSchema.index({ blockNumber: 1 });
transactionSchema.index({ submittedAt: 1 });

// Plugin
transactionSchema.plugin(aggregatePaginate);

// Pre-save middleware to calculate net amount
transactionSchema.pre('save', function(next) {
  if (this.isModified('amount') || this.isModified('fee') || this.isModified('adminFee')) {
    this.netAmount = this.amount - this.fee - this.adminFee;
  }
  next();
});

// Instance methods
transactionSchema.methods.markAsConfirmed = function(txHash, blockNumber, blockHash) {
  this.status = 'confirmed';
  this.txHash = txHash;
  this.blockNumber = blockNumber;
  this.blockHash = blockHash;
  this.confirmedAt = new Date();
  this.confirmations = 1;
  return this.save();
};

transactionSchema.methods.markAsFailed = function(errorDetails) {
  this.status = 'failed';
  this.errorDetails = errorDetails;
  this.processedAt = new Date();
  return this.save();
};

transactionSchema.methods.addConfirmation = function() {
  this.confirmations += 1;
  return this.save();
};

// Static methods
transactionSchema.statics.findByUser = function(userId, page = 1, limit = 10) {
  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { createdAt: -1 },
    populate: 'userId relatedTransactions',
  };
  
  return this.aggregatePaginate(
    this.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(userId) } }
    ]),
    options
  );
};

transactionSchema.statics.findPendingTransactions = function() {
  return this.find({ 
    status: { $in: ['pending', 'processing'] } 
  }).sort({ submittedAt: 1 });
};

transactionSchema.statics.calculateUserBalance = async function(userId) {
  const result = await this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        status: 'confirmed'
      }
    },
    {
      $group: {
        _id: null,
        totalReceived: {
          $sum: {
            $cond: [
              { $eq: ['$type', 'deposit'] },
              '$netAmount',
              0
            ]
          }
        },
        totalSent: {
          $sum: {
            $cond: [
              { $in: ['$type', ['withdrawal', 'transfer']] },
              { $add: ['$amount', '$fee', '$adminFee'] },
              0
            ]
          }
        },
        totalFees: {
          $sum: { $add: ['$fee', '$adminFee'] }
        }
      }
    }
  ]);
  
  if (result.length === 0) {
    return { balance: 0, totalReceived: 0, totalSent: 0, totalFees: 0 };
  }
  
  const { totalReceived, totalSent, totalFees } = result[0];
  return {
    balance: totalReceived - totalSent,
    totalReceived,
    totalSent,
    totalFees
  };
};

// Find transaction by hash
transactionSchema.statics.findByTxHash = function(txHash) {
  return this.findOne({ txHash });
};

// Get latest transaction for an address (for pagination in listener)
transactionSchema.statics.getLatestTransactionForAddress = function(address) {
  return this.findOne({
    $or: [
      { fromAddress: address },
      { toAddress: address }
    ]
  }).sort({ submittedAt: -1 });
};

// Find auto-detected transactions
transactionSchema.statics.findAutoDetectedTransactions = function(limit = 100) {
  return this.find({
    'metadata.detectedBy': 'transaction-listener'
  }).sort({ createdAt: -1 }).limit(limit);
};

module.exports = mongoose.model("Transaction", transactionSchema); 