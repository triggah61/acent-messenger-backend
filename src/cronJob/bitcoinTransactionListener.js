const cron = require("node-cron");
const Wallet = require("../model/Wallet");
const Transaction = require("../model/Transaction");
const BtcWalletService = require("../services/BtcWalletService");
const logger = require("../config/logger");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

/**
 * Bitcoin Transaction Listener Service
 * Monitors Bitcoin blockchain for incoming transactions to internal wallet addresses
 * Runs every minute to sync new transactions
 */
class BtcTransactionListenerService {
  constructor() {
    this.currency = "BTC";
    this.network =
      BtcWalletService.network === require("bitcoinjs-lib").networks.bitcoin
        ? "mainnet"
        : "testnet";
    this.networkPath = this.network === "mainnet" ? "" : "testnet/";
    this.lastCheckedBlock = null;
    this.isRunning = false;
  }

  /**
   * Get the latest block height from blockchain
   */
  async getLatestBlockHeight() {
    try {
      const response = await axios.get(
        `https://blockstream.info/${this.networkPath}api/blocks/tip/height`,
        { timeout: 10000 }
      );
      return response.data;
    } catch (error) {
      logger.error("Failed to get latest block height:", error.message);
      throw error;
    }
  }

  /**
   * Get all active Bitcoin wallet addresses from database
   */
  async getAllWalletAddresses() {
    try {
      const wallets = await Wallet.find({
        status: "active",
        btcAddress: { $exists: true, $ne: null },
      }).select("btcAddress userId");

      return wallets.map((wallet) => ({
        address: wallet.btcAddress,
        userId: wallet.userId,
        walletId: wallet._id,
      }));
    } catch (error) {
      logger.error("Failed to get Bitcoin wallet addresses:", error.message);
      throw error;
    }
  }

  /**
   * Get transactions for a specific address from blockchain
   */
  async getAddressTransactions(address, lastTxId = null) {
    try {
      let url = `https://blockstream.info/${this.networkPath}api/address/${address}/txs`;

      // If we have a last transaction ID, get only newer transactions
      if (lastTxId) {
        url += `?after_txid=${lastTxId}`;
      }

      const response = await axios.get(url, { timeout: 15000 });
      return response.data;
    } catch (error) {
      logger.error(
        `Failed to get transactions for address ${address}:`,
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
        // currency: this.currency,
      });
      return !!existingTx;
    } catch (error) {
      logger.error("Error checking BTC transaction existence:", error.message);
      return false;
    }
  }

  /**
   * Analyze transaction to determine if it's incoming to our wallet
   */
  analyzeTransaction(tx, walletAddress, userId) {
    const incomingOutputs = [];
    let totalIncoming = 0;

    // Check outputs to see if any send to our wallet address
    tx.vout.forEach((output, index) => {
      if (output.scriptpubkey_address === walletAddress) {
        incomingOutputs.push({
          vout: index,
          value: output.value,
          address: walletAddress,
        });
        totalIncoming += output.value;
      }
    });

    // Check if this is an outgoing transaction from our wallet
    const isOutgoing = tx.vin.some((input) => {
      // This would require checking if input addresses belong to our wallet
      // For now, we'll focus on incoming transactions
      return false;
    });

    return {
      isIncoming: totalIncoming > 0,
      isOutgoing,
      incomingAmount: totalIncoming,
      incomingOutputs,
      fromAddresses: tx.vin
        .map((input) => input.prevout?.scriptpubkey_address)
        .filter(Boolean),
      fee: tx.fee || 0,
      blockHeight: tx.status?.block_height,
      blockHash: tx.status?.block_hash,
      confirmed: tx.status?.confirmed || false,
      confirmations: tx.status?.confirmed
        ? tx.status.block_height
          ? 1
          : 0
        : 0,
    };
  }

  /**
   * Create Bitcoin transaction record in database
   */
  async createTransactionRecord(tx, analysis, walletData) {
    try {
      const transaction = new Transaction({
        internalId: uuidv4(),
        txHash: tx.txid,
        currency: "BTC",
        type: analysis.isIncoming ? "deposit" : "withdrawal",
        userId: walletData.userId,
        fromAddress: analysis.fromAddresses[0] || "external",
        toAddress: walletData.address,
        amount: BtcWalletService.toBtc(analysis.incomingAmount),
        fee: analysis.fee,
        adminFee: 0, // No admin fee for incoming transactions
        netAmount: BtcWalletService.toBtc(analysis.incomingAmount),
        status: analysis.confirmed ? "confirmed" : "processing",
        confirmations: analysis.confirmations,
        blockNumber: analysis.blockHeight,
        blockHash: analysis.blockHash,
        network: this.network,
        priority: "medium",
        description: `Incoming ${this.currency} transaction detected by listener`,
        tags: ["auto-detected", "incoming", this.currency.toLowerCase()],
        inputs: tx.vin.map((input) => ({
          txid: input.txid,
          vout: input.vout,
          value: input.prevout?.value || 0,
        })),
        outputs: analysis.incomingOutputs,
        // submittedAt: new Date(tx.status?.block_time * 1000) || new Date(),
        processedAt: analysis.confirmed
          ? new Date(tx.status?.block_time * 1000)
          : null,
        confirmedAt: analysis.confirmed
          ? new Date(tx.status?.block_time * 1000)
          : null,
        metadata: {
          detectedBy: "btc-transaction-listener",
          detectedAt: new Date(),
          rawTransaction: tx,
        },
      });

      await transaction.save();
      logger.info(
        `Created ${this.currency} transaction record for ${tx.txid}, amount: ${analysis.incomingAmount} satoshis`
      );

      return transaction;
    } catch (error) {
      console.log("Error here", error.message);
      logger.error(
        `Failed to create ${this.currency} transaction record for ${tx.txid}:`,
        error.message
      );
      throw new AppError(error.message, 500);
    }
  }

  /**
   * Process transactions for a specific wallet
   */
  async processWalletTransactions(walletData) {
    try {
      const transactions = await this.getAddressTransactions(
        walletData.address
      );

      if (!transactions || transactions.length === 0) {
        return 0;
      }

      let processedCount = 0;

      for (const tx of transactions) {
        try {
          // Skip if we've already processed this transaction
          if (await this.transactionExists(tx.txid)) {
            continue;
          }

          // Analyze the transaction
          const analysis = this.analyzeTransaction(
            tx,
            walletData.address,
            walletData.userId
          );

          await this.createTransactionRecord(tx, analysis, walletData);
        } catch (error) {
          logger.error(
            `Error processing transaction ${tx.txid}:`,
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
      logger.warn(
        `${this.currency} transaction listener is already running, skipping...`
      );
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

    return 0;
  }

  /**
   * Start the cron job for monitoring transactions
   */
  startMonitoring() {
    // Run every minute for BTC transactions
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
    logger.info(
      `${this.currency} transaction listener started - running every minute`
    );
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
const btcTransactionListener = new BtcTransactionListenerService();

// Export functions for external use
module.exports = {
  btcTransactionListenerJob: btcTransactionListener.startMonitoring(),
  triggerBtcScan: async () =>
    await btcTransactionListener.scanForNewTransactions(),
  getBtcWalletAddresses: () => btcTransactionListener.getAllWalletAddresses(),
  btcTransactionListener,
};
