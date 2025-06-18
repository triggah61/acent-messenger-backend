const cron = require('node-cron');
const bitcoinWalletService = require('../services/BitcoinWalletService');
const Wallet = require('../model/Wallet');
const Transaction = require('../model/Transaction');
const logger = require('../config/logger');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * Transaction Listener Service
 * Monitors blockchain for incoming transactions to internal wallet addresses
 * Runs every 5 minutes to sync new transactions
 */
class TransactionListenerService {
  constructor() {
    this.network = process.env.BITCOIN_NETWORK === "mainnet" ? "mainnet" : "testnet";
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
      logger.error('Failed to get latest block height:', error.message);
      throw error;
    }
  }

  /**
   * Get all active wallet addresses from database
   */
  async getAllWalletAddresses() {
    try {
      const wallets = await Wallet.find({ 
        status: 'active',
        network: this.network 
      }).select('address userId');
      
      return wallets.map(wallet => ({
        address: wallet.address,
        userId: wallet.userId,
        walletId: wallet._id
      }));
    } catch (error) {
      logger.error('Failed to get wallet addresses:', error.message);
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
      logger.error(`Failed to get transactions for address ${address}:`, error.message);
      return [];
    }
  }

  /**
   * Check if transaction already exists in database
   */
  async transactionExists(txHash) {
    try {
      const existingTx = await Transaction.findOne({ txHash });
      return !!existingTx;
    } catch (error) {
      logger.error('Error checking transaction existence:', error.message);
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
          address: walletAddress
        });
        totalIncoming += output.value;
      }
    });

    // Check if this is an outgoing transaction from our wallet
    const isOutgoing = tx.vin.some(input => {
      // This would require checking if input addresses belong to our wallet
      // For now, we'll focus on incoming transactions
      return false;
    });

    return {
      isIncoming: totalIncoming > 0,
      isOutgoing,
      incomingAmount: totalIncoming,
      incomingOutputs,
      fromAddresses: tx.vin.map(input => input.prevout?.scriptpubkey_address).filter(Boolean),
      fee: tx.fee || 0,
      blockHeight: tx.status?.block_height,
      blockHash: tx.status?.block_hash,
      confirmed: tx.status?.confirmed || false,
      confirmations: tx.status?.confirmed ? (tx.status.block_height ? 1 : 0) : 0
    };
  }

  /**
   * Create transaction record in database
   */
  async createTransactionRecord(tx, analysis, walletData) {
    try {
      const transaction = new Transaction({
        internalId: uuidv4(),
        txHash: tx.txid,
        type: analysis.isIncoming ? 'deposit' : 'withdrawal',
        userId: walletData.userId,
        fromAddress: analysis.fromAddresses[0] || 'external',
        toAddress: walletData.address,
        amount: analysis.incomingAmount,
        fee: analysis.fee,
        adminFee: 0, // No admin fee for incoming transactions
        netAmount: analysis.incomingAmount,
        status: analysis.confirmed ? 'confirmed' : 'processing',
        confirmations: analysis.confirmations,
        blockNumber: analysis.blockHeight,
        blockHash: analysis.blockHash,
        network: this.network,
        priority: 'medium',
        description: 'Incoming transaction detected by listener',
        tags: ['auto-detected', 'incoming'],
        inputs: tx.vin.map(input => ({
          txid: input.txid,
          vout: input.vout,
          value: input.prevout?.value || 0
        })),
        outputs: analysis.incomingOutputs,
        submittedAt: new Date(tx.status?.block_time * 1000) || new Date(),
        processedAt: analysis.confirmed ? new Date(tx.status?.block_time * 1000) : null,
        confirmedAt: analysis.confirmed ? new Date(tx.status?.block_time * 1000) : null,
        metadata: {
          detectedBy: 'transaction-listener',
          detectedAt: new Date(),
          rawTransaction: tx
        }
      });

      await transaction.save();
      logger.info(`Created transaction record for ${tx.txid}, amount: ${analysis.incomingAmount} satoshis`);
      
      return transaction;
    } catch (error) {
      logger.error(`Failed to create transaction record for ${tx.txid}:`, error.message);
      throw error;
    }
  }

  /**
   * Update wallet balance after new transaction
   */
  async updateWalletBalance(walletId) {
    try {
      const wallet = await Wallet.findById(walletId);
      if (!wallet) {
        logger.error(`Wallet not found: ${walletId}`);
        return;
      }

      // Get live balance from blockchain
      const balanceInfo = await bitcoinWalletService.getWalletBalance(wallet.address);
      
      // Update wallet balance in database
      await wallet.updateBalance(balanceInfo.balance);
      
      logger.info(`Updated balance for wallet ${wallet.address}: ${balanceInfo.balance} satoshis`);
      
      return balanceInfo;
    } catch (error) {
      logger.error(`Failed to update wallet balance for ${walletId}:`, error.message);
    }
  }

  /**
   * Process transactions for a specific wallet address
   */
  async processWalletTransactions(walletData) {
    try {
      logger.info(`Checking transactions for wallet: ${walletData.address}`);

      // Get recent transactions for this address
      const transactions = await this.getAddressTransactions(walletData.address);
      
      if (transactions.length === 0) {
        logger.debug(`No transactions found for ${walletData.address}`);
        return;
      }

      let newTransactionsCount = 0;
      let updatedBalance = false;

      for (const tx of transactions) {
        // Check if we already have this transaction
        if (await this.transactionExists(tx.txid)) {
          logger.debug(`Transaction ${tx.txid} already exists, skipping`);
          continue;
        }

        // Analyze the transaction
        const analysis = this.analyzeTransaction(tx, walletData.address, walletData.userId);

        // Only process incoming transactions
        if (analysis.isIncoming && analysis.incomingAmount > 0) {
          logger.info(`New incoming transaction detected: ${tx.txid}, amount: ${analysis.incomingAmount} satoshis`);

          // Create transaction record
          await this.createTransactionRecord(tx, analysis, walletData);
          newTransactionsCount++;
          updatedBalance = true;
        }
      }

      // Update wallet balance if we found new transactions
      if (updatedBalance) {
        await this.updateWalletBalance(walletData.walletId);
        logger.info(`Processed ${newTransactionsCount} new transactions for ${walletData.address}`);
      }

    } catch (error) {
      logger.error(`Error processing transactions for ${walletData.address}:`, error.message);
    }
  }

  /**
   * Main listener function - scans all wallet addresses for new transactions
   */
  async scanForNewTransactions() {
    if (this.isRunning) {
      logger.warn('Transaction listener is already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    logger.info('Starting transaction listener scan...');

    try {
      // Get current block height
      const currentBlock = await this.getLatestBlockHeight();
      logger.info(`Current block height: ${currentBlock}`);

      if (this.lastCheckedBlock && currentBlock <= this.lastCheckedBlock) {
        logger.info('No new blocks since last check');
        this.isRunning = false;
        return;
      }

      // Get all wallet addresses to monitor
      const wallets = await getAllWalletAddresses();
      logger.info(`Monitoring ${wallets.length} wallet addresses`);

      if (wallets.length === 0) {
        logger.info('No active wallets to monitor');
        this.isRunning = false;
        return;
      }

      // Process each wallet address
      let totalNewTransactions = 0;
      for (const walletData of wallets) {
        try {
          await this.processWalletTransactions(walletData);
          
          // Add small delay between requests to be respectful to the API
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          logger.error(`Error processing wallet ${walletData.address}:`, error.message);
          continue; // Continue with next wallet even if one fails
        }
      }

      // Update last checked block
      this.lastCheckedBlock = currentBlock;
      logger.info(`Transaction listener scan completed. Last checked block: ${currentBlock}`);

    } catch (error) {
      logger.error('Error in transaction listener scan:', error);
    } finally {
      this.isRunning = false;
    }
  }
}

// Create instance
const transactionListener = new TransactionListenerService();

// Fix the getAllWalletAddresses function scope
const getAllWalletAddresses = () => transactionListener.getAllWalletAddresses();

/**
 * Transaction Listener Cron Job
 * Runs every 5 minutes to check for new incoming transactions
 */
exports.transactionListenerJob = cron.schedule('*/5 * * * *', async () => {
  logger.info('Starting transaction listener job...');
  
  try {
    await transactionListener.scanForNewTransactions();
    logger.info('Transaction listener job completed successfully');
  } catch (error) {
    logger.error('Error in transaction listener job:', error);
  }
}, {
  scheduled: true,
  timezone: 'UTC'
});

// Export the service for manual testing
exports.TransactionListenerService = TransactionListenerService; 