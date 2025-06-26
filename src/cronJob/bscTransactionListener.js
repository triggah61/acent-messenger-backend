const cron = require("node-cron");
const Wallet = require("../model/Wallet");
const Transaction = require("../model/Transaction");
const BscWalletService = require("../services/BscWalletService");
const logger = require("../config/logger");
const axios = require("axios");
const { ethers } = require("ethers");
const { v4: uuidv4 } = require("uuid");

/**
 * BSC Transaction Listener Service
 * Monitors BSC blockchain for incoming transactions to internal wallet addresses
 * Runs every 2 minutes to sync new transactions
 */
class BscTransactionListenerService {
  constructor() {
    this.currency = "BNB";
    this.network = BscWalletService.network;
    this.bscscanApi = BscWalletService.bscscanApi;
    this.lastCheckedBlock = null;
    this.isRunning = false;
  }

  /**
   * Get the latest block number from BSC
   */
  async getLatestBlockNumber() {
    try {
      const provider = new ethers.JsonRpcProvider(BscWalletService.rpcUrl);
      return await provider.getBlockNumber();
    } catch (error) {
      logger.error("Failed to get latest BSC block number:", error.message);
      throw error;
    }
  }

  /**
   * Get all active BSC wallet addresses from database
   */
  async getAllWalletAddresses() {
    try {
      const wallets = await Wallet.find({
        status: "active",
        bscAddress: { $exists: true, $ne: null },
      }).select("bscAddress userId");

      return wallets.map((wallet) => ({
        address: wallet.bscAddress,
        userId: wallet.userId,
        walletId: wallet._id,
      }));
    } catch (error) {
      logger.error("Failed to get BSC wallet addresses:", error.message);
      throw error;
    }
  }

  /**
   * Get transactions for a specific address using BSCScan API
   */
  async getAddressTransactions(address, startBlock = 0) {
    try {
      if (!this.bscscanApi.apiKey) {
        logger.warn("BSCScan API key not configured, skipping BSC transaction check");
        return [];
      }

      const params = new URLSearchParams({
        module: "account",
        action: "txlist",
        address: address,
        startblock: startBlock,
        endblock: "latest",
        page: 1,
        offset: 100,
        sort: "desc",
        apikey: this.bscscanApi.apiKey,
      });

      const response = await axios.get(`${this.bscscanApi.baseUrl}?${params}`, {
        timeout: 15000,
      });

      if (response.data.status !== "1") {
        if (response.data.message === "No transactions found") {
          return [];
        }
        throw new Error(response.data.message || "BSCScan API error");
      }

      return response.data.result || [];
    } catch (error) {
      logger.error(
        `Failed to get BSC transactions for address ${address}:`,
        error.message
      );
      return [];
    }
  }

  /**
   * Check if transaction already exists in database
   */
  async transactionExists(txHash) {
    try {
      const existingTx = await Transaction.findOne({
        txHash,
        currency: this.currency,
      });
      return !!existingTx;
    } catch (error) {
      logger.error("Error checking BSC transaction existence:", error.message);
      return false;
    }
  }

  /**
   * Analyze BSC transaction to determine if it's incoming to our wallet
   */
  analyzeTransaction(tx, walletAddress) {
    const isIncoming = tx.to && tx.to.toLowerCase() === walletAddress.toLowerCase();
    const isOutgoing = tx.from && tx.from.toLowerCase() === walletAddress.toLowerCase();

    // Convert values from Wei to BNB
    const valueInBnb = parseFloat(ethers.formatEther(tx.value));
    const gasUsed = parseInt(tx.gasUsed || 0);
    const gasPrice = parseInt(tx.gasPrice || 0);
    const feeInBnb = gasUsed > 0 ? parseFloat(ethers.formatEther(BigInt(gasUsed) * BigInt(gasPrice))) : 0;

    return {
      isIncoming,
      isOutgoing,
      amount: valueInBnb,
      fee: feeInBnb,
      blockNumber: parseInt(tx.blockNumber),
      blockHash: tx.blockHash,
      confirmed: parseInt(tx.confirmations) >= 1,
      confirmations: parseInt(tx.confirmations),
      timestamp: new Date(parseInt(tx.timeStamp) * 1000),
      gasUsed,
      gasPrice: parseFloat(ethers.formatUnits(gasPrice, "gwei")),
    };
  }

  /**
   * Create BSC transaction record in database
   */
  async createTransactionRecord(tx, analysis, walletData) {
    try {
      const transaction = new Transaction({
        internalId: uuidv4(),
        txHash: tx.hash,
        currency: "BNB",
        type: analysis.isIncoming ? "deposit" : "withdrawal",
        userId: walletData.userId,
        fromAddress: tx.from || "external",
        toAddress: tx.to,
        amount: analysis.amount,
        fee: analysis.fee,
        adminFee: 0, // No admin fee for incoming transactions
        netAmount: analysis.amount,
        status: analysis.confirmed ? "confirmed" : "processing",
        confirmations: analysis.confirmations,
        blockNumber: analysis.blockNumber,
        blockHash: analysis.blockHash,
        network: this.network,
        priority: "medium",
        description: `Incoming ${this.currency} transaction detected by listener`,
        tags: ["auto-detected", "incoming", this.currency.toLowerCase()],
        submittedAt: analysis.timestamp,
        processedAt: analysis.confirmed ? analysis.timestamp : null,
        confirmedAt: analysis.confirmed ? analysis.timestamp : null,
        metadata: {
          detectedBy: "bsc-transaction-listener",
          detectedAt: new Date(),
          gasUsed: analysis.gasUsed,
          gasPrice: analysis.gasPrice + " Gwei",
          rawTransaction: tx,
        },
      });

      await transaction.save();
      logger.info(
        `Created ${this.currency} transaction record for ${tx.hash}, amount: ${analysis.amount} BNB`
      );

      return transaction;
    } catch (error) {
      logger.error(
        `Failed to create ${this.currency} transaction record for ${tx.hash}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Process transactions for a specific wallet
   */
  async processWalletTransactions(walletData) {
    try {
      // Get recent transactions for this address
      const transactions = await this.getAddressTransactions(walletData.address);

      if (!transactions || transactions.length === 0) {
        return 0;
      }

      let processedCount = 0;

      for (const tx of transactions) {
        try {
          // Skip if we've already processed this transaction
          if (await this.transactionExists(tx.hash)) {
            continue;
          }

          // Analyze the transaction
          const analysis = this.analyzeTransaction(tx, walletData.address);

          // Only create records for incoming transactions with value
          if (analysis.isIncoming && analysis.amount > 0) {
            await this.createTransactionRecord(tx, analysis, walletData);
            processedCount++;

            // Update wallet balance if transaction is confirmed
            if (analysis.confirmed) {
              try {
                // Get updated balance from blockchain
                const balanceInfo = await BscWalletService.getBalance(walletData.address);
                
                // Update wallet in database
                await Wallet.findByIdAndUpdate(walletData.walletId, {
                  $set: {
                    "balances.bnb": balanceInfo.balance,
                    lastUsed: new Date(),
                  },
                });

                logger.info(
                  `Updated wallet ${walletData.walletId} BNB balance to ${balanceInfo.balance} BNB`
                );
              } catch (balanceError) {
                logger.error(
                  `Failed to update BSC wallet balance for ${walletData.walletId}:`,
                  balanceError.message
                );
              }
            }
          }
        } catch (error) {
          logger.error(
            `Error processing BSC transaction ${tx.hash}:`,
            error.message
          );
        }
      }

      if (processedCount > 0) {
        logger.info(
          `Processed ${processedCount} new ${this.currency} transactions for wallet ${walletData.address}`
        );
      }

      return processedCount;
    } catch (error) {
      logger.error(
        `Failed to process ${this.currency} transactions for wallet ${walletData.address}:`,
        error.message
      );
      return 0;
    }
  }

  /**
   * Main function to scan for new transactions across all wallets
   */
  async scanForNewTransactions() {
    if (this.isRunning) {
      logger.warn(`${this.currency} transaction listener is already running, skipping...`);
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info(`Starting ${this.currency} transaction scan...`);

      // Get all wallet addresses
      const walletAddresses = await this.getAllWalletAddresses();

      if (walletAddresses.length === 0) {
        logger.info(`No ${this.currency} wallet addresses found for scanning`);
        return;
      }

      logger.info(
        `Scanning ${walletAddresses.length} ${this.currency} wallet addresses for new transactions`
      );

      // Process each wallet
      let totalProcessed = 0;
      for (const walletData of walletAddresses) {
        try {
          const processed = await this.processWalletTransactions(walletData);
          totalProcessed += processed;

          // Add small delay between requests to be respectful to the API
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(
            `Error processing ${this.currency} wallet ${walletData.address}:`,
            error.message
          );
        }
      }

      const duration = Date.now() - startTime;
      logger.info(
        `${this.currency} transaction scan completed in ${duration}ms. Processed ${totalProcessed} new transactions.`
      );
    } catch (error) {
      logger.error(`${this.currency} transaction scan failed:`, error.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the cron job for monitoring transactions
   */
  startMonitoring() {
    // Run every 2 minutes for BSC transactions
    const cronJob = cron.schedule(
      "*/3 * * * *",
      async () => {
        await this.scanForNewTransactions();
      },
      {
        scheduled: false,
        timezone: "UTC",
      }
    );

    cronJob.start();
    logger.info(`${this.currency} transaction listener started - running every 2 minutes`);
    return cronJob;
  }

  /**
   * Manual trigger for testing
   */
  async triggerScan() {
    logger.info(`Manually triggering ${this.currency} transaction scan...`);
    await this.scanForNewTransactions();
  }
}

// Create service instance
const bscTransactionListener = new BscTransactionListenerService();

// Export functions for external use
module.exports = {
  bscTransactionListenerJob: bscTransactionListener.startMonitoring(),
  triggerBscScan: () => bscTransactionListener.triggerScan(),
  getBscWalletAddresses: () => bscTransactionListener.getAllWalletAddresses(),
  bscTransactionListener,
}; 