const cron = require("node-cron");
const Wallet = require("../model/Wallet");
const Transaction = require("../model/Transaction");
const logger = require("../config/logger");
const { ethers } = require("ethers");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");

/**
 * BSC Transaction Listener Service
 * Monitors BSC blockchain for incoming BNB transactions to internal wallet addresses
 * Runs every 2 minutes to sync new transactions
 */
class BscTransactionListenerService {
  constructor() {
    this.network = process.env.BSC_NETWORK === "mainnet" ? "mainnet" : "testnet";
    this.provider = this.initializeProvider();
    this.lastCheckedBlock = null;
    this.isRunning = false;
    this.currency = "BNB";
  }

  /**
   * Initialize BSC provider
   */
  initializeProvider() {
    try {
      // Use BSC RPC endpoints
      const rpcUrl = this.network === "mainnet" 
        ? process.env.BSC_MAINNET_RPC_URL || "https://bsc-dataseed1.binance.org/"
        : process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/";
      
      return new ethers.providers.JsonRpcProvider(rpcUrl);
    } catch (error) {
      logger.error("Failed to initialize BSC provider:", error.message);
      throw error;
    }
  }

  /**
   * Get the latest block number from BSC blockchain
   */
  async getLatestBlockNumber() {
    try {
      return await this.provider.getBlockNumber();
    } catch (error) {
      logger.error("Failed to get latest BSC block number:", error.message);
      throw error;
    }
  }

  /**
   * Get all active BSC wallet addresses from database
   */
  async getAllBscWalletAddresses() {
    try {
      const wallets = await Wallet.find({
        status: "active",
        network: this.network,
        bscAddress: { $exists: true, $ne: null },
      }).select("bscAddress userId");

      return wallets.map((wallet) => ({
        bscAddress: wallet.bscAddress,
        userId: wallet.userId,
        walletId: wallet._id,
      }));
    } catch (error) {
      logger.error("Failed to get BSC wallet addresses:", error.message);
      throw error;
    }
  }

  /**
   * Get transaction history for a BSC address
   */
  async getAddressTransactions(address, fromBlock = 0) {
    try {
      // Get transaction history using BscScan API
      const bscscanApiKey = process.env.BSCSCAN_API_KEY;
      const bscscanBaseUrl = this.network === "mainnet" 
        ? "https://api.bscscan.com/api"
        : "https://api-testnet.bscscan.com/api";

      if (!bscscanApiKey) {
        logger.warn("No BscScan API key provided, using limited block scanning");
        return this.scanBlocksForTransactions(address, fromBlock);
      }

      const bscscanResponse = await axios.get(
        `${bscscanBaseUrl}?module=account&action=txlist&address=${address}&startblock=${fromBlock}&endblock=latest&sort=desc&apikey=${bscscanApiKey}`
      );
      
      const data = bscscanResponse.data;
      
      if (data.status === "1") {
        return data.result;
      } else {
        logger.warn(`BscScan API error: ${data.message}`);
        return [];
      }
    } catch (error) {
      logger.error(`Failed to get BSC transactions for address ${address}:`, error.message);
      return [];
    }
  }

  /**
   * Fallback method to scan recent blocks for transactions (limited)
   */
  async scanBlocksForTransactions(address, fromBlock) {
    try {
      const latestBlock = await this.getLatestBlockNumber();
      const blocksToScan = Math.min(100, latestBlock - fromBlock); // Limit to 100 blocks
      const transactions = [];

      for (let i = 0; i < blocksToScan; i++) {
        const blockNumber = latestBlock - i;
        try {
          const block = await this.provider.getBlockWithTransactions(blockNumber);
          
          // Check each transaction in the block
          for (const tx of block.transactions) {
            if (tx.to && tx.to.toLowerCase() === address.toLowerCase()) {
              transactions.push({
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: tx.value.toString(),
                gasPrice: tx.gasPrice.toString(),
                gasUsed: tx.gasLimit.toString(),
                blockNumber: blockNumber.toString(),
                blockHash: block.hash,
                timeStamp: block.timestamp.toString(),
              });
            }
          }
        } catch (blockError) {
          logger.error(`Error scanning BSC block ${blockNumber}:`, blockError.message);
        }
      }

      return transactions;
    } catch (error) {
      logger.error("Error in BSC block scanning:", error.message);
      return [];
    }
  }

  /**
   * Check if transaction already exists in database
   */
  async transactionExists(txHash) {
    try {
      const existingTx = await Transaction.findOne({ txHash, currency: this.currency });
      return !!existingTx;
    } catch (error) {
      logger.error("Error checking BSC transaction existence:", error.message);
      return false;
    }
  }

  /**
   * Analyze BSC transaction
   */
  analyzeBscTransaction(tx, walletAddress, userId) {
    const isIncoming = tx.to && tx.to.toLowerCase() === walletAddress.toLowerCase();
    const value = ethers.BigNumber.from(tx.value);
    const gasPrice = ethers.BigNumber.from(tx.gasPrice || "0");
    const gasUsed = ethers.BigNumber.from(tx.gasUsed || tx.gas || "21000");
    const fee = gasPrice.mul(gasUsed);

    return {
      isIncoming,
      amount: value.toString(),
      fee: fee.toString(),
      fromAddress: tx.from,
      toAddress: tx.to,
      blockNumber: parseInt(tx.blockNumber),
      blockHash: tx.blockHash,
      timeStamp: parseInt(tx.timeStamp),
      gasPrice: gasPrice.toString(),
      gasUsed: gasUsed.toString(),
    };
  }

  /**
   * Create BSC transaction record in database
   */
  async createBscTransactionRecord(tx, analysis, walletData) {
    try {
      const transaction = new Transaction({
        internalId: uuidv4(),
        txHash: tx.hash,
        currency: this.currency,
        type: analysis.isIncoming ? "deposit" : "withdrawal",
        userId: walletData.userId,
        fromAddress: analysis.fromAddress,
        toAddress: analysis.toAddress,
        amount: parseFloat(ethers.utils.formatEther(analysis.amount)),
        fee: parseFloat(ethers.utils.formatEther(analysis.fee)),
        adminFee: 0, // No admin fee for incoming transactions
        netAmount: parseFloat(ethers.utils.formatEther(analysis.amount)),
        status: "confirmed", // BSC transactions are confirmed when found
        confirmations: 1,
        blockNumber: analysis.blockNumber,
        blockHash: analysis.blockHash,
        network: this.network,
        priority: "medium",
        description: "Incoming BNB transaction detected by listener",
        tags: ["auto-detected", "incoming", "bnb", "bsc"],
        inputs: [
          {
            txid: tx.hash,
            vout: 0,
            value: parseFloat(ethers.utils.formatEther(analysis.amount)),
          },
        ],
        outputs: [
          {
            address: analysis.toAddress,
            value: parseFloat(ethers.utils.formatEther(analysis.amount)),
          },
        ],
        submittedAt: new Date(analysis.timeStamp * 1000),
        processedAt: new Date(analysis.timeStamp * 1000),
        confirmedAt: new Date(analysis.timeStamp * 1000),
        metadata: {
          detectedBy: "bsc-transaction-listener",
          detectedAt: new Date(),
          gasPrice: analysis.gasPrice,
          gasUsed: analysis.gasUsed,
          rawTransaction: tx,
        },
      });

      await transaction.save();
      logger.info(
        `Created BSC transaction record for ${tx.hash}, amount: ${ethers.utils.formatEther(analysis.amount)} BNB`
      );

      return transaction;
    } catch (error) {
      logger.error(
        `Failed to create BSC transaction record for ${tx.hash}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Process transactions for a specific BSC wallet address
   */
  async processBscWalletTransactions(walletData) {
    try {
      logger.info(`Checking BSC transactions for wallet: ${walletData.bscAddress}`);

      // Get recent transactions for this address
      const transactions = await this.getAddressTransactions(
        walletData.bscAddress,
        this.lastCheckedBlock || 0
      );

      if (transactions.length === 0) {
        logger.debug(`No BSC transactions found for ${walletData.bscAddress}`);
        return;
      }

      let newTransactionsCount = 0;
      for (const tx of transactions) {
        // Check if we already have this transaction
        if (await this.transactionExists(tx.hash)) {
          logger.debug(`BSC transaction ${tx.hash} already exists, skipping`);
          continue;
        }

        // Analyze the transaction
        const analysis = this.analyzeBscTransaction(
          tx,
          walletData.bscAddress,
          walletData.userId
        );

        // Only process incoming transactions with value > 0
        if (analysis.isIncoming && ethers.BigNumber.from(analysis.amount).gt(0)) {
          logger.info(
            `New incoming BSC transaction detected: ${tx.hash}, amount: ${ethers.utils.formatEther(analysis.amount)} BNB`
          );

          // Create transaction record
          await this.createBscTransactionRecord(tx, analysis, walletData);
          newTransactionsCount++;
        }
      }

      logger.info(`Processed ${newTransactionsCount} new BSC transactions for ${walletData.bscAddress}`);
    } catch (error) {
      logger.error(
        `Error processing BSC transactions for ${walletData.bscAddress}:`,
        error.message
      );
    }
  }

  /**
   * Main listener function - scans all BSC wallet addresses for new transactions
   */
  async scanForNewBscTransactions() {
    if (this.isRunning) {
      logger.warn(
        "BSC transaction listener is already running, skipping this cycle"
      );
      return;
    }

    this.isRunning = true;
    logger.info("Starting BSC transaction listener scan...");

    try {
      // Get current block number
      const currentBlock = await this.getLatestBlockNumber();
      logger.info(`Current BSC block number: ${currentBlock}`);

      if (this.lastCheckedBlock && currentBlock <= this.lastCheckedBlock) {
        logger.info("No new BSC blocks since last check");
        this.isRunning = false;
        return;
      }

      // Get all BSC wallet addresses to monitor
      const wallets = await this.getAllBscWalletAddresses();
      logger.info(`Monitoring ${wallets.length} BSC wallet addresses`);

      if (wallets.length === 0) {
        logger.info("No active BSC wallets to monitor");
        this.isRunning = false;
        return;
      }

      // Process each wallet address
      for (const walletData of wallets) {
        try {
          await this.processBscWalletTransactions(walletData);

          // Add small delay between requests to be respectful to APIs
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(
            `Error processing BSC wallet ${walletData.bscAddress}:`,
            error.message
          );
          continue; // Continue with next wallet even if one fails
        }
      }

      // Update last checked block
      this.lastCheckedBlock = currentBlock;
      logger.info(
        `BSC transaction listener scan completed. Last checked block: ${currentBlock}`
      );
    } catch (error) {
      logger.error("Error in BSC transaction listener scan:", error);
    } finally {
      this.isRunning = false;
    }
  }
}

// Create instance
const bscTransactionListener = new BscTransactionListenerService();

/**
 * BSC Transaction Listener Cron Job
 * Runs every 2 minutes to check for new incoming BSC transactions
 */
exports.bscTransactionListenerJob = cron.schedule(
  "*/2 * * * *",
  async () => {
    logger.info("Starting BSC transaction listener job...");

    try {
      await bscTransactionListener.scanForNewBscTransactions();
      logger.info("BSC transaction listener job completed successfully");
    } catch (error) {
      logger.error("Error in BSC transaction listener job:", error);
    }
  },
  {
    scheduled: true,
    timezone: "UTC",
  }
);

// Export the service for manual testing
exports.BscTransactionListenerService = BscTransactionListenerService; 