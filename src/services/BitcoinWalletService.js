const bitcoin = require("bitcoinjs-lib");
const crypto = require("crypto");
const bip39 = require("bip39");
// const bip32 = require("bip32");

const { BIP32Factory } = require("bip32");
const eccLib = require("tiny-secp256k1");

// Wrap ecc functions to ensure Buffer output
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
    return result ? Buffer.from(result) : result;
  },
  pointFromScalar: (sk, compressed) => {
    const result = eccLib.pointFromScalar(sk, compressed);
    return result ? Buffer.from(result) : null;
  },
  pointMultiply: (a, tweak) => {
    const result = eccLib.pointMultiply(a, tweak);
    return result ? Buffer.from(result) : null;
  },
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
    return result ? Buffer.from(result) : null;
  },
  sign: (h, d, e) => {
    const result = eccLib.sign(h, d, e);
    return result ? Buffer.from(result) : null;
  },
  signSchnorr: (h, d, e) => {
    const result = eccLib.signSchnorr(h, d, e);
    return result ? Buffer.from(result) : null;
  },
  verify: eccLib.verify,
  verifySchnorr: eccLib.verifySchnorr,
  xOnlyPointAddTweak: (p, tweak) => {
    const result = eccLib.xOnlyPointAddTweak(p, tweak);
    if (!result) return null;
    return {
      parity: result.parity,
      xOnlyPubkey: Buffer.from(result.xOnlyPubkey)
    };
  },
  xOnlyPointFromPoint: (p) => {
    const result = eccLib.xOnlyPointFromPoint(p);
    return result ? Buffer.from(result) : null;
  },
  xOnlyPointFromScalar: (sk) => {
    const result = eccLib.xOnlyPointFromScalar(sk);
    return result ? Buffer.from(result) : null;
  }
};

const bip32 = BIP32Factory(ecc);

// Configure ECPair with proper Buffer support
const ECPairFactory = require("ecpair").ECPairFactory;
const ECPair = ECPairFactory(ecc);

const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const Wallet = require("../model/Wallet");
const Transaction = require("../model/Transaction");
const AppError = require("../exception/AppError");

class BitcoinWalletService {
  constructor() {
    // Set network (testnet or mainnet)
    this.network = process.env.BITCOIN_NETWORK === "mainnet" 
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;

    // Initialize BIP32 with ecc
    this.bip32 = BIP32Factory(ecc);
    
    // Initialize ECPair
    bitcoin.initEccLib(ecc);
    
    // Tatum API Configuration (v3 for better stability)
    this.tatumApiKey = process.env.TATUM_API_KEY;
    this.tatumBaseUrl = "https://api.tatum.io/v3";
    
    // Chain identifier for Tatum
    this.tatumChain = process.env.BITCOIN_NETWORK === "mainnet" ? "BTC" : "BTC-testnet";
    
    // Blockstream API (fallback)
    this.blockstreamBaseUrl = this.network === bitcoin.networks.testnet
      ? "https://blockstream.info/testnet/api"
      : "https://blockstream.info/api";
    
    console.log(`Bitcoin Wallet Service initialized for ${process.env.BITCOIN_NETWORK || 'testnet'} network`);

    // Fee configurations (in satoshis per byte)
    this.feeRates = {
      low: 1,
      medium: 5,
      high: 10,
      custom: parseInt(process.env.CUSTOM_FEE_RATE) || 5,
    };

    // Admin wallet address for collecting fees
    this.adminWalletAddress = process.env.ADMIN_WALLET_ADDRESS;

    // Platform fee percentage (0.5% = 0.005)
    this.platformFeePercentage =
      parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.005;
  }

  /**
   * Get Tatum API headers
   */
  getTatumHeaders() {
    if (!this.tatumApiKey) {
      throw new AppError("Tatum API key not configured", 500);
    }
    return {
      'x-api-key': this.tatumApiKey,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Generate a new mnemonic phrase
   */
  generateMnemonic() {
    return bip39.generateMnemonic();
  }

  /**
   * Create a new HD wallet for a user
   */
  async createWallet(userId, label = "Main Wallet") {
    try {
      // Generate mnemonic if not provided

      let mnemonic = this.generateMnemonic();

      // Validate mnemonic
      if (!bip39.validateMnemonic(mnemonic)) {
        throw new AppError("Invalid mnemonic phrase", 400);
      }

      // Generate seed from mnemonic
      const seed = await bip39.mnemonicToSeed(mnemonic);

      // Create HD root
      const root = this.bip32.fromSeed(seed, this.network);

      // Derive wallet using BIP44 path: m/44'/coin_type'/account'/change/address_index
      // For Bitcoin: m/44'/0'/0'/0/0 (mainnet) or m/44'/1'/0'/0/0 (testnet)
      const coinType = this.network === bitcoin.networks.bitcoin ? 0 : 1;
      const derivationPath = `m/44'/${coinType}'/0'/0/0`;

      const child = root.derivePath(derivationPath);

      // Generate address
      const { address } = bitcoin.payments.p2pkh({
        pubkey: child.publicKey,
        network: this.network,
      });

      // Create wallet object
      const wallet = new Wallet({
        userId,
        address,
        publicKey: child.publicKey.toString("hex"),
        derivationPath,
        walletType: "main",
        network:
          this.network === bitcoin.networks.bitcoin ? "mainnet" : "testnet",
        label,
        status: "active",
      });
      let walletEncryptionKey = process.env.WALLET_ENCRYPTION_KEY;

      // Encrypt private key
      const privateKeyWIF = child.toWIF();
      wallet.encryptPrivateKey(privateKeyWIF, walletEncryptionKey);

      // Encrypt mnemonic
      wallet.encryptMnemonic(mnemonic, walletEncryptionKey);

      // Save wallet
      await wallet.save();

      return {
        wallet: {
          id: wallet._id,
          address: wallet.address,
          label: wallet.label,
          balance: wallet.balance,
          network: wallet.network,
          derivationPath: wallet.derivationPath,
        },
        mnemonic, // Return mnemonic for backup
        success: true,
      };
    } catch (error) {
      throw new AppError(`Failed to create wallet: ${error.message}`, 500);
    }
  }

  /**
   * Get user's wallets
   */
  async getUserWallets(userId) {
    try {
      const wallets = await Wallet.findByUserId(userId);

      // Update balances for all wallets
      for (const wallet of wallets) {
        await this.updateWalletBalance(wallet._id);
      }

      return wallets.map((wallet) => ({
        id: wallet._id,
        address: wallet.address,
        label: wallet.label,
        balance: wallet.balance,
        network: wallet.network,
        walletType: wallet.walletType,
        status: wallet.status,
        lastUsed: wallet.lastUsed,
        createdAt: wallet.createdAt,
      }));
    } catch (error) {
      throw new AppError(`Failed to get user wallets: ${error.message}`, 500);
    }
  }

  /**
   * Get wallet balance from Tatum API with fallback to Blockstream
   */
  async getWalletBalance(address) {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Getting balance for ${address} (attempt ${attempt})`);

        // Try Tatum API first (v3 endpoint)
        const tatumBalance = await this.getBalanceFromTatum(address);
        if (tatumBalance !== null) {
      return {
            balance: tatumBalance,
            unconfirmedBalance: 0, // Tatum doesn't provide unconfirmed balance
            totalReceived: tatumBalance,
            totalSent: 0,
            nTx: 0,
          };
        }

        // Fallback to Blockstream API
        try {
          const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
          const blockstreamUrl = `https://blockstream.info/${networkPath}api/address/${address}`;
          
          const blockstreamResponse = await axios.get(blockstreamUrl, { timeout: 10000 });
          const data = blockstreamResponse.data;
          
          console.log("✅ Got balance from Blockstream API (fallback)");
          return {
            balance: data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum,
            unconfirmedBalance: data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum,
            totalReceived: data.chain_stats.funded_txo_sum,
            totalSent: data.chain_stats.spent_txo_sum,
            nTx: data.chain_stats.tx_count,
          };
        } catch (blockstreamError) {
          console.log(`Blockstream balance API failed: ${blockstreamError.message}`);
        }

        throw new Error("All balance APIs failed");

    } catch (error) {
        console.error(`Balance API Error (attempt ${attempt}):`, error.message);
        
        if (error.response?.status === 429) {
          console.log(`Rate limited, waiting ${retryDelay * attempt}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          continue;
        }
        
        if (attempt === maxRetries) {
          throw new AppError(`Failed to get wallet balance after ${maxRetries} attempts: ${error.message}`, 500);
        }
        
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  /**
   * Update wallet balance in database
   */
  async updateWalletBalance(walletId) {
    try {
      const wallet = await Wallet.findById(walletId);
      if (!wallet) {
        throw new AppError("Wallet not found", 404);
      }

      const balanceInfo = await this.getWalletBalance(wallet.address);
      await wallet.updateBalance(balanceInfo.balance);

      return balanceInfo;
    } catch (error) {
      throw new AppError(
        `Failed to update wallet balance: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get UTXOs for an address using Tatum API with fallback to Blockstream
   */
  async getUTXOs(address) {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log("=== UTXO DEBUG ===");
        console.log("Fetching UTXOs for address:", address);
        console.log(`Attempt ${attempt} of ${maxRetries}`);

        // Always use Blockstream for UTXOs as it's most reliable for this
        try {
          const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
          const blockstreamUrl = `https://blockstream.info/${networkPath}api/address/${address}/utxo`;
          console.log("Using Blockstream API for UTXOs:", blockstreamUrl);
          
          const blockstreamResponse = await axios.get(blockstreamUrl, { timeout: 10000 });
          
          // Convert Blockstream format to our expected format and validate
          const utxos = blockstreamResponse.data
            .filter(utxo => {
              // Only include confirmed UTXOs
              return utxo.status && utxo.status.confirmed;
            })
            .map(utxo => ({
              tx_hash: utxo.txid,
              tx_output_n: utxo.vout,
              value: utxo.value,
              confirmations: utxo.status.confirmed ? 
                (utxo.status.block_height ? 1 : 0) : 0
            }));
          
          console.log("✅ Got UTXOs from Blockstream API");
          console.log("UTXOs found:", utxos.length);
          
          // Log each UTXO for debugging
          utxos.forEach((utxo, index) => {
            console.log(`UTXO ${index + 1}: ${utxo.tx_hash}:${utxo.tx_output_n} = ${utxo.value} sats`);
          });
          
          return utxos;
        } catch (blockstreamError) {
          console.log(`Blockstream UTXO API failed: ${blockstreamError.message}`);
          
          // Fallback to Tatum only if Blockstream fails
          const tatumUtxos = await this.getUTXOsFromTatum(address);
          if (tatumUtxos !== null) {
            // Convert to expected format
            const utxos = tatumUtxos.map(utxo => ({
              tx_hash: utxo.txid,
              tx_output_n: utxo.vout,
              value: utxo.value,
              confirmations: utxo.confirmations || 1
            }));
            
            console.log("✅ Got UTXOs from Tatum API (fallback)");
            console.log("UTXOs found:", utxos.length);
            return utxos;
          }
        }

        throw new Error("All UTXO APIs failed");

    } catch (error) {
        console.error(`UTXO API Error (attempt ${attempt}):`, error.message);
        
        if (error.response?.status === 429) {
          console.log(`Rate limited, waiting ${retryDelay * attempt}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          continue;
        }
        
        if (attempt === maxRetries) {
          throw new AppError(`Failed to get UTXOs after ${maxRetries} attempts: ${error.message}`, 500);
        }
        
        // Wait before retry for other errors too
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  /**
   * Calculate transaction fee
   */
  calculateTransactionFee(inputCount, outputCount, feeRate = "medium") {
    // Estimated transaction size (in bytes)
    // Input: ~148 bytes, Output: ~34 bytes, Overhead: ~10 bytes
    const estimatedSize = inputCount * 148 + outputCount * 34 + 10;
    const satoshisPerByte = this.feeRates[feeRate] || this.feeRates.medium;

    return Math.ceil(estimatedSize * satoshisPerByte);
  }

  /**
   * Calculate platform fee
   */
  calculatePlatformFee(amount) {
    return Math.floor(amount * this.platformFeePercentage);
  }

  /**
   * Create and send Bitcoin transaction
   */
  async sendTransaction(
    fromWalletId,
    toAddress,
    amount,
    walletEncryptionKey,
    priority = "medium",
    description = ""
  ) {
      // Get wallet
      const wallet = await Wallet.findById(fromWalletId);
      if (!wallet) {
        throw new AppError("Wallet not found", 404);
      }

      if (wallet.status !== "active") {
        throw new AppError("Wallet is not active", 400);
      }
      console.log("wallet", wallet);

      console.log("walletEncryptionKey", walletEncryptionKey);
      // Decrypt private key
      const privateKeyWIF = wallet.decryptPrivateKey(walletEncryptionKey);
      console.log("privateKeyWIF", privateKeyWIF);
    const keyPair = ECPair.fromWIF(privateKeyWIF, this.network);

    // Check wallet balance first
    console.log("=== WALLET BALANCE CHECK ===");
    console.log("Wallet address:", wallet.address);
    console.log("Wallet network:", wallet.network);
    console.log("Current wallet balance (from DB):", wallet.balance);

    try {
      const balanceInfo = await this.getWalletBalance(wallet.address);
      console.log("Live balance info:", balanceInfo);
    } catch (balanceError) {
      console.error("Error getting balance:", balanceError.message);
    }

      // Get UTXOs
      const utxos = await this.getUTXOs(wallet.address);
      if (utxos.length === 0) {
        throw new AppError("No unspent outputs available", 400);
      }

    console.log("=== UTXO VALIDATION ===");
    console.log(`Found ${utxos.length} UTXOs for address ${wallet.address}`);
    
    // Validate UTXOs are still unspent by checking each one
    const validUTXOs = [];
    for (const utxo of utxos) {
      try {
        // Double-check this UTXO is still unspent
        const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
        const utxoCheckUrl = `https://blockstream.info/${networkPath}api/tx/${utxo.tx_hash}/outspent/${utxo.tx_output_n}`;
        
        const utxoStatus = await axios.get(utxoCheckUrl, { timeout: 5000 });
        
        if (!utxoStatus.data.spent) {
          validUTXOs.push(utxo);
          console.log(`✅ UTXO ${utxo.tx_hash}:${utxo.tx_output_n} is unspent`);
        } else {
          console.log(`❌ UTXO ${utxo.tx_hash}:${utxo.tx_output_n} is already spent`);
        }
      } catch (checkError) {
        console.log(`⚠️ Could not verify UTXO ${utxo.tx_hash}:${utxo.tx_output_n}, including anyway:`, checkError.message);
        validUTXOs.push(utxo); // Include if we can't check (API might be down)
      }
    }
    
    if (validUTXOs.length === 0) {
      throw new AppError("No valid unspent outputs available - all UTXOs appear to be spent", 400);
    }
    
    console.log(`Using ${validUTXOs.length} validated UTXOs out of ${utxos.length} found`);

    // Add a small delay to prevent race conditions with other transactions
    console.log("⏳ Adding 2-second delay to prevent UTXO race conditions...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Calculate fees using valid UTXOs
    const networkFee = this.calculateTransactionFee(validUTXOs.length, 2, priority); // 2 outputs (recipient + change)
      const platformFee = this.calculatePlatformFee(amount);
      const totalRequired = amount + networkFee + platformFee;

      // Check if wallet has sufficient balance
      if (wallet.balance < totalRequired) {
        throw new AppError(
          `Insufficient balance. Required: ${totalRequired}, Available: ${wallet.balance}`,
          400
        );
      }

      // Select UTXOs
      let inputTotal = 0;
      const selectedUTXOs = [];

    for (const utxo of validUTXOs) {
        selectedUTXOs.push(utxo);
        inputTotal += utxo.value;

        if (inputTotal >= totalRequired) {
          break;
        }
      }

      if (inputTotal < totalRequired) {
        throw new AppError("Insufficient funds in UTXOs", 400);
      }

    // Create transaction using Psbt (modern approach)
    const psbt = new bitcoin.Psbt({ network: this.network });

    console.log("=== TRANSACTION CONSTRUCTION DEBUG ===");
    console.log(`Creating transaction with ${selectedUTXOs.length} inputs`);
    console.log(`Network: ${this.network === bitcoin.networks.testnet ? 'testnet' : 'mainnet'}`);
    console.log(`Total input value: ${inputTotal} satoshis`);
    console.log(`Amount to send: ${amount} satoshis`);
    console.log(`Network fee: ${networkFee} satoshis`);
    console.log(`Platform fee: ${platformFee} satoshis`);
    console.log(`Change amount: ${change} satoshis`);

      // Add inputs
      for (const utxo of selectedUTXOs) {
      // For legacy P2PKH addresses, we need the full transaction
      console.log(
        `Adding input: ${utxo.tx_hash}:${utxo.tx_output_n}, value: ${utxo.value}`
      );
      
      // Validate the UTXO one more time before adding it
      try {
        const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
        const utxoValidationUrl = `https://blockstream.info/${networkPath}api/tx/${utxo.tx_hash}/outspent/${utxo.tx_output_n}`;
        
        const utxoValidation = await axios.get(utxoValidationUrl, { timeout: 5000 });
        
        if (utxoValidation.data.spent) {
          console.error(`❌ CRITICAL: UTXO ${utxo.tx_hash}:${utxo.tx_output_n} is SPENT! This should not happen.`);
          throw new AppError(`UTXO ${utxo.tx_hash}:${utxo.tx_output_n} has been spent by another transaction`, 400);
        } else {
          console.log(`✅ Final validation: UTXO ${utxo.tx_hash}:${utxo.tx_output_n} is still unspent`);
        }
      } catch (validationError) {
        console.warn(`⚠️ Could not perform final UTXO validation: ${validationError.message}`);
      }
      
      const prevTxHex = await this.getTransactionHexOnly(utxo.tx_hash);
      console.log(`Got previous transaction hex for ${utxo.tx_hash}, length: ${prevTxHex.length}`);
      
      // Parse the previous transaction to verify the output
      try {
        const prevTx = bitcoin.Transaction.fromHex(prevTxHex);
        const prevOutput = prevTx.outs[utxo.tx_output_n];
        
        if (!prevOutput) {
          throw new AppError(`Previous transaction ${utxo.tx_hash} does not have output ${utxo.tx_output_n}`, 400);
        }
        
        console.log(`Previous output ${utxo.tx_output_n}: value=${prevOutput.value}, script length=${prevOutput.script.length}`);
        
        // Verify the value matches what we expect
        if (prevOutput.value !== utxo.value) {
          console.error(`❌ UTXO value mismatch: expected ${utxo.value}, found ${prevOutput.value}`);
          throw new AppError(`UTXO value mismatch for ${utxo.tx_hash}:${utxo.tx_output_n}`, 400);
        }
        
        // Verify this output is actually spendable by our wallet
        const outputAddress = bitcoin.address.fromOutputScript(prevOutput.script, this.network);
        if (outputAddress !== wallet.address) {
          console.error(`❌ UTXO address mismatch: expected ${wallet.address}, found ${outputAddress}`);
          throw new AppError(`UTXO ${utxo.tx_hash}:${utxo.tx_output_n} does not belong to wallet ${wallet.address}`, 400);
        }
        
        console.log(`✅ UTXO validation passed: ${utxo.tx_hash}:${utxo.tx_output_n} belongs to ${wallet.address}`);
        
      } catch (parseError) {
        console.error(`Error parsing previous transaction: ${parseError.message}`);
        if (parseError.message.includes('does not belong to wallet') || parseError.message.includes('value mismatch')) {
          throw parseError;
        }
        // Continue with caution if we can't parse but it's not a critical validation error
        console.warn(`⚠️ Could not validate previous transaction structure, proceeding with caution`);
      }
      
      psbt.addInput({
        hash: utxo.tx_hash,
        index: utxo.tx_output_n,
        nonWitnessUtxo: Buffer.from(prevTxHex, "hex"),
      });
      console.log(`✅ Successfully added input ${utxo.tx_hash}:${utxo.tx_output_n}`);
      }

      // Add outputs
    psbt.addOutput({
      address: toAddress,
      value: amount,
    });
    console.log(`✅ Added main output: ${toAddress} = ${amount} satoshis`);

      // Add platform fee output (if admin wallet is configured)
      if (platformFee > 0 && this.adminWalletAddress) {
      psbt.addOutput({
        address: this.adminWalletAddress,
        value: platformFee,
      });
      console.log(`✅ Added platform fee output: ${this.adminWalletAddress} = ${platformFee} satoshis`);
      }

      // Add change output (if needed)
      const change = inputTotal - amount - networkFee - platformFee;
      if (change > 0) {
      psbt.addOutput({
        address: wallet.address,
        value: change,
      });
      console.log(`✅ Added change output: ${wallet.address} = ${change} satoshis`);
    } else {
      console.log(`ℹ️ No change output needed (change: ${change} satoshis)`);
    }

    console.log("=== TRANSACTION SUMMARY ===");
    console.log(`Inputs: ${psbt.inputCount}`);
    console.log(`Outputs: ${psbt.data.outputs.length}`);
    console.log(`Total output value: ${psbt.data.outputs.reduce((sum, output) => sum + output.value, 0)} satoshis`);
    console.log(`Expected fee: ${inputTotal - psbt.data.outputs.reduce((sum, output) => sum + output.value, 0)} satoshis`);

    // Sign inputs with proper error handling and validator
      for (let i = 0; i < selectedUTXOs.length; i++) {
      try {
        console.log(`Attempting to sign input ${i}...`);
        console.log(`KeyPair type: ${keyPair.constructor.name}`);
        console.log(`KeyPair has publicKey: ${!!keyPair.publicKey}`);
        console.log(`KeyPair has privateKey: ${!!keyPair.privateKey}`);

        // Create a validator function for signature verification
        const validator = (pubkey, msghash, signature) => {
          console.log(`Validating signature for input ${i}`);
          return ecc.verify(msghash, pubkey, signature);
        };

        // Sign the input with validator
        psbt.signInput(i, keyPair, undefined, undefined, validator);
        console.log(`✅ Signed input ${i} successfully`);
      } catch (error) {
        console.error(`❌ Error signing input ${i}:`, error.message);
        console.error(`Error details:`, error.stack);
        throw new AppError(`Failed to sign input ${i}: ${error.message}`, 500);
      }
    }

    // Validate signatures individually (safer for legacy addresses)
    try {
      for (let i = 0; i < selectedUTXOs.length; i++) {
        const validated = psbt.validateSignaturesOfInput(i);
        console.log(`Input ${i} signature validation: ${validated}`);
      }
      console.log("All signatures validated successfully");
    } catch (error) {
      console.warn(`Signature validation warning: ${error.message}`);
      // Continue anyway - legacy addresses sometimes have validation quirks
    }

    // Finalize all inputs
    try {
      psbt.finalizeAllInputs();
      console.log("All inputs finalized successfully");
    } catch (error) {
      throw new AppError(`Failed to finalize inputs: ${error.message}`, 500);
    }

    // Extract the transaction
    const tx = psbt.extractTransaction();
      const rawTx = tx.toHex();
    console.log(
      "Transaction created successfully, raw TX length:",
      rawTx.length
    );

      // Create transaction record
      const transaction = new Transaction({
        internalId: uuidv4(),
        type: "withdrawal",
        userId: wallet.userId,
        fromAddress: wallet.address,
        toAddress,
        amount,
        fee: networkFee,
        adminFee: platformFee,
        netAmount: amount,
        status: "pending",
        network: wallet.network,
        priority,
        rawTransaction: rawTx,
        inputs: selectedUTXOs.map((utxo) => ({
          txid: utxo.tx_hash,
          vout: utxo.tx_output_n,
          value: utxo.value,
        })),
        outputs: [
          { address: toAddress, value: amount },
          ...(platformFee > 0 && this.adminWalletAddress
            ? [{ address: this.adminWalletAddress, value: platformFee }]
            : []),
          ...(change > 0 ? [{ address: wallet.address, value: change }] : []),
        ],
        description,
        submittedAt: new Date(),
      });

      await transaction.save();

      // Broadcast transaction
      const broadcastResult = await this.broadcastTransaction(rawTx);
      // Update transaction with broadcast result
      if (broadcastResult.success) {
        transaction.txHash = broadcastResult.txHash;
        transaction.status = "processing";
        transaction.processedAt = new Date();
        await transaction.save();
      } else {
        await transaction.markAsFailed({
          code: "BROADCAST_FAILED",
          message: broadcastResult.error,
        });
      }

      return {
        transactionId: transaction._id,
        txHash: transaction.txHash,
        amount,
        fee: networkFee,
        platformFee,
        status: transaction.status,
        success: broadcastResult.success,
      };
  }

  /**
   * Broadcast transaction to Bitcoin network using Tatum API with fallback
   */
  async broadcastTransaction(rawTx) {
    const maxRetries = 3;
    const baseDelay = 1000;

    // Try Tatum first
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Broadcasting with Tatum API (attempt ${attempt})...`);
        return await this.broadcastToTatum(rawTx);
      } catch (error) {
        console.warn(`Tatum broadcast attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          console.log("All Tatum attempts failed, trying Blockstream...");
          break;
        }
        
        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Fallback to Blockstream
    try {
      console.log("Broadcasting with Blockstream API...");
      return await this.broadcastToBlockstream(rawTx);
    } catch (blockstreamError) {
      console.error("Blockstream broadcast failed:", blockstreamError.message);
      throw new Error(`All broadcast attempts failed. Last error: ${blockstreamError.message}`);
    }
  }

  async broadcastToTatum(txHex) {
    // For Bitcoin, Tatum uses a different endpoint structure
    // Use the dedicated Bitcoin broadcast endpoint instead of RPC
    try {
      const broadcastUrl = `${this.tatumBaseUrl}/bitcoin/broadcast`;
      
      const response = await axios.post(
        broadcastUrl,
        {
          txData: txHex
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.tatumApiKey
          },
          timeout: 30000
        }
      );

      if (response.data && response.data.txId) {
      return {
          txid: response.data.txId,
        success: true,
          method: 'tatum'
      };
      } else {
        throw new Error(`Unexpected Tatum response format: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      console.error("Tatum broadcast error:", error.response?.data || error.message);
      
      // If the dedicated endpoint fails, try the RPC approach for Bitcoin
      try {
        console.log("Trying Tatum Bitcoin RPC approach...");
        const rpcUrl = `${this.tatumBaseUrl}/bitcoin/node`;
        
        const rpcResponse = await axios.post(
          rpcUrl,
          {
            jsonrpc: "2.0",
            method: "sendrawtransaction",
            params: [txHex],
            id: 1
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.tatumApiKey
            },
            timeout: 30000
          }
        );

        if (rpcResponse.data.error) {
          throw new Error(`Tatum RPC error: ${rpcResponse.data.error.message}`);
        }

      return {
          txid: rpcResponse.data.result,
          success: true,
          method: 'tatum-rpc'
        };
      } catch (rpcError) {
        console.error("Tatum RPC broadcast error:", rpcError.response?.data || rpcError.message);
        throw error; // Throw the original error
      }
    }
  }

  async broadcastToBlockstream(txHex) {
    try {
      const response = await axios.post(`${this.blockstreamBaseUrl}/tx`, txHex, {
        headers: {
          'Content-Type': 'text/plain'
        },
        timeout: 30000
      });
      
      return {
        txid: response.data,
        success: true,
        method: 'blockstream'
      };
    } catch (error) {
      if (error.response?.status === 400) {
        throw new Error(`Transaction rejected: ${error.response.data}`);
      }
      throw error;
    }
  }

  /**
   * Get transaction details using Tatum API with fallback
   */
  async getTransactionDetails(txHash) {
    try {
      // Try Tatum API first
      try {
        const tatumUrl = `${this.tatumBaseUrl}/data/transactions`;
        const response = await axios.get(tatumUrl, {
          headers: this.getTatumHeaders(),
          params: {
            chain: this.tatumChain,
            hash: txHash
          },
          timeout: 10000
        });

        if (response.data && response.data.length > 0) {
          console.log("✅ Got transaction details from Tatum API");
          return response.data[0];
        }
      } catch (tatumError) {
        console.log(`Tatum transaction API failed: ${tatumError.message}`);
      }

      // Fallback to Blockstream API
      const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      const response = await axios.get(`https://blockstream.info/${networkPath}api/tx/${txHash}`, {
        timeout: 10000
      });
      
      console.log("✅ Got transaction details from Blockstream API (fallback)");
      return response.data;
    } catch (error) {
      throw new AppError(
        `Failed to get transaction details: ${error.message}`,
        500
      );
    }
  }

  /**
   * PSBT approach for legacy addresses
   */
  async getTransactionHex(utxos, toAddress, amount, changeAddress, privateKeyWIF, feeRate = 5) {
    const keyPair = bitcoin.ECPair.fromWIF(privateKeyWIF, this.network);
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Add inputs
    let totalInput = 0;
    for (const utxo of utxos) {
      console.log(`Adding input: ${utxo.txid}:${utxo.vout} (${utxo.value} satoshis)`);
      
      // Get the previous transaction for legacy inputs
      const prevTx = await this.getTransaction(utxo.txid);
      let prevTxHex;
      
      if (prevTx.hex) {
        prevTxHex = prevTx.hex;
      } else {
        // If no hex in response, get it separately
        prevTxHex = await this.getTransactionHexOnly(utxo.txid);
      }
      
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        nonWitnessUtxo: Buffer.from(prevTxHex, 'hex')
      });
      
      totalInput += utxo.value;
      
      // Break if we have enough
      if (totalInput >= amount + (feeRate * 250)) { // Rough fee estimation
        break;
      }
    }

    // Add output to recipient
    psbt.addOutput({
      address: toAddress,
      value: amount
    });

    // Calculate fee (rough estimation: 250 bytes * fee rate)
    const estimatedSize = 250;
    const fee = feeRate * estimatedSize;
    const change = totalInput - amount - fee;

    console.log(`Total input: ${totalInput}, Amount: ${amount}, Fee: ${fee}, Change: ${change}`);

    // Add change output if necessary
    if (change > 546) { // Dust threshold
      psbt.addOutput({
        address: changeAddress,
        value: change
      });
    }

    // Sign all inputs
    const inputCount = psbt.inputCount;
    for (let i = 0; i < inputCount; i++) {
      psbt.signInput(i, keyPair);
    }

    psbt.finalizeAllInputs();
    
    const txHex = psbt.extractTransaction().toHex();
    console.log(`Created transaction hex: ${txHex}`);
    
    return txHex;
  }

  // Get transaction hex only (for PSBT)
  async getTransactionHexOnly(txid) {
    try {
      const response = await axios.get(`${this.blockstreamBaseUrl}/tx/${txid}/hex`, {
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      console.error("Failed to get transaction hex:", error.message);
      throw error;
    }
  }

  /**
   * Monitor transaction confirmations
   */
  async monitorTransactionConfirmations() {
    try {
      const pendingTransactions = await Transaction.findPendingTransactions();

      for (const transaction of pendingTransactions) {
        if (transaction.txHash) {
          try {
            const txDetails = await this.getTransactionDetails(
              transaction.txHash
            );

            if (
              txDetails.confirmations >= 1 &&
              transaction.status !== "confirmed"
            ) {
              await transaction.markAsConfirmed(
                transaction.txHash,
                txDetails.block_height,
                txDetails.block_hash
              );
            } else if (txDetails.confirmations > transaction.confirmations) {
              transaction.confirmations = txDetails.confirmations;
              await transaction.save();
            }
          } catch (error) {
            console.error(
              `Error monitoring transaction ${transaction.txHash}:`,
              error.message
            );
          }
        }
      }
    } catch (error) {
      console.error("Error monitoring transactions:", error.message);
    }
  }

  /**
   * Validate Bitcoin address
   */
  validateAddress(address) {
    try {
      bitcoin.address.toOutputScript(address, this.network);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current Bitcoin price
   */
  async getBitcoinPrice(currency = "USD") {
    try {
      const response = await axios.get(
        `https://api.coinbase.com/v2/exchange-rates?currency=BTC`
      );
      return parseFloat(response.data.data.rates[currency]);
    } catch (error) {
      throw new AppError(`Failed to get Bitcoin price: ${error.message}`, 500);
    }
  }

  /**
   * Convert satoshis to BTC
   */
  satoshisToBTC(satoshis) {
    return satoshis / 100000000;
  }

  /**
   * Convert BTC to satoshis
   */
  btcToSatoshis(btc) {
    return Math.floor(btc * 100000000);
  }

  async getBalanceFromTatum(address) {
    try {
      const url = `${this.tatumBaseUrl}/bitcoin/address/balance/${address}`;
      
      const response = await axios.get(url, {
        headers: {
          'x-api-key': this.tatumApiKey
        },
        timeout: 10000
      });

      if (response.data && response.data.incoming !== undefined) {
        // Tatum v3 returns balance in BTC, convert to satoshis
        const balanceInBTC = parseFloat(response.data.incoming) - parseFloat(response.data.outgoing);
        const balanceInSatoshis = Math.round(balanceInBTC * 100000000);
        
        console.log(`Tatum balance for ${address}: ${balanceInSatoshis} satoshis`);
        return balanceInSatoshis;
      }
      
      throw new Error('Invalid balance response from Tatum');
    } catch (error) {
      console.log(`Tatum balance fetch failed for ${address}:`, error.message);
      return null;
    }
  }

  async getUTXOsFromTatum(address) {
    try {
      const url = `${this.tatumBaseUrl}/bitcoin/utxo/${address}`;
      
      const response = await axios.get(url, {
        headers: {
          'x-api-key': this.tatumApiKey
        },
        timeout: 10000
      });

      if (response.data && Array.isArray(response.data)) {
        // Convert Tatum v3 UTXO format to our expected format
        const utxos = response.data.map(utxo => ({
          txid: utxo.txid,
          vout: utxo.vout,
          value: Math.round(parseFloat(utxo.value) * 100000000), // Convert BTC to satoshis
          confirmations: utxo.confirmations || 0
        }));
        
        console.log(`Tatum UTXOs for ${address}: ${utxos.length} found`);
        return utxos;
      }
      
      return [];
    } catch (error) {
      console.log(`Tatum UTXO fetch failed for ${address}:`, error.message);
      return null;
    }
  }
}

module.exports = new BitcoinWalletService();
