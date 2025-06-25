const { ethers } = require("ethers");
const bip39 = require("bip39");
const { BIP32Factory } = require("bip32");
const eccLib = require("tiny-secp256k1");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const Wallet = require("../model/Wallet");
const Transaction = require("../model/Transaction");
const AppError = require("../exception/AppError");

// Setup BIP32 for Ethereum address generation with complete ECC wrapper
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
 * Ethereum Wallet Service
 * Handles Ethereum blockchain operations including wallet creation, transactions, and balance checking
 */
class EthWalletService {
  constructor() {
    this.currency = "ETH";
    this.derivationPath = "m/44'/60'/0'/0/0"; // Standard Ethereum BIP44 path
    
    // Network configuration
    this.network = process.env.ETH_NETWORK === "mainnet" ? "mainnet" : "testnet";
    this.rpcUrl = this.network === "mainnet" 
      ? process.env.ETH_MAINNET_RPC_URL || "https://eth-mainnet.public.blastapi.io"
      : process.env.ETH_TESTNET_RPC_URL || "https://eth-sepolia.public.blastapi.io";

    // Etherscan API configuration
    this.etherscanConfig = {
      mainnet: {
        baseUrl: "https://api.etherscan.io/api",
        apiKey: process.env.ETHERSCAN_API_KEY,
      },
      testnet: {
        baseUrl: "https://api-sepolia.etherscan.io/api",
        apiKey: process.env.ETHERSCAN_API_KEY,
      },
    };

    this.etherscanApi = this.etherscanConfig[this.network];
    
    // Gas configuration
    this.gasConfig = {
      gasLimit: 21000, // Standard ETH transfer
      gasPriceMultiplier: 1.1, // 10% buffer for gas price
    };

    // Platform fee percentage (0.5% = 0.005)
    this.platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.005;
    this.adminWalletAddress = process.env.ETH_ADMIN_WALLET_ADDRESS;
  }

  /**
   * Generate Ethereum address from HD wallet
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
   * Get Ethereum balance from blockchain
   */
  async getBalance(address) {
    try {
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const balance = await provider.getBalance(address);
      const balanceInEth = parseFloat(ethers.formatEther(balance));

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
   * Estimate gas price with buffer
   */
  async estimateGasPrice() {
    try {
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const gasPrice = await provider.getFeeData();
      
      // Use gasPrice with buffer for better reliability
      const bufferedGasPrice = gasPrice.gasPrice 
        ? gasPrice.gasPrice * BigInt(Math.floor(this.gasConfig.gasPriceMultiplier * 100)) / BigInt(100)
        : ethers.parseUnits("20", "gwei"); // Fallback gas price

      return bufferedGasPrice;
    } catch (error) {
      console.error("Gas price estimation failed, using fallback:", error.message);
      return ethers.parseUnits("20", "gwei"); // Fallback gas price
    }
  }

  /**
   * Calculate transaction fee in ETH
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
   * Calculate platform fee for Ethereum transaction
   */
  calculatePlatformFee(amount) {
    const fee = amount * this.platformFeePercentage;
    return Math.max(fee, 0.001); // Minimum 0.001 ETH platform fee
  }

  /**
   * Send Ethereum transaction
   */
  async sendTransaction(
    wallet,
    toAddress,
    amount, // Amount in ETH
    privateKey,
    gasPrice = null,
    description = "",
    priority = "medium"
  ) {
    try {
      // Setup provider and wallet
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const ethWallet = new ethers.Wallet(privateKey, provider);

      // Check balance
      const balance = await provider.getBalance(wallet.ethAddress);
      const balanceInEth = parseFloat(ethers.formatEther(balance));
      
      if (balanceInEth < amount) {
        throw new AppError(
          `Insufficient ETH balance. Available: ${balanceInEth}, Required: ${amount}`, 
          400
        );
      }

      // Estimate gas
      const currentGasPrice = gasPrice 
        ? ethers.parseUnits(gasPrice.toString(), "gwei")
        : await this.estimateGasPrice();
      
      const estimatedFee = await this.calculateTransactionFee(currentGasPrice);
      
      if (balanceInEth < (amount + estimatedFee)) {
        throw new AppError(
          `Insufficient balance including gas fees. Available: ${balanceInEth}, Required: ${amount + estimatedFee}`, 
          400
        );
      }

      // Create transaction
      const tx = {
        to: toAddress,
        value: ethers.parseEther(amount.toString()),
        gasLimit: this.gasConfig.gasLimit,
        gasPrice: currentGasPrice,
      };

      // Send transaction
      const txResponse = await ethWallet.sendTransaction(tx);
      
      // Handle platform fee if admin wallet is configured
      let platformTxHash = null;
      if (this.adminWalletAddress && this.calculatePlatformFee(amount) > 0) {
        try {
          const platformTx = {
            to: this.adminWalletAddress,
            value: ethers.parseEther(this.calculatePlatformFee(amount).toString()),
            gasLimit: this.gasConfig.gasLimit,
            gasPrice: currentGasPrice,
          };
          const platformTxResponse = await ethWallet.sendTransaction(platformTx);
          platformTxHash = platformTxResponse.hash;
        } catch (error) {
          console.error("Failed to send platform fee:", error.message);
        }
      }

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
        adminFee: this.calculatePlatformFee(amount),
        netAmount: amount,
        status: "pending",
        network: this.network,
        priority,
        description: description || "ETH transfer",
        submittedAt: new Date(),
        metadata: {
          gasPrice: ethers.formatUnits(currentGasPrice, "gwei"),
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
        transaction.fee = parseFloat(ethers.formatEther(receipt.gasUsed * currentGasPrice));
        await transaction.save();
      } catch (waitError) {
        console.error("Transaction wait failed:", waitError.message);
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
      throw new AppError(`Failed to send ETH transaction: ${error.message}`, 500);
    }
  }

  /**
   * Validate Ethereum address
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
            console.error(`Error monitoring ETH transaction ${transaction.txHash}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error("Error monitoring ETH transactions:", error.message);
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
      console.error("Failed to get ETH transaction details:", error.message);
      return null;
    }
  }

  /**
   * Get transactions for an address using Etherscan API
   */
  async getTransactionHistory(address, startBlock = 0, endBlock = "latest") {
    try {
      if (!this.etherscanApi.apiKey) {
        throw new AppError("Etherscan API key not configured", 500);
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
        apikey: this.etherscanApi.apiKey,
      });

      const response = await axios.get(`${this.etherscanApi.baseUrl}?${params}`);
      
      if (response.data.status !== "1") {
        throw new AppError("Failed to fetch transaction history", 500);
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
      throw new AppError(`Failed to get transaction history: ${error.message}`, 500);
    }
  }

  /**
   * Test Ethereum service connection
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
   * Convert Wei to ETH
   */
  weiToEth(wei) {
    return parseFloat(ethers.formatEther(wei));
  }

  /**
   * Convert ETH to Wei
   */
  ethToWei(eth) {
    return ethers.parseEther(eth.toString());
  }

  /**
   * Convert Gwei to Wei
   */
  gweiToWei(gwei) {
    return ethers.parseUnits(gwei.toString(), "gwei");
  }
}

module.exports = new EthWalletService(); 