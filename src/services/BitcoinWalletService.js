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
    // Use testnet for development, mainnet for production
    this.network =
      process.env.BITCOIN_NETWORK === "mainnet"
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;

    // QuickNode endpoints configuration
    this.rpcConfig = {
      testnet: {
        endpoint: process.env.QUICKNODE_BITCOIN_TESTNET_ENDPOINT || "https://your-testnet-endpoint.btc-testnet.quiknode.pro/YOUR_API_KEY/",
      },
      mainnet: {
        endpoint: process.env.QUICKNODE_BITCOIN_MAINNET_ENDPOINT || "https://your-mainnet-endpoint.btc.quiknode.pro/YOUR_API_KEY/",
      },
    };

    this.currentEndpoint =
      this.network === bitcoin.networks.bitcoin
        ? this.rpcConfig.mainnet.endpoint
        : this.rpcConfig.testnet.endpoint;

    // Fee configurations (in satoshis per byte)
    this.feeRates = {
      low: 5,
      medium: 15,
      high: 30,
      custom: parseInt(process.env.CUSTOM_FEE_RATE) || 5,
    };

    // Admin wallet address for collecting fees
    this.adminWalletAddress = process.env.ADMIN_WALLET_ADDRESS;

    // Platform fee percentage (0.5% = 0.005)
    this.platformFeePercentage =
      parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.005;
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
      const root = bip32.fromSeed(seed, this.network);

      // Derive wallet using BIP44 path: m/44'/coin_type'/account'/change/address_index
      // For Bitcoin: m/44'/0'/0'/0/0 (mainnet) or m/44'/1'/0'/0/0 (testnet)
      const coinType = this.network === bitcoin.networks.bitcoin ? 0 : 1;
      const derivationPath = `m/44'/${coinType}'/0'/0/0`;

      const child = root.derivePath(derivationPath);

      // Generate SegWit address (P2WPKH) - starts with 'bc1' for mainnet, 'tb1' for testnet
      const { address } = bitcoin.payments.p2wpkh({
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
   * Get wallet balance from blockchain using blockchain explorer API
   */
  async getWalletBalance(address) {
    try {
      console.log("=== BALANCE CHECK ===");
      console.log("Fetching balance for address:", address);
      console.log("Using blockchain explorer API...");

      // Use blockchain explorer API directly - most reliable for external addresses
      const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      const response = await axios.get(`https://blockstream.info/${networkPath}api/address/${address}`, {
        timeout: 10000
      });

      return {
        balance: response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum,
        unconfirmedBalance: response.data.mempool_stats.funded_txo_sum - response.data.mempool_stats.spent_txo_sum,
        totalReceived: response.data.chain_stats.funded_txo_sum,
        totalSent: response.data.chain_stats.spent_txo_sum,
        nTx: response.data.chain_stats.tx_count,
      };

    } catch (error) {
      console.error("Balance API Error:", error.message);
      throw new AppError(`Failed to get wallet balance: ${error.message}`, 500);
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
   * Get UTXOs for an address using blockchain explorer API
   */
  async getUTXOs(address) {
    try {
      console.log("=== UTXO DEBUG ===");
      console.log("Fetching UTXOs for address:", address);
      console.log("Using blockchain explorer API...");

      // Use blockchain explorer API directly - more reliable for external addresses
      const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      const explorerResponse = await axios.get(
        `https://blockstream.info/${networkPath}api/address/${address}/utxo`,
        { timeout: 10000 }
      );

      console.log("UTXOs found via explorer:", explorerResponse.data.length);
      console.log("UTXO data:", explorerResponse.data);

      // Transform explorer UTXO format to match expected format
      return explorerResponse.data.map(utxo => ({
        tx_hash: utxo.txid,
        tx_output_n: utxo.vout,
        value: utxo.value
      }));

    } catch (error) {
      console.error("UTXO API Error:", error.message);
      console.error("UTXO API Error response:", error.response?.data);
      throw new AppError(`Failed to get UTXOs: ${error.message}`, 500);
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
   * Bitcoin dust threshold - minimum output value to avoid dust rejection
   */
  getDustThreshold() {
    return 546; // Standard dust threshold in satoshis
  }

  /**
   * Check if an amount is considered dust
   */
  isDustAmount(amount) {
    return amount < this.getDustThreshold();
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

    // Calculate fees
    const networkFee = this.calculateTransactionFee(utxos.length, 2, priority); // 2 outputs (recipient + change)
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

    for (const utxo of utxos) {
      selectedUTXOs.push(utxo);
      inputTotal += utxo.value;

      if (inputTotal >= totalRequired) {
        break;
      }
    }

    if (inputTotal < totalRequired) {
      throw new AppError("Insufficient funds in UTXOs", 400);
    }

    // Check for dust amounts and adjust
    const dustThreshold = this.getDustThreshold();
    let adjustedNetworkFee = networkFee;
    let adjustedPlatformFee = platformFee;
    let shouldCreatePlatformFeeOutput = false;
    
    console.log("=== DUST CHECK ===");
    console.log("Platform fee:", platformFee);
    console.log("Dust threshold:", dustThreshold);
    console.log("Platform fee is dust:", this.isDustAmount(platformFee));

    // If platform fee is dust, add it to network fee instead of creating separate output
    if (this.isDustAmount(platformFee)) {
      console.log("Platform fee is dust, adding to network fee");
      adjustedNetworkFee += platformFee;
      adjustedPlatformFee = 0;
      shouldCreatePlatformFeeOutput = false;
    } else if (platformFee > 0 && this.adminWalletAddress) {
      shouldCreatePlatformFeeOutput = true;
    }

    // Calculate change
    const change = inputTotal - amount - adjustedNetworkFee - (shouldCreatePlatformFeeOutput ? platformFee : 0);
    let shouldCreateChangeOutput = false;
    let adjustedChange = change;

    console.log("Change amount:", change);
    console.log("Change is dust:", this.isDustAmount(change));

    // If change is dust, add it to network fee instead of creating change output
    if (this.isDustAmount(change)) {
      console.log("Change is dust, adding to network fee");
      adjustedNetworkFee += change;
      adjustedChange = 0;
      shouldCreateChangeOutput = false;
    } else if (change > 0) {
      shouldCreateChangeOutput = true;
    }

    console.log("=== FINAL AMOUNTS ===");
    console.log("Amount to recipient:", amount);
    console.log("Network fee (adjusted):", adjustedNetworkFee);
    console.log("Platform fee output:", shouldCreatePlatformFeeOutput ? platformFee : 0);
    console.log("Change output:", shouldCreateChangeOutput ? adjustedChange : 0);
    console.log("Should create platform fee output:", shouldCreatePlatformFeeOutput);
    console.log("Should create change output:", shouldCreateChangeOutput);

    // Create transaction using Psbt (modern approach)
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Add inputs
    for (const utxo of selectedUTXOs) {
      console.log(
        `Adding input: ${utxo.tx_hash}:${utxo.tx_output_n}, value: ${utxo.value}`
      );
      
      // For SegWit P2WPKH addresses, we can use witnessUtxo instead of full transaction
      psbt.addInput({
        hash: utxo.tx_hash,
        index: utxo.tx_output_n,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: this.network,
          }).output,
          value: utxo.value,
        },
      });
    }

    // Add outputs
    psbt.addOutput({
      address: toAddress,
      value: amount,
    });

    // Add platform fee output (if admin wallet is configured)
    if (shouldCreatePlatformFeeOutput) {
      psbt.addOutput({
        address: this.adminWalletAddress,
        value: platformFee,
      });
    }

    // Add change output (if needed)
    if (shouldCreateChangeOutput) {
      psbt.addOutput({
        address: wallet.address,
        value: adjustedChange,
      });
    }

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

    // Validate signatures individually (safer for SegWit addresses)
    try {
      for (let i = 0; i < selectedUTXOs.length; i++) {
        const validated = psbt.validateSignaturesOfInput(i);
        console.log(`Input ${i} signature validation: ${validated}`);
      }
      console.log("All signatures validated successfully");
    } catch (error) {
      console.warn(`Signature validation warning: ${error.message}`);
      // Continue anyway - but SegWit should be more reliable than legacy
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
      fee: adjustedNetworkFee,
      adminFee: shouldCreatePlatformFeeOutput ? platformFee : 0,
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
        ...(shouldCreatePlatformFeeOutput ? [{ address: this.adminWalletAddress, value: platformFee }] : []),
        ...(shouldCreateChangeOutput ? [{ address: wallet.address, value: adjustedChange }] : []),
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
      console.log("Broadcast failed:", broadcastResult.error);
      await transaction.markAsFailed({
        code: "BROADCAST_FAILED",
        message: broadcastResult.error,
      });
    }

    return {
      transactionId: transaction._id,
      txHash: transaction.txHash,
      amount,
      fee: adjustedNetworkFee,
      platformFee: shouldCreatePlatformFeeOutput ? platformFee : 0,
      status: transaction.status,
      success: broadcastResult.success,
    };
  }

  /**
   * Broadcast transaction to Bitcoin network using QuickNode RPC
   */
  async broadcastTransaction(rawTx) {
    try {
      const requestData = {
        jsonrpc: "2.0",
        id: 1,
        method: "sendrawtransaction",
        params: [rawTx]
      };

      const response = await axios.post(this.currentEndpoint, requestData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.error) {
        return {
          success: false,
          error: response.data.error.message,
        };
      }

      return {
        success: true,
        txHash: response.data.result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Get transaction details using standard Bitcoin RPC (no add-on required)
   */
  async getTransactionDetails(txHash) {
    try {
      // Try standard Bitcoin RPC first
      const requestData = {
        jsonrpc: "2.0",
        id: 1,
        method: "getrawtransaction",
        params: [txHash, true] // true = return decoded JSON instead of hex
      };

      try {
        const response = await axios.post(this.currentEndpoint, requestData, {
          headers: { 'Content-Type': 'application/json' }
        });

        if (!response.data.error && response.data.result) {
          return response.data.result;
        }
      } catch (rpcError) {
        console.log("Standard RPC failed, falling back to blockchain explorer...");
      }

      // // Fallback to blockchain explorer API
      // const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      // const explorerResponse = await axios.get(
      //   `https://blockstream.info/${networkPath}api/tx/${txHash}`,
      //   { timeout: 10000 }
      // );

      // return explorerResponse.data;

    } catch (error) {
      throw new AppError(
        `Failed to get transaction details: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get raw transaction hex using QuickNode RPC
   */
  async getTransactionHex(txHash) {
    try {
      const requestData = {
        jsonrpc: "2.0",
        id: 1,
        method: "getrawtransaction",
        params: [txHash, false] // false = return hex, true = return decoded
      };

      const response = await axios.post(this.currentEndpoint, requestData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result;
    } catch (error) {
      throw new AppError(
        `Failed to get transaction hex: ${error.message}`,
        500
      );
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

  /**
   * Test QuickNode connection and available methods
   */
  async testConnection() {
    try {
      console.log("=== Connection Test ===");
      console.log("QuickNode endpoint:", this.currentEndpoint);
      console.log("Network:", this.network === bitcoin.networks.bitcoin ? "mainnet" : "testnet");
      console.log("Usage: QuickNode for transaction broadcasting, Blockstream.info for balance/UTXOs");

      // Test basic connection with getblockchaininfo
      const basicRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "getblockchaininfo",
        params: []
      };

      const response = await axios.post(this.currentEndpoint, basicRequest, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      if (response.data.error) {
        console.error("❌ QuickNode connection failed:", response.data.error.message);
        return { success: false, error: response.data.error.message };
      }

      console.log("✅ QuickNode connection successful");
      console.log("Chain:", response.data.result.chain);
      console.log("Blocks:", response.data.result.blocks);

      // Test blockchain explorer API
      const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      try {
        const explorerResponse = await axios.get(`https://blockstream.info/${networkPath}api/blocks/tip/height`, {
          timeout: 5000
        });
        console.log("✅ Blockchain explorer API working");
        console.log("Latest block height:", explorerResponse.data);
      } catch (explorerError) {
        console.log("⚠️  Blockchain explorer API test failed:", explorerError.message);
      }

      return { 
        success: true, 
        quicknode: {
          chain: response.data.result.chain,
          blocks: response.data.result.blocks,
          status: "connected"
        },
        blockchainExplorer: {
          status: "available",
          usage: "balance and UTXO queries"
        },
        setup: "Hybrid: QuickNode for broadcasting + Blockstream.info for queries"
      };

    } catch (error) {
      console.error("❌ Connection test failed:", error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new BitcoinWalletService();
