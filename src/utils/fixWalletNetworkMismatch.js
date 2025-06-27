const mongoose = require('mongoose');
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const eccLib = require('tiny-secp256k1');

// Setup ECPair with complete ECC wrapper
const ecc = {
  isPrivate: eccLib.isPrivate,
  isPoint: eccLib.isPoint,
  isPointCompressed: eccLib.isPointCompressed,
  isXOnlyPoint: eccLib.isXOnlyPoint,
  pointAdd: (a, b) => {
    const result = eccLib.pointAdd(a, b);
    return result ? Buffer.from(result) : null;
  },
  pointAddScalar: (p, tweak) => {
    const result = eccLib.pointAddScalar(p, tweak);
    return result ? Buffer.from(result) : null;
  },
  pointCompress: (p, compressed) => {
    const result = eccLib.pointCompress(p, compressed);
    return Buffer.from(result);
  },
  pointFromScalar: (d, compressed) => {
    const result = eccLib.pointFromScalar(d, compressed);
    return result ? Buffer.from(result) : null;
  },
  pointMultiply: (p, tweak) => {
    const result = eccLib.pointMultiply(p, tweak);
    return result ? Buffer.from(result) : null;
  },
  xOnlyPointFromScalar: (d) => {
    const result = eccLib.xOnlyPointFromScalar(d);
    return Buffer.from(result);
  },
  xOnlyPointFromPoint: (p) => {
    const result = eccLib.xOnlyPointFromPoint(p);
    return Buffer.from(result);
  },
  xOnlyPointAddTweak: (p, tweak) => {
    const result = eccLib.xOnlyPointAddTweak(p, tweak);
    return result
      ? { parity: result.parity, xOnlyPubkey: Buffer.from(result.xOnlyPubkey) }
      : null;
  },
  xOnlyPointAddTweakCheck: eccLib.xOnlyPointAddTweakCheck,
  privateAdd: (d, tweak) => {
    const result = eccLib.privateAdd(d, tweak);
    return result ? Buffer.from(result) : null;
  },
  privateSub: (d, tweak) => {
    const result = eccLib.privateSub(d, tweak);
    return result ? Buffer.from(result) : null;
  },
  privateNegate: (d) => {
    const result = eccLib.privateNegate(d);
    return Buffer.from(result);
  },
  sign: (hash, privateKey) => {
    const signature = eccLib.sign(hash, privateKey);
    return Buffer.from(signature);
  },
  signRecoverable: (hash, privateKey) => {
    const result = eccLib.signRecoverable(hash, privateKey);
    return {
      signature: Buffer.from(result.signature),
      recovery: result.recovery,
    };
  },
  signSchnorr: (hash, privateKey, auxRand) => {
    const signature = eccLib.signSchnorr(hash, privateKey, auxRand);
    return Buffer.from(signature);
  },
  verify: eccLib.verify,
  recover: (hash, signature, recovery, compressed) => {
    const result = eccLib.recover(hash, signature, recovery, compressed);
    return result ? Buffer.from(result) : null;
  },
  verifySchnorr: eccLib.verifySchnorr,
};

const ECPair = ECPairFactory(ecc);

require('dotenv').config();
require('../config/db');

const Wallet = require('../model/Wallet');

/**
 * Fix wallet network mismatch issues
 * This script checks and corrects private key format mismatches
 */
async function fixWalletNetworkMismatch() {
  try {
    console.log('🔧 Starting wallet network mismatch fix...');
    
    const currentNetwork = process.env.BITCOIN_NETWORK === 'mainnet' 
      ? bitcoin.networks.bitcoin 
      : bitcoin.networks.testnet;
    
    console.log(`Current network: ${process.env.BITCOIN_NETWORK || 'testnet'}`);
    
    const wallets = await Wallet.find({ status: 'active' });
    console.log(`Found ${wallets.length} active wallets to check`);
    
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const wallet of wallets) {
      try {
        console.log(`\n📝 Checking wallet ${wallet._id}...`);
        
        // Decrypt the private key
        const encryptionKey = process.env.WALLET_ENCRYPTION_KEY;
        const decryptedPrivateKey = wallet.decryptPrivateKey(encryptionKey);
        
        console.log(`Private key starts with: ${decryptedPrivateKey.substring(0, 2)}`);
        console.log(`Private key length: ${decryptedPrivateKey.length}`);
        
        // Try to parse with current network
        let needsFix = false;
        let correctWIF = decryptedPrivateKey;
        
        try {
          ECPair.fromWIF(decryptedPrivateKey, currentNetwork);
          console.log('✅ Private key works with current network');
        } catch (networkError) {
          console.log('❌ Private key has network mismatch');
          needsFix = true;
          
          // Try opposite network
          const oppositeNetwork = currentNetwork === bitcoin.networks.bitcoin 
            ? bitcoin.networks.testnet 
            : bitcoin.networks.bitcoin;
          
          try {
            const tempKeyPair = ECPair.fromWIF(decryptedPrivateKey, oppositeNetwork);
            
            // For problematic keys, try getting the raw private key and recreating WIF
            const rawPrivateKey = tempKeyPair.privateKey;
            const newKeyPair = ECPair.fromPrivateKey(rawPrivateKey, { network: currentNetwork });
            correctWIF = newKeyPair.toWIF();
            
            console.log(`🔄 Converted WIF from ${oppositeNetwork === bitcoin.networks.bitcoin ? 'mainnet' : 'testnet'} to ${currentNetwork === bitcoin.networks.bitcoin ? 'mainnet' : 'testnet'}`);
            console.log(`Old WIF: ${decryptedPrivateKey.substring(0, 5)}...`);
            console.log(`New WIF: ${correctWIF.substring(0, 5)}...`);
            
            // Verify the conversion worked
            ECPair.fromWIF(correctWIF, currentNetwork);
            console.log('✅ Conversion successful');
          } catch (conversionError) {
            console.log(`❌ Conversion failed: ${conversionError.message}`);
            
            // Last resort: try treating as hex private key
            try {
              if (decryptedPrivateKey.length === 64) {
                console.log('🔄 Trying as hex private key...');
                const privateKeyBuffer = Buffer.from(decryptedPrivateKey, 'hex');
                const hexKeyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network: currentNetwork });
                correctWIF = hexKeyPair.toWIF();
                
                // Verify
                ECPair.fromWIF(correctWIF, currentNetwork);
                console.log('✅ Hex conversion successful');
              } else {
                throw new Error('Not a valid hex key length');
              }
            } catch (hexError) {
              console.log(`❌ Hex conversion also failed: ${hexError.message}`);
              errorCount++;
              continue;
            }
          }
        }
        
        if (needsFix) {
          // Update the wallet with the correct private key
          wallet.encryptPrivateKey(correctWIF, encryptionKey);
          await wallet.save();
          
          console.log(`✅ Fixed wallet ${wallet._id}`);
          fixedCount++;
        }
        
      } catch (error) {
        console.log(`❌ Error processing wallet ${wallet._id}: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log('\n🎉 Migration completed!');
    console.log(`📊 Results:`);
    console.log(`  - Total wallets: ${wallets.length}`);
    console.log(`  - Fixed: ${fixedCount}`);
    console.log(`  - Errors: ${errorCount}`);
    console.log(`  - Already correct: ${wallets.length - fixedCount - errorCount}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  fixWalletNetworkMismatch();
}

module.exports = fixWalletNetworkMismatch; 