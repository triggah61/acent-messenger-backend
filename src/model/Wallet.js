const mongoose = require("mongoose");
const crypto = require("crypto");
const { Schema } = mongoose;
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const walletSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    address: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Encrypted private key
    encryptedPrivateKey: {
      type: String,
      required: true,
    },
    // Encrypted mnemonic
    encryptedMnemonic: {
      type: String,
      required: true,
    },
    // Salt for encryption
    salt: {
      type: String,
      required: true,
    },
    // Public key
    publicKey: {
      type: String,
      required: true,
    },
    // HD wallet derivation path
    derivationPath: {
      type: String,
      required: true,
    },
    // Wallet type (main, change, etc.)
    walletType: {
      type: String,
      enum: ["main", "change", "cold", "admin"],
      default: "main",
    },
    // Network (mainnet, testnet)
    network: {
      type: String,
      enum: ["mainnet", "testnet"],
      default: "testnet",
    },
    // Wallet status
    status: {
      type: String,
      enum: ["active", "inactive", "frozen", "deleted"],
      default: "active",
    },
    // Security features
    multiSig: {
      enabled: {
        type: Boolean,
        default: false,
      },
      requiredSignatures: {
        type: Number,
        default: 1,
      },
      totalSignatures: {
        type: Number,
        default: 1,
      },
    },
    // Metadata
    label: {
      type: String,
      default: "Main Wallet",
    },
    lastUsed: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
walletSchema.index({ userId: 1, status: 1 });
walletSchema.index({ address: 1 });
walletSchema.index({ walletType: 1, status: 1 });

// Plugin
walletSchema.plugin(aggregatePaginate);

// Instance methods
walletSchema.methods.encryptPrivateKey = function (privateKey, walletEncryptionKey) {
  console.log("walletEncryptionKey", walletEncryptionKey);
  let { salt } = this;
  if (!salt) {
    salt = crypto.randomBytes(32).toString("hex");
  }
  
  const key = crypto.scryptSync(walletEncryptionKey, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Store IV with encrypted data
  this.encryptedPrivateKey = iv.toString("hex") + ":" + encrypted;
  this.salt = salt;
  return this.encryptedPrivateKey;
};

walletSchema.methods.decryptPrivateKey = function (walletEncryptionKey) {
  try {
    console.log("=== DECRYPTION DEBUG ===");
    console.log("walletEncryptionKey provided:", !!walletEncryptionKey);
    console.log("walletEncryptionKey length:", walletEncryptionKey ? walletEncryptionKey.length : 0);
    console.log("salt:", this.salt);
    console.log("encryptedPrivateKey format:", this.encryptedPrivateKey.substring(0, 20) + "...");
    console.log("encryptedPrivateKey has colon:", this.encryptedPrivateKey.includes(":"));
    
    if (!walletEncryptionKey) {
      throw new Error("No wallet encryption key provided");
    }
    
    if (!this.salt) {
      throw new Error("No salt found in wallet");
    }
    
    const key = crypto.scryptSync(walletEncryptionKey, this.salt, 32);
    
    // Check if this is the new format (with IV)
    const parts = this.encryptedPrivateKey.split(":");
    if (parts.length === 2) {
      console.log("Using NEW format (with IV)");
      // New format with IV
      const iv = Buffer.from(parts[0], "hex");
      const encryptedData = parts[1];
      
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");
      console.log("NEW format decryption successful");
      return decrypted;
    } else {
      console.log("Using OLD format (backward compatibility)");
      // Old format - try the deprecated method for backward compatibility
      try {
        const decipher = crypto.createDecipher("aes-256-gcm", key);
        let decrypted = decipher.update(this.encryptedPrivateKey, "hex", "utf8");
        decrypted += decipher.final("utf8");
        console.log("OLD GCM format decryption successful");
        return decrypted;
      } catch (gcmError) {
        console.log("GCM failed, trying CBC:", gcmError.message);
        // If GCM fails, try the old CBC method without IV
        const decipher = crypto.createDecipher("aes-256-cbc", key);
        let decrypted = decipher.update(this.encryptedPrivateKey, "hex", "utf8");
        decrypted += decipher.final("utf8");
        console.log("OLD CBC format decryption successful");
        return decrypted;
      }
    }
  } catch (error) {
    console.error("=== DECRYPTION ERROR ===");
    console.error("Error details:", error.message);
    console.error("Stack:", error.stack);
    throw new Error("Invalid password or corrupted private key");
  }
};

walletSchema.methods.encryptMnemonic = async function (mnemonic, password) {
  // Store mnemonic in plain text for now (as per your commented logic)
  this.encryptedMnemonic = mnemonic;
  return mnemonic;
};

walletSchema.methods.decryptMnemonic = async function (password) {
  // Return plain text mnemonic for now (as per your commented logic)
  return this.encryptedMnemonic;
};

module.exports = mongoose.model("Wallet", walletSchema);
