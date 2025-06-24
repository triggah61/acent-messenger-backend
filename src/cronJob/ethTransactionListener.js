const cron = require("node-cron");
const Wallet = require("../model/Wallet");
const Transaction = require("../model/Transaction");
const logger = require("../config/logger");
const { ethers } = require("ethers");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");

/**
 * Ethereum Transaction Listener Service
 * Monitors Ethereum blockchain for incoming transactions to internal wallet addresses
 * Runs every 2 minutes to sync new transactions
 */
class EthTransactionListenerService {
  constructor() {
    this.network = process.env.ETH_NETWORK === "mainnet" ? "mainnet" : "sepolia";
    this.provider = this.initializeProvider();
    this.lastCheckedBlock = null;
    this.isRunning = false;
    this.currency = "ETH";
  }

  /**
   * Initialize Ethereum provider
   */
  initializeProvider() {
    try {
      // Use Infura, Alchemy, or public RPC
      const rpcUrl = this.network === "mainnet" 
        ? process.env.ETH_MAINNET_RPC_URL || "https://eth-mainnet.public.blastapi.io"
        : process.env.ETH_TESTNET_RPC_URL || "https://eth-sepolia.public.blastapi.io";
      
      return new ethers.providers.JsonRpcProvider(rpcUrl);
    } catch (error) {
      logger.error("Failed to initialize Ethereum provider:", error.message);
      throw error;
    }
  }

  /**
   * Get the latest block number from Ethereum blockchain
   */
  async getLatestBlockNumber() {
    try {
      return await this.provider.getBlockNumber();
    } catch (error) {
      logger.error("Failed to get latest block number:", error.message);
      throw error;
    }
  }

  /**
   * Get all active ETH wallet addresses from database
   */
  async getAllEthWalletAddresses() {
    try {
      const wallets = await Wallet.find({
        status: "active",
        network: this.network,
        ethAddress: { $exists: true, $ne: null },
      }).select("ethAddress userId");

      return wallets.map((wallet) => ({
        ethAddress: wallet.ethAddress,
        userId: wallet.userId,
        walletId: wallet._id,
      }));
    } catch (error) {
      logger.error("Failed to get ETH wallet addresses:", error.message);
      throw error;
    }
  }

  /**
   * Get transaction history for an Ethereum address
   */
  async getAddressTransactions(address, fromBlock = 0) {
    try {
      // Get transaction history using Etherscan API or similar
      const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
      const etherscanBaseUrl = this.network === "mainnet" 
        ? "https://api.etherscan.io/api"
        : "https://api-sepolia.etherscan.io/api";

      if (!etherscanApiKey) {
        logger.warn("No Etherscan API key provided, using limited block scanning");
        return this.scanBlocksForTransactions(address, fromBlock);
      }

      const etherscanResponse = await axios.get(
        `${etherscanBaseUrl}?module=account&action=txlist&address=${address}&startblock=${fromBlock}&endblock=latest&sort=desc&apikey=${etherscanApiKey}`
      );
      
      const data = etherscanResponse.data;
      
      if (data.status === "1") {
        return data.result;
      } else {
        logger.warn(`Etherscan API error: ${data.message}`);
        return [];
      }
    } catch (error) {
      logger.error(`Failed to get ETH transactions for address ${address}:`, error.message);
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
          logger.error(`Error scanning block ${blockNumber}:`, blockError.message);
        }
      }

      return transactions;
    } catch (error) {
      logger.error("Error in block scanning:", error.message);
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
      logger.error("Error checking ETH transaction existence:", error.message);
      return false;
    }
  }

  /**
   * Analyze Ethereum transaction
   */
  analyzeEthTransaction(tx, walletAddress, userId) {
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
   * Create ETH transaction record in database
   */
  async createEthTransactionRecord(tx, analysis, walletData) {
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
        status: "confirmed", // ETH transactions are confirmed when found
        confirmations: 1,
        blockNumber: analysis.blockNumber,
        blockHash: analysis.blockHash,
        network: this.network,
        priority: "medium",
        description: "Incoming ETH transaction detected by listener",
        tags: ["auto-detected", "incoming", "eth"],
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
          detectedBy: "eth-transaction-listener",
          detectedAt: new Date(),
          gasPrice: analysis.gasPrice,
          gasUsed: analysis.gasUsed,
          rawTransaction: tx,
        },
      });

      await transaction.save();
      logger.info(
        `Created ETH transaction record for ${tx.hash}, amount: ${ethers.utils.formatEther(analysis.amount)} ETH`
      );

      return transaction;
    } catch (error) {
      logger.error(
        `Failed to create ETH transaction record for ${tx.hash}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Process transactions for a specific ETH wallet address
   */
  async processEthWalletTransactions(walletData) {
    try {
      logger.info(`Checking ETH transactions for wallet: ${walletData.ethAddress}`);

      // Get recent transactions for this address
      const transactions = await this.getAddressTransactions(
        walletData.ethAddress,
        this.lastCheckedBlock || 0
      );

      if (transactions.length === 0) {
        logger.debug(`No ETH transactions found for ${walletData.ethAddress}`);
        return;
      }

      let newTransactionsCount = 0;
      for (const tx of transactions) {
        // Check if we already have this transaction
        if (await this.transactionExists(tx.hash)) {
          logger.debug(`ETH transaction ${tx.hash} already exists, skipping`);
          continue;
        }

        // Analyze the transaction
        const analysis = this.analyzeEthTransaction(
          tx,
          walletData.ethAddress,
          walletData.userId
        );

        // Only process incoming transactions with value > 0
        if (analysis.isIncoming && ethers.BigNumber.from(analysis.amount).gt(0)) {
          logger.info(
            `New incoming ETH transaction detected: ${tx.hash}, amount: ${ethers.utils.formatEther(analysis.amount)} ETH`
          );

          // Create transaction record
          await this.createEthTransactionRecord(tx, analysis, walletData);
          newTransactionsCount++;
        }
      }

      logger.info(`Processed ${newTransactionsCount} new ETH transactions for ${walletData.ethAddress}`);
    } catch (error) {
      logger.error(
        `Error processing ETH transactions for ${walletData.ethAddress}:`,
        error.message
      );
    }
  }

  /**
   * Main listener function - scans all ETH wallet addresses for new transactions
   */
  async scanForNewEthTransactions() {
    if (this.isRunning) {
      logger.warn(
        "ETH transaction listener is already running, skipping this cycle"
      );
      return;
    }

    this.isRunning = true;
    logger.info("Starting ETH transaction listener scan...");

    try {
      // Get current block number
      const currentBlock = await this.getLatestBlockNumber();
      logger.info(`Current ETH block number: ${currentBlock}`);

      if (this.lastCheckedBlock && currentBlock <= this.lastCheckedBlock) {
        logger.info("No new ETH blocks since last check");
        this.isRunning = false;
        return;
      }

      // Get all ETH wallet addresses to monitor
      const wallets = await this.getAllEthWalletAddresses();
      logger.info(`Monitoring ${wallets.length} ETH wallet addresses`);

      if (wallets.length === 0) {
        logger.info("No active ETH wallets to monitor");
        this.isRunning = false;
        return;
      }

      // Process each wallet address
      for (const walletData of wallets) {
        try {
          await this.processEthWalletTransactions(walletData);

          // Add small delay between requests to be respectful to APIs
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(
            `Error processing ETH wallet ${walletData.ethAddress}:`,
            error.message
          );
          continue; // Continue with next wallet even if one fails
        }
      }

      // Update last checked block
      this.lastCheckedBlock = currentBlock;
      logger.info(
        `ETH transaction listener scan completed. Last checked block: ${currentBlock}`
      );
    } catch (error) {
      logger.error("Error in ETH transaction listener scan:", error);
    } finally {
      this.isRunning = false;
    }
  }
}

// Create instance
const ethTransactionListener = new EthTransactionListenerService();

/**
 * ETH Transaction Listener Cron Job
 * Runs every 2 minutes to check for new incoming ETH transactions
 */
exports.ethTransactionListenerJob = cron.schedule(
  "*/2 * * * *",
  async () => {
    logger.info("Starting ETH transaction listener job...");

    try {
      await ethTransactionListener.scanForNewEthTransactions();
      logger.info("ETH transaction listener job completed successfully");
    } catch (error) {
      logger.error("Error in ETH transaction listener job:", error);
    }
  },
  {
    scheduled: true,
    timezone: "UTC",
  }
);

// Export the service for manual testing
exports.EthTransactionListenerService = EthTransactionListenerService; 