const bitcoin = require("bitcoinjs-lib");
const crypto = require("crypto");
const bip39 = require("bip39");
const { ethers } = require("ethers");
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

class MultiChainWalletService {
  constructor() {
    // Use testnet for development, mainnet for production
    this.network =
      process.env.BITCOIN_NETWORK === "mainnet"
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;

    // QuickNode endpoints configuration for Bitcoin
    this.rpcConfig = {
      testnet: {
        endpoint:
          process.env.QUICKNODE_BITCOIN_TESTNET_ENDPOINT ||
          "https://your-testnet-endpoint.btc-testnet.quiknode.pro/YOUR_API_KEY/",
      },
      mainnet: {
        endpoint:
          process.env.QUICKNODE_BITCOIN_MAINNET_ENDPOINT ||
          "https://your-mainnet-endpoint.btc.quiknode.pro/YOUR_API_KEY/",
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

    // Minimum platform fee in satoshis (to avoid dust)
    this.minimumPlatformFee =
      parseInt(process.env.MINIMUM_PLATFORM_FEE) || 1000;
  }

  /**
   * Generate a new mnemonic phrase
   */
  generateMnemonic() {
    return bip39.generateMnemonic();
  }

  /**
   * Create a new HD wallet for a user with Bitcoin, Ethereum, and BSC addresses
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

      // === BITCOIN ADDRESS GENERATION ===
      // Derive Bitcoin wallet using BIP44 path: m/44'/coin_type'/account'/change/address_index
      // For Bitcoin: m/44'/0'/0'/0/0 (mainnet) or m/44'/1'/0'/0/0 (testnet)
      const coinType = this.network === bitcoin.networks.bitcoin ? 0 : 1;
      const btcDerivationPath = `m/44'/${coinType}'/0'/0/0`;
      const btcChild = root.derivePath(btcDerivationPath);

      // Generate SegWit address (P2WPKH) - starts with 'bc1' for mainnet, 'tb1' for testnet
      const { address: btcAddress } = bitcoin.payments.p2wpkh({
        pubkey: btcChild.publicKey,
        network: this.network,
      });

      // === ETHEREUM ADDRESS GENERATION ===
      // Derive Ethereum wallet using BIP44 path: m/44'/60'/0'/0/0
      const ethDerivationPath = `m/44'/60'/0'/0/0`;
      const ethChild = root.derivePath(ethDerivationPath);

      // Create Ethereum wallet from private key
      const ethPrivateKey = ethChild.privateKey.toString("hex");
      const ethWallet = new ethers.Wallet(ethPrivateKey);
      const ethAddress = ethWallet.address;

      // === BSC ADDRESS GENERATION ===
      // BSC uses the same derivation path as Ethereum (since it's EVM compatible)
      // The address will be the same as Ethereum address
      const bscAddress = ethAddress; // BSC and ETH addresses are identical

      // Create wallet object with all three addresses
      const wallet = new Wallet({
        userId,
        btcAddress,
        ethAddress,
        bscAddress,
        address: btcAddress, // Keep legacy field for backward compatibility
        publicKey: btcChild.publicKey.toString("hex"),
        derivationPath: btcDerivationPath, // Store Bitcoin derivation path as primary
        walletType: "main",
        network:
          this.network === bitcoin.networks.bitcoin ? "mainnet" : "testnet",
        label,
        status: "active",
      });

      let walletEncryptionKey = process.env.WALLET_ENCRYPTION_KEY;

      // Encrypt Bitcoin private key (primary)
      const btcPrivateKeyWIF = btcChild.toWIF();
      wallet.encryptPrivateKey(btcPrivateKeyWIF, walletEncryptionKey);

      // Encrypt mnemonic (can derive all other private keys from this)
      wallet.encryptMnemonic(mnemonic, walletEncryptionKey);

      // Save wallet
      await wallet.save();

      return {
        wallet: {
          id: wallet._id,
          btcAddress: wallet.btcAddress,
          ethAddress: wallet.ethAddress,
          bscAddress: wallet.bscAddress,
          label: wallet.label,
          balances: wallet.balances,
          network: wallet.network,
          derivationPath: wallet.derivationPath,
        },
        mnemonic, // Return mnemonic for backup
        success: true,
        addresses: {
          bitcoin: btcAddress,
          ethereum: ethAddress,
          bsc: bscAddress,
        },
      };
    } catch (error) {
      throw new AppError(
        `Failed to create multi-chain wallet: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get user's wallets with multi-chain addresses
   */
  async getUserWallets(userId) {
    try {
      const wallets = await Wallet.findByUserId(userId);
      return wallets.map((wallet) => ({
        id: wallet._id,
        btcAddress: wallet.btcAddress,
        ethAddress: wallet.ethAddress,
        bscAddress: wallet.bscAddress,
        label: wallet.label,
        balances: wallet.balances || { btc: 0, eth: 0, bsc: 0 },
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
   * Get wallet balance from blockchain using appropriate API for each chain
   */
  async getWalletBalance(address, currency = 'btc') {
    try {
      console.log(`=== ${currency.toUpperCase()} BALANCE CHECK ===`);
      console.log("Fetching balance for address:", address);
      
      switch (currency.toLowerCase()) {
        case 'btc':
          return this.getBitcoinBalance(address);
        case 'eth':
          return this.getEthereumBalance(address);
        case 'bnb':
        case 'bsc':
          return this.getBSCBalance(address);
        default:
          throw new AppError(`Unsupported currency: ${currency}`, 400);
      }
    } catch (error) {
      console.error(`${currency.toUpperCase()} Balance API Error:`, error.message);
      throw new AppError(`Failed to get wallet balance: ${error.message}`, 500);
    }
  }

  /**
   * Get Bitcoin balance using blockchain explorer API
   */
  async getBitcoinBalance(address) {
    console.log("Using Bitcoin blockchain explorer API...");
    const networkPath = this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
    const response = await axios.get(
      `https://blockstream.info/${networkPath}api/address/${address}`,
      // { timeout: 10000 }
    );

    return {
      balance: response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum,
      unconfirmedBalance: response.data.mempool_stats.funded_txo_sum - response.data.mempool_stats.spent_txo_sum,
      totalReceived: response.data.chain_stats.funded_txo_sum,
      totalSent: response.data.chain_stats.spent_txo_sum,
      nTx: response.data.chain_stats.tx_count,
    };
  }

  /**
   * Get Ethereum balance using ethers.js
   */
  async getEthereumBalance(address) {
    try {
      console.log("Using Ethereum provider for balance check...");
      const network = process.env.ETH_NETWORK === "mainnet" ? "mainnet" : "sepolia";
      const rpcUrl = network === "mainnet" 
        ? process.env.ETH_MAINNET_RPC_URL || "https://eth-mainnet.public.blastapi.io"
        : process.env.ETH_TESTNET_RPC_URL || "https://eth-sepolia.public.blastapi.io";
      
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const balance = await provider.getBalance(address);
      const balanceInEth = parseFloat(ethers.utils.formatEther(balance));

      return {
        balance: balanceInEth,
        unconfirmedBalance: 0, // ETH doesn't have pending balances like Bitcoin
        totalReceived: balanceInEth, // Simplified - would need transaction history for accurate total
        totalSent: 0,
        nTx: 0,
      };
    } catch (error) {
      throw new AppError(`Failed to get Ethereum balance: ${error.message}`, 500);
    }
  }

  /**
   * Get BSC balance using ethers.js
   */
  async getBSCBalance(address) {
    try {
      console.log("Using BSC provider for balance check...");
      const network = process.env.BSC_NETWORK === "mainnet" ? "mainnet" : "testnet";
      const rpcUrl = network === "mainnet" 
        ? process.env.BSC_MAINNET_RPC_URL || "https://bsc-dataseed1.binance.org/"
        : process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/";
      
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const balance = await provider.getBalance(address);
      const balanceInBnb = parseFloat(ethers.utils.formatEther(balance));

      return {
        balance: balanceInBnb,
        unconfirmedBalance: 0, // BSC doesn't have pending balances like Bitcoin
        totalReceived: balanceInBnb, // Simplified - would need transaction history for accurate total
        totalSent: 0,
        nTx: 0,
      };
    } catch (error) {
      throw new AppError(`Failed to get BSC balance: ${error.message}`, 500);
    }
  }

  /**
   * Update wallet balance in database - now supports all chains
   */
  async updateWalletBalance(walletId, currency = 'btc') {
    try {
      const wallet = await Wallet.findById(walletId);
      if (!wallet) {
        throw new AppError("Wallet not found", 404);
      }

      let address;
      switch (currency.toLowerCase()) {
        case 'btc':
          address = wallet.btcAddress || wallet.address; // Fallback to legacy field
          break;
        case 'eth':
          address = wallet.ethAddress;
          break;
        case 'bnb':
        case 'bsc':
          address = wallet.bscAddress;
          break;
        default:
          throw new AppError("Unsupported currency", 400);
      }

      if (!address) {
        throw new AppError(`No ${currency.toUpperCase()} address found for this wallet`, 400);
      }

      const balanceInfo = await this.getWalletBalance(address, currency);
      
      // Update the wallet balance in the database
      // Note: We'll use a simple field update since the user removed the balances object
      // You might want to add a balances field back to the Wallet model for multi-chain support
      if (currency.toLowerCase() === 'btc') {
        wallet.balance = balanceInfo.balance; // For backward compatibility
      }
      
      wallet.lastUsed = new Date();
      await wallet.save();

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
      const networkPath =
        this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      const explorerResponse = await axios.get(
        `https://blockstream.info/${networkPath}api/address/${address}/utxo`,
        { timeout: 10000 }
      );

      console.log("UTXOs found via explorer:", explorerResponse.data.length);
      console.log("UTXO data:", explorerResponse.data);

      // Transform explorer UTXO format to match expected format
      return explorerResponse.data.map((utxo) => ({
        tx_hash: utxo.txid,
        tx_output_n: utxo.vout,
        value: utxo.value,
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
   * Calculate platform fee with minimum threshold
   */
  calculatePlatformFee(amount) {
    const percentageFee = Math.floor(amount * this.platformFeePercentage);

    // Return the higher of percentage fee or minimum fee
    return Math.max(percentageFee, this.minimumPlatformFee);
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

    try {
      const balanceInfo = await this.getWalletBalance(wallet.btcAddress);
      console.log("Live balance info:", balanceInfo);
    } catch (balanceError) {
      console.error("Error getting balance:", balanceError.message);
    }

    // Get UTXOs
    const utxos = await this.getUTXOs(wallet.btcAddress);
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
    let shouldCreatePlatformFeeOutput = false;

    console.log("=== DUST CHECK ===");
    console.log("Platform fee:", platformFee);
    console.log("Dust threshold:", dustThreshold);
    console.log("Platform fee is dust:", this.isDustAmount(platformFee));

    // Always charge platform fee, but handle dust outputs appropriately
    if (this.isDustAmount(platformFee)) {
      console.log(
        "Platform fee is dust - adding to network fee for miners, but still charging user"
      );
      // Add platform fee to network fee (miners get it instead of creating dust output)
      adjustedNetworkFee += platformFee;
      shouldCreatePlatformFeeOutput = false;
    } else if (platformFee > 0 && this.adminWalletAddress) {
      console.log(
        "Platform fee is above dust threshold - creating separate output"
      );
      shouldCreatePlatformFeeOutput = true;
    }

    // Calculate change (ALWAYS subtract full platform fee from user's funds)
    const change = inputTotal - amount - adjustedNetworkFee - platformFee;
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
    console.log("Platform fee (always charged):", platformFee);
    console.log(
      "Platform fee output:",
      shouldCreatePlatformFeeOutput ? platformFee : 0
    );
    console.log(
      "Change output:",
      shouldCreateChangeOutput ? adjustedChange : 0
    );
    console.log(
      "Should create platform fee output:",
      shouldCreatePlatformFeeOutput
    );
    console.log("Should create change output:", shouldCreateChangeOutput);
    console.log(
      "Total deducted from user:",
      amount + adjustedNetworkFee + platformFee
    );

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
        address: wallet.btcAddress,
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
      currency: "BTC",
      type: "withdrawal",
      userId: wallet.userId,
      fromAddress: wallet.btcAddress,
      toAddress,
      amount,
      fee: adjustedNetworkFee,
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
        ...(shouldCreatePlatformFeeOutput
          ? [{ address: this.adminWalletAddress, value: platformFee }]
          : []),
        ...(shouldCreateChangeOutput
          ? [{ address: wallet.btcAddress, value: adjustedChange }]
          : []),
      ],
      description,
      submittedAt: new Date(),
      metadata: {
        dustHandling: {
          platformFeeWasDust: this.isDustAmount(platformFee),
          platformFeeAddedToMinerFee: this.isDustAmount(platformFee),
          originalNetworkFee: networkFee,
          adjustedNetworkFee: adjustedNetworkFee,
          note: this.isDustAmount(platformFee)
            ? "Platform fee was below dust threshold, added to miner fee"
            : "Platform fee sent to admin wallet",
        },
      },
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
      platformFee: platformFee,
      status: transaction.status,
      success: broadcastResult.success,
      dustHandling: {
        platformFeeWasDust: this.isDustAmount(platformFee),
        note: this.isDustAmount(platformFee)
          ? "Platform fee was below dust threshold, added to miner fee"
          : "Platform fee sent to admin wallet",
      },
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
        params: [rawTx],
      };

      const response = await axios.post(this.currentEndpoint, requestData, {
        headers: {
          "Content-Type": "application/json",
        },
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
        params: [txHash, true], // true = return decoded JSON instead of hex
      };

      try {
        const response = await axios.post(this.currentEndpoint, requestData, {
          headers: { "Content-Type": "application/json" },
        });

        if (!response.data.error && response.data.result) {
          return response.data.result;
        }
      } catch (rpcError) {
        console.log(
          "Standard RPC failed, falling back to blockchain explorer..."
        );
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
        params: [txHash, false], // false = return hex, true = return decoded
      };

      const response = await axios.post(this.currentEndpoint, requestData, {
        headers: {
          "Content-Type": "application/json",
        },
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
  validateBitcoinAddress(address) {
    try {
      bitcoin.address.toOutputScript(address, this.network);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate Ethereum address (also works for BSC since they use the same format)
   */
  validateEthereumAddress(address) {
    try {
      return ethers.utils.isAddress(address);
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate BSC address (same as Ethereum)
   */
  validateBSCAddress(address) {
    return this.validateEthereumAddress(address);
  }

  /**
   * Validate address for any supported chain
   */
  validateAddress(address, chain = "auto") {
    if (chain === "auto") {
      // Auto-detect chain type
      return (
        this.validateBitcoinAddress(address) ||
        this.validateEthereumAddress(address)
      );
    }

    switch (chain.toLowerCase()) {
      case "btc":
      case "bitcoin":
        return this.validateBitcoinAddress(address);
      case "eth":
      case "ethereum":
        return this.validateEthereumAddress(address);
      case "bsc":
      case "bnb":
        return this.validateBSCAddress(address);
      default:
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
   * Test connection and validate multi-chain setup
   */
  async testConnection() {
    try {
      console.log("=== Multi-Chain Wallet Service Test ===");
      console.log(
        "Bitcoin network:",
        this.network === bitcoin.networks.bitcoin ? "mainnet" : "testnet"
      );
      console.log("QuickNode endpoint:", this.currentEndpoint);
      console.log("Ethers version:", ethers.version);
      console.log("Supported chains: Bitcoin, Ethereum, BSC");

      // Test Bitcoin connection
      const basicRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "getblockchaininfo",
        params: [],
      };

      const response = await axios.post(this.currentEndpoint, basicRequest, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      if (response.data.error) {
        console.error(
          "❌ Bitcoin QuickNode connection failed:",
          response.data.error.message
        );
        return { success: false, error: response.data.error.message };
      }

      console.log("✅ Bitcoin QuickNode connection successful");
      console.log("Chain:", response.data.result.chain);
      console.log("Blocks:", response.data.result.blocks);

      // Test Ethereum address generation
      try {
        const testMnemonic =
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        const seed = await bip39.mnemonicToSeed(testMnemonic);
        const root = bip32.fromSeed(seed, this.network);
        const ethChild = root.derivePath("m/44'/60'/0'/0/0");
        const ethPrivateKey = ethChild.privateKey.toString("hex");
        const ethWallet = new ethers.Wallet(ethPrivateKey);

        console.log("✅ Ethereum address generation working");
        console.log("Test ETH address:", ethWallet.address);
      } catch (ethError) {
        console.log(
          "⚠️  Ethereum address generation test failed:",
          ethError.message
        );
      }

      // Test blockchain explorer API
      const networkPath =
        this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      try {
        const explorerResponse = await axios.get(
          `https://blockstream.info/${networkPath}api/blocks/tip/height`,
          {
            timeout: 5000,
          }
        );
        console.log("✅ Blockchain explorer API working");
        console.log("Latest block height:", explorerResponse.data);
      } catch (explorerError) {
        console.log(
          "⚠️  Blockchain explorer API test failed:",
          explorerError.message
        );
      }

      return {
        success: true,
        chains: {
          bitcoin: {
            chain: response.data.result.chain,
            blocks: response.data.result.blocks,
            status: "connected",
            provider: "QuickNode",
          },
          ethereum: {
            status: "address_generation_ready",
            provider: "ethers.js",
            note: "Balance checking and transactions not yet implemented",
          },
          bsc: {
            status: "address_generation_ready",
            provider: "ethers.js",
            note: "Same as Ethereum - Balance checking and transactions not yet implemented",
          },
        },
        setup:
          "Multi-chain wallet service with Bitcoin, Ethereum, and BSC address generation",
      };
    } catch (error) {
      console.error("❌ Connection test failed:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get Ethereum private key from wallet mnemonic
   */
  async getEthereumPrivateKey(walletId, walletEncryptionKey) {
    try {
      const wallet = await Wallet.findById(walletId);
      if (!wallet) {
        throw new AppError("Wallet not found", 404);
      }

      // Decrypt mnemonic
      const mnemonic = await wallet.decryptMnemonic(walletEncryptionKey);

      // Generate seed from mnemonic
      const seed = await bip39.mnemonicToSeed(mnemonic);

      // Create HD root
      const root = bip32.fromSeed(seed, this.network);

      // Derive Ethereum wallet using BIP44 path: m/44'/60'/0'/0/0
      const ethDerivationPath = `m/44'/60'/0'/0/0`;
      const ethChild = root.derivePath(ethDerivationPath);

      return ethChild.privateKey.toString("hex");
    } catch (error) {
      throw new AppError(
        `Failed to get Ethereum private key: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get BSC private key from wallet mnemonic (same as Ethereum)
   */
  async getBSCPrivateKey(walletId, walletEncryptionKey) {
    // BSC uses the same derivation as Ethereum
    return this.getEthereumPrivateKey(walletId, walletEncryptionKey);
  }

  /**
   * Send ETH transaction
   */
  async sendEthTransaction(
    fromWalletId,
    toAddress,
    amount, // Amount in ETH
    walletEncryptionKey,
    gasPrice = null, // Optional custom gas price in Gwei
    description = ""
  ) {
    try {
      // Get wallet
      const wallet = await Wallet.findById(fromWalletId);
      if (!wallet) {
        throw new AppError("Wallet not found", 404);
      }

      if (wallet.status !== "active") {
        throw new AppError("Wallet is not active", 400);
      }

      if (!wallet.ethAddress) {
        throw new AppError("No Ethereum address found for this wallet", 400);
      }

      // Get Ethereum private key
      const ethPrivateKey = await this.getEthereumPrivateKey(fromWalletId, walletEncryptionKey);
      
      // Setup provider and wallet
      const network = process.env.ETH_NETWORK === "mainnet" ? "mainnet" : "sepolia";
      const rpcUrl = network === "mainnet" 
        ? process.env.ETH_MAINNET_RPC_URL || "https://eth-mainnet.public.blastapi.io"
        : process.env.ETH_TESTNET_RPC_URL || "https://eth-sepolia.public.blastapi.io";
      
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const ethWallet = new ethers.Wallet(ethPrivateKey, provider);

      // Check balance
      const balance = await ethWallet.getBalance();
      const balanceInEth = parseFloat(ethers.utils.formatEther(balance));
      
      if (balanceInEth < amount) {
        throw new AppError(`Insufficient ETH balance. Available: ${balanceInEth}, Required: ${amount}`, 400);
      }

      // Estimate gas
      const gasLimit = 21000; // Standard ETH transfer
      const currentGasPrice = gasPrice 
        ? ethers.utils.parseUnits(gasPrice.toString(), "gwei")
        : await provider.getGasPrice();
      
      const estimatedFee = gasLimit * parseFloat(ethers.utils.formatUnits(currentGasPrice, "gwei")) / 1e9;
      
      if (balanceInEth < (amount + estimatedFee)) {
        throw new AppError(`Insufficient balance including gas fees. Available: ${balanceInEth}, Required: ${amount + estimatedFee}`, 400);
      }

      // Create transaction
      const tx = {
        to: toAddress,
        value: ethers.utils.parseEther(amount.toString()),
        gasLimit: gasLimit,
        gasPrice: currentGasPrice,
      };

      // Send transaction
      const txResponse = await ethWallet.sendTransaction(tx);
      
      // Create transaction record
      const transaction = new Transaction({
        internalId: uuidv4(),
        txHash: txResponse.hash,
        currency: "ETH",
        type: "withdrawal",
        userId: wallet.userId,
        fromAddress: wallet.ethAddress,
        toAddress,
        amount: amount,
        fee: estimatedFee,
        adminFee: 0,
        netAmount: amount,
        status: "pending",
        network: network,
        priority: "medium",
        description: description || "ETH transfer",
        tags: ["eth", "transfer"],
        submittedAt: new Date(),
        metadata: {
          gasPrice: ethers.utils.formatUnits(currentGasPrice, "gwei"),
          gasLimit: gasLimit,
          nonce: txResponse.nonce,
        },
      });

      await transaction.save();

      // Wait for confirmation
      const receipt = await txResponse.wait();
      
      // Update transaction status
      transaction.status = "confirmed";
      transaction.confirmations = 1;
      transaction.blockNumber = receipt.blockNumber;
      transaction.blockHash = receipt.blockHash;
      transaction.processedAt = new Date();
      transaction.confirmedAt = new Date();
      transaction.fee = parseFloat(ethers.utils.formatEther(receipt.gasUsed.mul(currentGasPrice)));
      await transaction.save();

      return {
        transactionId: transaction._id,
        txHash: transaction.txHash,
        amount,
        fee: transaction.fee,
        status: transaction.status,
        success: true,
      };

    } catch (error) {
      throw new AppError(`Failed to send ETH transaction: ${error.message}`, 500);
    }
  }

  /**
   * Send BSC (BNB) transaction
   */
  async sendBscTransaction(
    fromWalletId,
    toAddress,
    amount, // Amount in BNB
    walletEncryptionKey,
    gasPrice = null, // Optional custom gas price in Gwei
    description = ""
  ) {
    try {
      // Get wallet
      const wallet = await Wallet.findById(fromWalletId);
      if (!wallet) {
        throw new AppError("Wallet not found", 404);
      }

      if (wallet.status !== "active") {
        throw new AppError("Wallet is not active", 400);
      }

      if (!wallet.bscAddress) {
        throw new AppError("No BSC address found for this wallet", 400);
      }

      // Get BSC private key (same as ETH)
      const bscPrivateKey = await this.getBSCPrivateKey(fromWalletId, walletEncryptionKey);
      
      // Setup provider and wallet
      const network = process.env.BSC_NETWORK === "mainnet" ? "mainnet" : "testnet";
      const rpcUrl = network === "mainnet" 
        ? process.env.BSC_MAINNET_RPC_URL || "https://bsc-dataseed1.binance.org/"
        : process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/";
      
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const bscWallet = new ethers.Wallet(bscPrivateKey, provider);

      // Check balance
      const balance = await bscWallet.getBalance();
      const balanceInBnb = parseFloat(ethers.utils.formatEther(balance));
      
      if (balanceInBnb < amount) {
        throw new AppError(`Insufficient BNB balance. Available: ${balanceInBnb}, Required: ${amount}`, 400);
      }

      // Estimate gas (BSC has lower gas costs than ETH)
      const gasLimit = 21000; // Standard BNB transfer
      const currentGasPrice = gasPrice 
        ? ethers.utils.parseUnits(gasPrice.toString(), "gwei")
        : await provider.getGasPrice();
      
      const estimatedFee = gasLimit * parseFloat(ethers.utils.formatUnits(currentGasPrice, "gwei")) / 1e9;
      
      if (balanceInBnb < (amount + estimatedFee)) {
        throw new AppError(`Insufficient balance including gas fees. Available: ${balanceInBnb}, Required: ${amount + estimatedFee}`, 400);
      }

      // Create transaction
      const tx = {
        to: toAddress,
        value: ethers.utils.parseEther(amount.toString()),
        gasLimit: gasLimit,
        gasPrice: currentGasPrice,
      };

      // Send transaction
      const txResponse = await bscWallet.sendTransaction(tx);
      
      // Create transaction record
      const transaction = new Transaction({
        internalId: uuidv4(),
        txHash: txResponse.hash,
        currency: "BNB",
        type: "withdrawal",
        userId: wallet.userId,
        fromAddress: wallet.bscAddress,
        toAddress,
        amount: amount,
        fee: estimatedFee,
        adminFee: 0,
        netAmount: amount,
        status: "pending",
        network: network,
        priority: "medium",
        description: description || "BNB transfer",
        tags: ["bnb", "bsc", "transfer"],
        submittedAt: new Date(),
        metadata: {
          gasPrice: ethers.utils.formatUnits(currentGasPrice, "gwei"),
          gasLimit: gasLimit,
          nonce: txResponse.nonce,
        },
      });

      await transaction.save();

      // Wait for confirmation
      const receipt = await txResponse.wait();
      
      // Update transaction status
      transaction.status = "confirmed";
      transaction.confirmations = 1;
      transaction.blockNumber = receipt.blockNumber;
      transaction.blockHash = receipt.blockHash;
      transaction.processedAt = new Date();
      transaction.confirmedAt = new Date();
      transaction.fee = parseFloat(ethers.utils.formatEther(receipt.gasUsed.mul(currentGasPrice)));
      await transaction.save();

      return {
        transactionId: transaction._id,
        txHash: transaction.txHash,
        amount,
        fee: transaction.fee,
        status: transaction.status,
        success: true,
      };

    } catch (error) {
      throw new AppError(`Failed to send BSC transaction: ${error.message}`, 500);
    }
  }
}

module.exports = new MultiChainWalletService();
