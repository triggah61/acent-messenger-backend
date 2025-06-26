const bitcoin = require("bitcoinjs-lib");
const bip39 = require("bip39");
const { BIP32Factory } = require("bip32");
const eccLib = require("tiny-secp256k1");
const { ECPairFactory } = require("ecpair");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const Wallet = require("../model/Wallet");
const Transaction = require("../model/Transaction");
const AppError = require("../exception/AppError");

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
const ECPair = ECPairFactory(ecc);

/**
 * Bitcoin Wallet Service
 * Handles all Bitcoin-specific wallet operations
 */
class BtcWalletService {
  constructor() {
    this.currency = "BTC";
    this.network =
      process.env.BITCOIN_NETWORK === "mainnet"
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;

    // QuickNode endpoints configuration
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

    // Platform fee configuration
    this.adminWalletAddress = process.env.ADMIN_WALLET_ADDRESS;
    this.platformFeePercentage =
      parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.005;
    this.minimumPlatformFee =
      parseInt(process.env.MINIMUM_PLATFORM_FEE) || 1000;
  }

  /**
   * Generate Bitcoin address from HD wallet
   */
  generateAddress(hdRoot) {
    const coinType = this.network === bitcoin.networks.bitcoin ? 0 : 1;
    const derivationPath = `m/44'/${coinType}'/0'/0/0`;
    const child = hdRoot.derivePath(derivationPath);

    // Generate SegWit address (P2WPKH)
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: child.publicKey,
      network: this.network,
    });

    return {
      address,
      publicKey: child.publicKey.toString("hex"),
      privateKeyWIF: child.toWIF(),
      derivationPath,
    };
  }

  toSatoshi(amount) {
    return amount * 100000000;
  }
  toBtc(amount) {
    return amount / 100000000;
  }

  /**
   * Get Bitcoin balance from blockchain
   */
  async getBalance(address) {
    try {
      const networkPath =
        this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      const response = await axios.get(
        `https://blockstream.info/${networkPath}api/address/${address}`
      );

      return {
        balance:
          response.data.chain_stats.funded_txo_sum -
          response.data.chain_stats.spent_txo_sum,
        unconfirmedBalance:
          response.data.mempool_stats.funded_txo_sum -
          response.data.mempool_stats.spent_txo_sum,
        totalReceived: response.data.chain_stats.funded_txo_sum,
        totalSent: response.data.chain_stats.spent_txo_sum,
        nTx: response.data.chain_stats.tx_count,
      };
    } catch (error) {
      throw new AppError(
        `Failed to get Bitcoin balance: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get UTXOs for an address
   */
  async getUTXOs(address) {
    try {
      const networkPath =
        this.network === bitcoin.networks.bitcoin ? "" : "testnet/";
      const response = await axios.get(
        `https://blockstream.info/${networkPath}api/address/${address}/utxo`,
        { timeout: 10000 }
      );

      return response.data.map((utxo) => ({
        tx_hash: utxo.txid,
        tx_output_n: utxo.vout,
        value: utxo.value,
      }));
    } catch (error) {
      throw new AppError(`Failed to get UTXOs: ${error.message}`, 500);
    }
  }

  /**
   * Calculate transaction fee
   */
  calculateTransactionFee(inputCount, outputCount, feeRate = "medium") {
    const estimatedSize = inputCount * 148 + outputCount * 34 + 10;
    const satoshisPerByte = this.feeRates[feeRate] || this.feeRates.medium;
    return Math.ceil(estimatedSize * satoshisPerByte);
  }

  /**
   * Calculate platform fee
   */
  calculatePlatformFee(amount) {
    const percentageFee = Math.floor(amount * this.platformFeePercentage);
    return Math.max(percentageFee, this.minimumPlatformFee);
  }

  /**
   * Check if amount is dust
   */
  isDustAmount(amount) {
    return amount < 546; // Standard dust threshold
  }

  /**
   * Send Bitcoin transaction
   */
  async sendTransaction(
    wallet,
    toAddress,
    amount,
    privateKeyWIF,
    priority = "medium",
    description = ""
  ) {
    try {
      const keyPair = ECPair.fromWIF(privateKeyWIF, this.network);

      // Get UTXOs
      const utxos = await this.getUTXOs(wallet.btcAddress);
      if (utxos.length === 0) {
        throw new AppError("No unspent outputs available", 400);
      }

      // Calculate fees
      const networkFee = this.calculateTransactionFee(
        utxos.length,
        2,
        priority
      );
      const platformFee = this.calculatePlatformFee(amount);
      const totalRequired = amount + networkFee + platformFee;

      // Select UTXOs
      let inputTotal = 0;
      const selectedUTXOs = [];

      for (const utxo of utxos) {
        selectedUTXOs.push(utxo);
        inputTotal += utxo.value;
        if (inputTotal >= totalRequired) break;
      }

      if (inputTotal < totalRequired) {
        throw new AppError("Insufficient funds in UTXOs", 400);
      }

      // Handle dust and fees
      let adjustedNetworkFee = networkFee;
      let shouldCreatePlatformFeeOutput = false;

      if (this.isDustAmount(platformFee)) {
        adjustedNetworkFee += platformFee;
        shouldCreatePlatformFeeOutput = false;
      } else if (platformFee > 0 && this.adminWalletAddress) {
        shouldCreatePlatformFeeOutput = true;
      }

      // Calculate change
      const change = inputTotal - amount - adjustedNetworkFee - platformFee;
      let shouldCreateChangeOutput = false;
      let adjustedChange = change;

      if (this.isDustAmount(change)) {
        adjustedNetworkFee += change;
        adjustedChange = 0;
        shouldCreateChangeOutput = false;
      } else if (change > 0) {
        shouldCreateChangeOutput = true;
      }

      // Create transaction
      const psbt = new bitcoin.Psbt({ network: this.network });

      // Add inputs
      for (const utxo of selectedUTXOs) {
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
      psbt.addOutput({ address: toAddress, value: amount });

      if (shouldCreatePlatformFeeOutput) {
        psbt.addOutput({
          address: this.adminWalletAddress,
          value: platformFee,
        });
      }

      if (shouldCreateChangeOutput) {
        psbt.addOutput({ address: wallet.btcAddress, value: adjustedChange });
      }

      // Sign inputs
      for (let i = 0; i < selectedUTXOs.length; i++) {
        const validator = (pubkey, msghash, signature) =>
          ecc.verify(msghash, pubkey, signature);
        psbt.signInput(i, keyPair, undefined, undefined, validator);
      }

      psbt.finalizeAllInputs();
      const tx = psbt.extractTransaction();
      const rawTx = tx.toHex();

      // Create transaction record
      const transaction = new Transaction({
        internalId: uuidv4(),
        currency: "BTC",
        type: "withdrawal",
        userId: wallet.userId,
        fromAddress: wallet.btcAddress,
        toAddress,
        amount: this.toBtc(amount),
        fee: this.toBtc(adjustedNetworkFee),
        adminFee: this.toBtc(platformFee),
        netAmount: this.toBtc(amount),
        status: "pending",
        network:
          this.network === bitcoin.networks.bitcoin ? "mainnet" : "testnet",
        priority,
        rawTransaction: rawTx,
        description,
        submittedAt: new Date(),
      });

      await transaction.save();

      // Broadcast transaction
      const broadcastResult = await this.broadcastTransaction(rawTx);

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
        fee: adjustedNetworkFee,
        platformFee,
        status: transaction.status,
        success: broadcastResult.success,
      };
    } catch (error) {
      throw new AppError(
        `Failed to send Bitcoin transaction: ${error.message}`,
        500
      );
    }
  }

  /**
   * Broadcast transaction to Bitcoin network
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
        headers: { "Content-Type": "application/json" },
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
   * Monitor transaction confirmations
   */
  async monitorTransactionConfirmations() {
    try {
      const pendingTransactions = await Transaction.find({
        currency: "BTC",
        status: { $in: ["pending", "processing"] },
      });

      for (const transaction of pendingTransactions) {
        if (transaction.txHash) {
          try {
            const txDetails = await this.getTransactionDetails(
              transaction.txHash
            );

            if (
              txDetails &&
              txDetails.confirmations >= 1 &&
              transaction.status !== "confirmed"
            ) {
              await transaction.markAsConfirmed(
                transaction.txHash,
                txDetails.block_height,
                txDetails.block_hash
              );
            } else if (
              txDetails &&
              txDetails.confirmations > transaction.confirmations
            ) {
              transaction.confirmations = txDetails.confirmations;
              await transaction.save();
            }
          } catch (error) {
            console.error(
              `Error monitoring BTC transaction ${transaction.txHash}:`,
              error.message
            );
          }
        }
      }
    } catch (error) {
      console.error("Error monitoring BTC transactions:", error.message);
    }
  }

  /**
   * Get transaction details
   */
  async getTransactionDetails(txHash) {
    try {
      const requestData = {
        jsonrpc: "2.0",
        id: 1,
        method: "getrawtransaction",
        params: [txHash, true],
      };

      const response = await axios.post(this.currentEndpoint, requestData, {
        headers: { "Content-Type": "application/json" },
      });

      if (!response.data.error && response.data.result) {
        return response.data.result;
      }
      return null;
    } catch (error) {
      console.error("Failed to get BTC transaction details:", error.message);
      return null;
    }
  }

  /**
   * Test Bitcoin service connection
   */
  async testConnection() {
    try {
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
        return { success: false, error: response.data.error.message };
      }

      return {
        success: true,
        currency: this.currency,
        network:
          this.network === bitcoin.networks.bitcoin ? "mainnet" : "testnet",
        chain: response.data.result.chain,
        blocks: response.data.result.blocks,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new BtcWalletService();
module.exports.BtcWalletService = BtcWalletService;
module.exports.toBtc = (amount) => amount / 100000000;
