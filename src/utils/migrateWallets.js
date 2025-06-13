const mongoose = require("mongoose");
const crypto = require("crypto");
require("dotenv").config();

const Wallet = require("../model/Wallet");

async function migrateWallets() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    // Get all wallets
    const wallets = await Wallet.find({});
    console.log(`Found ${wallets.length} wallets to migrate`);

    const walletEncryptionKey = process.env.WALLET_ENCRYPTION_KEY;
    if (!walletEncryptionKey) {
      throw new Error("WALLET_ENCRYPTION_KEY not found in environment variables");
    }

    let migratedCount = 0;
    let errorCount = 0;

    for (const wallet of wallets) {
      try {
        console.log(`Processing wallet ${wallet._id}...`);
        
        // Try to decrypt with old format
        let decryptedPrivateKey;
        try {
          decryptedPrivateKey = decryptOldFormat(wallet.encryptedPrivateKey, wallet.salt, walletEncryptionKey);
          console.log("✓ Successfully decrypted with old format");
        } catch (error) {
          console.log("✗ Failed to decrypt with old format:", error.message);
          continue;
        }

        // Re-encrypt with new format
        const newEncrypted = encryptNewFormat(decryptedPrivateKey, wallet.salt, walletEncryptionKey);
        
        // Update wallet
        await Wallet.updateOne(
          { _id: wallet._id },
          { encryptedPrivateKey: newEncrypted }
        );
        
        console.log("✓ Wallet migrated successfully");
        migratedCount++;
        
      } catch (error) {
        console.error(`✗ Error migrating wallet ${wallet._id}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\nMigration complete:`);
    console.log(`- Successfully migrated: ${migratedCount} wallets`);
    console.log(`- Errors: ${errorCount} wallets`);

  } catch (error) {
    console.error("Migration failed:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

function decryptOldFormat(encryptedPrivateKey, salt, walletEncryptionKey) {
  const key = crypto.scryptSync(walletEncryptionKey, salt, 32);
  
  // Try GCM first
  try {
    const decipher = crypto.createDecipher("aes-256-gcm", key);
    let decrypted = decipher.update(encryptedPrivateKey, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (gcmError) {
    // Try CBC
    const decipher = crypto.createDecipher("aes-256-cbc", key);
    let decrypted = decipher.update(encryptedPrivateKey, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}

function encryptNewFormat(privateKey, salt, walletEncryptionKey) {
  const key = crypto.scryptSync(walletEncryptionKey, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Store IV with encrypted data
  return iv.toString("hex") + ":" + encrypted;
}

// Run the migration
if (require.main === module) {
  migrateWallets().catch(console.error);
}

module.exports = { migrateWallets }; 