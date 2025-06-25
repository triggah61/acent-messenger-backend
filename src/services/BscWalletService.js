const { ethers } = require("ethers");
const bip39 = require("bip39");
const { BIP32Factory } = require("bip32");
const eccLib = require("tiny-secp256k1");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const Wallet = require("../model/Wallet");
const Transaction = require("../model/Transaction");
const AppError = require("../exception/AppError");

// Setup BIP32 for BSC address generation (same as Ethereum) with complete ECC wrapper
const ecc = {
  isPrivate: eccLib.isPrivate,
  isPoint: eccLib.isPoint,
  isPointCompressed: eccLib.isPointCompressed,
  pointFromScalar: (d, compressed) => {
    const result = eccLib.pointFromScalar(d, compressed);
    return result ? Buffer.from(result) : null;
  },
  pointCompress: (p, compressed) => {
    const result = eccLib.pointCompress(p, compressed);
    return Buffer.from(result);
  },
  pointAddScalar: (p, tweak) => {
    const result = eccLib.pointAddScalar(p, tweak);
    return result ? Buffer.from(result) : null;
  },
  pointAdd: (a, b) => {
    const result = eccLib.pointAdd(a, b);
    return result ? Buffer.from(result) : null;
  },
  pointMultiply: (p, tweak) => {
    const result = eccLib.pointMultiply(p, tweak);
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
  sign: (hash, privateKey) => {
    const signature = eccLib.sign(hash, privateKey);
    return Buffer.from(signature);
  },
  verify: eccLib.verify,
};

const bip32 = BIP32Factory(ecc);

/**
 * BSC (Binance Smart Chain) Wallet Service
 * Handles all BSC-specific wallet operations
 */
class BscWalletService {
  constructor() {
    this.currency = "BNB";
    this.derivationPath = "m/44'/60'/0'/0/0"; // Same as Ethereum (EVM compatible)
    
    // Network configuration
    this.network = process.env.BSC_NETWORK === "mainnet" ? "mainnet" : "testnet";
    this.rpcUrl = this.network === "mainnet" 
      ? process.env.BSC_MAINNET_RPC_URL || "https://bsc-dataseed1.binance.org/"
      : process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/";

    // BSCscan API configuration
    this.bscscanConfig = {
      mainnet: {
        baseUrl: "https://api.bscscan.com/api",
        apiKey: process.env.BSCSCAN_API_KEY,
      },
      testnet: {
        baseUrl: "https://api-testnet.bscscan.com/api",
        apiKey: process.env.BSCSCAN_API_KEY,
      },
    };

    this.bscscanApi = this.bscscanConfig[this.network];
    
    // Gas configuration (BSC typically has lower gas costs than Ethereum)
    this.gasConfig = {
      gasLimit: 21000, // Standard BNB transfer
      gasPriceMultiplier: 1.1, // 10% buffer for gas price
      defaultGasPrice: "5", // 5 Gwei default for BSC
    };

    // Platform fee percentage (0.5% = 0.005)
    this.platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.005;
    this.adminWalletAddress = process.env.BSC_ADMIN_WALLET_ADDRESS;
  }

  /**
   * Generate BSC address from HD wallet (same as Ethereum)
   */
  generateAddress(hdRoot) {
    const child = hdRoot.derivePath(this.derivationPath);
    const privateKey = child.privateKey.toString("hex");
    const wallet = new ethers.Wallet(privateKey);

    return {
      address: wallet.address,
      publicKey: child.publicKey.toString("hex"),
      privateKey: privateKey,
      derivationPath: this.derivationPath,
    };
  }

  /**
   * Get BSC balance from blockchain
   */
  async getBalance(address) {
    try {
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const balance = await provider.getBalance(address);
      const balanceInBnb = parseFloat(ethers.formatEther(balance));

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
   * Estimate gas price with buffer (BSC specific)
   */
  async estimateGasPrice() {
    try {
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const gasPrice = await provider.getFeeData();
      
      // Use gasPrice with buffer for better reliability
      const bufferedGasPrice = gasPrice.gasPrice 
        ? gasPrice.gasPrice * BigInt(Math.floor(this.gasConfig.gasPriceMultiplier * 100)) / BigInt(100)
        : ethers.parseUnits(this.gasConfig.defaultGasPrice, "gwei"); // BSC default gas price

      return bufferedGasPrice;
    } catch (error) {
      console.error("BSC gas price estimation failed, using fallback:", error.message);
      return ethers.parseUnits(this.gasConfig.defaultGasPrice, "gwei"); // Fallback gas price
    }
  }

  /**
   * Calculate transaction fee in BNB
   */
  async calculateTransactionFee(gasPrice = null) {
    try {
      const actualGasPrice = gasPrice || await this.estimateGasPrice();
      const fee = BigInt(this.gasConfig.gasLimit) * actualGasPrice;
      return parseFloat(ethers.formatEther(fee));
    } catch (error) {
      throw new AppError(`Failed to calculate transaction fee: ${error.message}`, 500);
    }
  }

  /**
   * Calculate platform fee for BSC transaction
   */
  calculatePlatformFee(amount) {
    const fee = amount * this.platformFeePercentage;
    return Math.max(fee, 0.01); // Minimum 0.01 BNB platform fee
  }

  /**
   * Send BSC (BNB) transaction
   */
  async sendTransaction(
    wallet,
    toAddress,
    amount, // Amount in BNB
    privateKey,
    gasPrice = null,
    description = "",
    priority = "medium"
  ) {
    try {
      // Setup provider and wallet
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const bscWallet = new ethers.Wallet(privateKey, provider);

      // Check balance
      const balance = await provider.getBalance(wallet.bscAddress);
      const balanceInBnb = parseFloat(ethers.formatEther(balance));
      
      if (balanceInBnb < amount) {
        throw new AppError(
          `Insufficient BNB balance. Available: ${balanceInBnb}, Required: ${amount}`, 
          400
        );
      }

      // Estimate gas with priority-based adjustment (BSC has lower gas costs than ETH)
      let baseGasPrice = gasPrice 
        ? ethers.parseUnits(gasPrice.toString(), "gwei")
        : await this.estimateGasPrice();
      
      // Apply priority-based gas price adjustments (same as fee estimation)
      let adjustedGasPrice;
      switch (priority) {
        case "low":
          adjustedGasPrice = baseGasPrice * BigInt(70) / BigInt(100); // 70% for low priority
          break;
        case "high":
          adjustedGasPrice = baseGasPrice * BigInt(140) / BigInt(100); // 140% for high priority
          break;
        case "medium":
        default:
          adjustedGasPrice = baseGasPrice; // Base price for medium priority
          break;
      }
      
      // If the adjusted gas price is unreasonably low, use realistic fallback
      const minGasPriceCheck = await this.calculateTransactionFee(adjustedGasPrice);
      if (minGasPriceCheck < 0.0003) {
        console.log("BNB gas price too low after priority adjustment, using fallback");
        const gasLimit = 21000;
        const fallbackGasPrice = ethers.parseUnits("15", "gwei");
        
        // Apply priority to fallback price
        switch (priority) {
          case "low":
            adjustedGasPrice = fallbackGasPrice * BigInt(70) / BigInt(100);
            break;
          case "high":
            adjustedGasPrice = fallbackGasPrice * BigInt(140) / BigInt(100);
            break;
          case "medium":
          default:
            adjustedGasPrice = fallbackGasPrice;
            break;
        }
      }
      
      const estimatedFee = await this.calculateTransactionFee(adjustedGasPrice);
      
      if (balanceInBnb < (amount + estimatedFee)) {
        throw new AppError(
          `Insufficient balance including gas fees. Available: ${balanceInBnb}, Required: ${amount + estimatedFee}`, 
          400
        );
      }

      // Create transaction
      const tx = {
        to: toAddress,
        value: ethers.parseEther(amount.toString()),
        gasLimit: this.gasConfig.gasLimit,
        gasPrice: adjustedGasPrice,
      };

      // Send transaction
      const txResponse = await bscWallet.sendTransaction(tx);
      
      // Handle platform fee if admin wallet is configured
      let platformTxHash = null;
      if (this.adminWalletAddress && this.calculatePlatformFee(amount) > 0) {
        try {
          const platformTx = {
            to: this.adminWalletAddress,
            value: ethers.parseEther(this.calculatePlatformFee(amount).toString()),
            gasLimit: this.gasConfig.gasLimit,
            gasPrice: adjustedGasPrice,
          };
          const platformTxResponse = await bscWallet.sendTransaction(platformTx);
          platformTxHash = platformTxResponse.hash;
        } catch (error) {
          console.error("Failed to send platform fee:", error.message);
        }
      }

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
        adminFee: this.calculatePlatformFee(amount),
        netAmount: amount,
        status: "pending",
        network: this.network,
        priority,
        description: description || "BNB transfer",
        submittedAt: new Date(),
        metadata: {
          gasPrice: ethers.formatUnits(adjustedGasPrice, "gwei"),
          gasLimit: this.gasConfig.gasLimit,
          nonce: txResponse.nonce,
          platformTxHash,
        },
      });

      await transaction.save();

      // Wait for confirmation
      try {
        const receipt = await txResponse.wait();
        
        // Update transaction status
        transaction.status = "confirmed";
        transaction.confirmations = 1;
        transaction.blockNumber = receipt.blockNumber;
        transaction.blockHash = receipt.blockHash;
        transaction.processedAt = new Date();
        transaction.confirmedAt = new Date();
        transaction.fee = parseFloat(ethers.formatEther(receipt.gasUsed * adjustedGasPrice));
        await transaction.save();
      } catch (waitError) {
        console.error("BSC transaction wait failed:", waitError.message);
        // Transaction might still be pending, will be updated by monitor
      }

      return {
        transactionId: transaction._id,
        txHash: transaction.txHash,
        amount,
        fee: estimatedFee,
        platformFee: this.calculatePlatformFee(amount),
        status: transaction.status,
        platformTxHash,
        success: true,
      };

    } catch (error) {
      throw new AppError(`Failed to send BSC transaction: ${error.message}`, 500);
    }
  }

  /**
   * Validate BSC address (same as Ethereum)
   */
  validateAddress(address) {
    try {
      return ethers.isAddress(address);
    } catch (error) {
      return false;
    }
  }

  /**
   * Monitor transaction confirmations
   */
  async monitorTransactionConfirmations() {
    try {
      const pendingTransactions = await Transaction.find({
        currency: this.currency,
        status: { $in: ["pending", "processing"] },
      });

      const provider = new ethers.JsonRpcProvider(this.rpcUrl);

      for (const transaction of pendingTransactions) {
        if (transaction.txHash) {
          try {
            const receipt = await provider.getTransactionReceipt(transaction.txHash);
            
            if (receipt && receipt.blockNumber && transaction.status !== "confirmed") {
              const currentBlock = await provider.getBlockNumber();
              const confirmations = currentBlock - receipt.blockNumber + 1;
              
              if (confirmations >= 1) {
                await transaction.markAsConfirmed(
                  transaction.txHash,
                  receipt.blockNumber,
                  receipt.blockHash
                );
              }
              
              transaction.confirmations = confirmations;
              await transaction.save();
            }
          } catch (error) {
            console.error(`Error monitoring BSC transaction ${transaction.txHash}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error("Error monitoring BSC transactions:", error.message);
    }
  }

  /**
   * Get transaction details
   */
  async getTransactionDetails(txHash) {
    try {
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      
      // Get transaction and receipt
      const [tx, receipt] = await Promise.all([
        provider.getTransaction(txHash),
        provider.getTransactionReceipt(txHash)
      ]);

      if (!tx) {
        return null;
      }

      let confirmations = 0;
      if (receipt && receipt.blockNumber) {
        const currentBlock = await provider.getBlockNumber();
        confirmations = currentBlock - receipt.blockNumber + 1;
      }

      return {
        hash: tx.hash,
        blockNumber: receipt?.blockNumber || null,
        blockHash: receipt?.blockHash || null,
        confirmations,
        from: tx.from,
        to: tx.to,
        value: ethers.formatEther(tx.value),
        gasPrice: ethers.formatUnits(tx.gasPrice || 0, "gwei"),
        gasLimit: tx.gasLimit?.toString() || "0",
        gasUsed: receipt?.gasUsed?.toString() || "0",
        status: receipt?.status || 0,
      };
    } catch (error) {
      console.error("Failed to get BSC transaction details:", error.message);
      return null;
    }
  }

  /**
   * Get transactions for an address using BSCscan API
   */
  async getTransactionHistory(address, startBlock = 0, endBlock = "latest") {
    try {
      if (!this.bscscanApi.apiKey) {
        throw new AppError("BSCScan API key not configured", 500);
      }

      const params = new URLSearchParams({
        module: "account",
        action: "txlist",
        address: address,
        startblock: startBlock,
        endblock: endBlock,
        page: 1,
        offset: 100,
        sort: "desc",
        apikey: this.bscscanApi.apiKey,
      });

      const response = await axios.get(`${this.bscscanApi.baseUrl}?${params}`);
      
      if (response.data.status !== "1") {
        throw new AppError("Failed to fetch BSC transaction history", 500);
      }

      return response.data.result.map(tx => ({
        hash: tx.hash,
        blockNumber: parseInt(tx.blockNumber),
        from: tx.from,
        to: tx.to,
        value: ethers.formatEther(tx.value),
        gasPrice: ethers.formatUnits(tx.gasPrice, "gwei"),
        gasUsed: tx.gasUsed,
        timestamp: new Date(parseInt(tx.timeStamp) * 1000),
        confirmations: tx.confirmations,
      }));
    } catch (error) {
      throw new AppError(`Failed to get BSC transaction history: ${error.message}`, 500);
    }
  }

  /**
   * Test BSC service connection
   */
  async testConnection() {
    try {
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      
      // Test basic connection
      const network = await provider.getNetwork();
      const blockNumber = await provider.getBlockNumber();
      
      // Test gas price estimation
      const gasPrice = await this.estimateGasPrice();

      return {
        success: true,
        currency: this.currency,
        network: this.network,
        chainId: network.chainId.toString(),
        blockNumber: blockNumber,
        gasPrice: ethers.formatUnits(gasPrice, "gwei") + " Gwei",
        rpcUrl: this.rpcUrl,
      };
    } catch (error) {
      return { 
        success: false, 
        currency: this.currency,
        error: error.message 
      };
    }
  }

  /**
   * Convert Wei to BNB
   */
  weiToBnb(wei) {
    return parseFloat(ethers.formatEther(wei));
  }

  /**
   * Convert BNB to Wei
   */
  bnbToWei(bnb) {
    return ethers.parseEther(bnb.toString());
  }

  /**
   * Convert Gwei to Wei
   */
  gweiToWei(gwei) {
    return ethers.parseUnits(gwei.toString(), "gwei");
  }
}

module.exports = new BscWalletService(); 