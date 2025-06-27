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

const BtcWalletService = require("./BtcWalletService");
const EthWalletService = require("./EthWalletService");
const BscWalletService = require("./BscWalletService");

/**
 * Multi-Chain Wallet Service
 * Coordinates all blockchain services and provides unified wallet operations
 */
class MultiChainWalletService {
  constructor() {
    this.services = {
      BTC: BtcWalletService,
      ETH: EthWalletService,
      BNB: BscWalletService,
      BSC: BscWalletService, // Alias for BSC
    };

    this.supportedCurrencies = ["BTC", "ETH", "BNB"];

    // Use testnet for development, mainnet for production
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
   * Create a new multi-chain HD wallet for a user
   */
  async createWallet(userId, label = "Main Wallet") {
    try {
      // Generate mnemonic
      const mnemonic = this.generateMnemonic();

      // Validate mnemonic
      if (!bip39.validateMnemonic(mnemonic)) {
        throw new AppError("Invalid mnemonic phrase", 400);
      }

      // Generate seed from mnemonic
      const seed = await bip39.mnemonicToSeed(mnemonic);

      // Create HD root
      const hdRoot = bip32.fromSeed(seed);

      // Generate addresses for all supported chains
      const btcData = BtcWalletService.BtcWalletService.generateAddress(
        hdRoot,
        this.network
      );
      const ethData = EthWalletService.generateAddress(hdRoot);
      const bscData = BscWalletService.generateAddress(hdRoot);

      // Create wallet object with all three addresses
      const wallet = new Wallet({
        userId,
        btcAddress: btcData.address,
        ethAddress: ethData.address,
        bscAddress: bscData.address,
        address: btcData.address, // Keep legacy field for backward compatibility
        publicKey: btcData.publicKey, // Primary public key (Bitcoin)
        derivationPath: btcData.derivationPath, // Primary derivation path
        walletType: "main",
        network:
          BtcWalletService.network === require("bitcoinjs-lib").networks.bitcoin
            ? "mainnet"
            : "testnet",
        label,
        status: "active",
        balances: {
          btc: 0,
          eth: 0,
          bnb: 0,
        },
      });

      // Encrypt and store wallet data
      const walletEncryptionKey = process.env.WALLET_ENCRYPTION_KEY;
      wallet.encryptPrivateKey(btcData.privateKeyWIF, walletEncryptionKey);
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
          bitcoin: btcData.address,
          ethereum: ethData.address,
          bsc: bscData.address,
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
        balances: wallet.balances || { btc: 0, eth: 0, bnb: 0 },
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
   * Get wallet balance for a specific currency
   */
  async getWalletBalance(address, currency = "BTC") {
    try {
      const normalizedCurrency = currency.toUpperCase();

      if (!this.services[normalizedCurrency]) {
        throw new AppError(`Unsupported currency: ${currency}`, 400);
      }

      const service = this.services[normalizedCurrency];
      return await service.getBalance(address);
    } catch (error) {
      throw new AppError(`Failed to get wallet balance: ${error.message}`, 500);
    }
  }

  /**
   * Send transaction for a specific currency
   */
  async sendTransaction(
    fromWalletId,
    toAddress,
    amount,
    currency,
    walletEncryptionKey,
    priority = "medium",
    description = ""
  ) {
    try {
      const wallet = await Wallet.findById(fromWalletId);
      if (!wallet) {
        throw new AppError("Wallet not found", 404);
      }

      if (wallet.status !== "active") {
        throw new AppError("Wallet is not active", 400);
      }

      const normalizedCurrency = currency.toUpperCase();

      if (!this.services[normalizedCurrency]) {
        throw new AppError(`Unsupported currency: ${currency}`, 400);
      }

      const service = this.services[normalizedCurrency];

      // Get the appropriate private key for the currency
      let privateKey;
      if (normalizedCurrency === "BTC") {
        privateKey = wallet.decryptPrivateKey(walletEncryptionKey);
      } else {
        // For ETH and BSC, derive from mnemonic
        privateKey = await this.getPrivateKeyForCurrency(
          wallet,
          normalizedCurrency,
          walletEncryptionKey
        );
      }

      // Validate the destination address
      if (!service.validateAddress(toAddress)) {
        throw new AppError(
          `Invalid ${normalizedCurrency} address: ${toAddress}`,
          400
        );
      }

      // Send transaction using the appropriate service
      if (normalizedCurrency === "BTC") {
        return await service.sendTransaction(
          wallet,
          toAddress,
          amount,
          privateKey,
          priority,
          description
        );
      } else if (normalizedCurrency === "ETH") {
        // ETH service expects: wallet, toAddress, amount, privateKey, gasPrice, description, priority
        return await service.sendTransaction(
          wallet,
          toAddress,
          amount,
          privateKey,
          null, // gasPrice - let service estimate
          description,
          priority
        );
      } else if (normalizedCurrency === "BNB" || normalizedCurrency === "BSC") {
        // BSC service expects: wallet, toAddress, amount, privateKey, gasPrice, description, priority
        return await service.sendTransaction(
          wallet,
          toAddress,
          amount,
          privateKey,
          null, // gasPrice - let service estimate
          description,
          priority
        );
      } else {
        throw new AppError(`Unsupported currency: ${currency}`, 400);
      }
    } catch (error) {
      throw new AppError(
        `Failed to send ${currency} transaction: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get private key for a specific currency from wallet mnemonic
   */
  async getPrivateKeyForCurrency(wallet, currency, walletEncryptionKey) {
    try {
      const mnemonic = await wallet.decryptMnemonic(walletEncryptionKey);
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const hdRoot = bip32.fromSeed(seed);

      const normalizedCurrency = currency.toUpperCase();

      switch (normalizedCurrency) {
        case "BTC":
          return BtcWalletService.generateAddress(hdRoot, this.network)
            .privateKeyWIF;
        case "ETH":
          return EthWalletService.generateAddress(hdRoot).privateKey;
        case "BNB":
        case "BSC":
          return BscWalletService.generateAddress(hdRoot).privateKey;
        default:
          throw new AppError(`Unsupported currency: ${currency}`, 400);
      }
    } catch (error) {
      throw new AppError(
        `Failed to get private key for ${currency}: ${error.message}`,
        500
      );
    }
  }

  /**
   * Validate address for any supported currency
   */
  validateAddress(address, currency = "auto") {
    if (currency === "auto") {
      // Auto-detect currency type
      return this.supportedCurrencies.some((curr) =>
        this.services[curr].validateAddress(address)
      );
    }

    const normalizedCurrency = currency.toUpperCase();
    if (!this.services[normalizedCurrency]) {
      return false;
    }

    return this.services[normalizedCurrency].validateAddress(address);
  }

  /**
   * Monitor transaction confirmations for all currencies
   */
  async monitorTransactionConfirmations() {
    try {
      const monitoringPromises = this.supportedCurrencies.map((currency) => {
        const service = this.services[currency];
        return service.monitorTransactionConfirmations().catch((error) => {
          console.error(
            `Error monitoring ${currency} transactions:`,
            error.message
          );
        });
      });

      await Promise.all(monitoringPromises);
    } catch (error) {
      console.error(
        "Error in multi-chain transaction monitoring:",
        error.message
      );
    }
  }

  /**
   * Get transaction details for a specific currency
   */
  async getTransactionDetails(txHash, currency) {
    try {
      const normalizedCurrency = currency.toUpperCase();

      if (!this.services[normalizedCurrency]) {
        throw new AppError(`Unsupported currency: ${currency}`, 400);
      }

      const service = this.services[normalizedCurrency];
      return await service.getTransactionDetails(txHash);
    } catch (error) {
      throw new AppError(
        `Failed to get transaction details: ${error.message}`,
        500
      );
    }
  }

  /**
   * Test all service connections
   */
  async testConnection() {
    try {
      const testPromises = this.supportedCurrencies.map(async (currency) => {
        const service = this.services[currency];
        const result = await service.testConnection();
        return {
          currency,
          ...result,
        };
      });

      const results = await Promise.all(testPromises);

      const allSuccessful = results.every((result) => result.success);

      return {
        success: allSuccessful,
        services: results,
        summary: {
          total: results.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        services: [],
      };
    }
  }

  /**
   * Get supported currencies
   */
  getSupportedCurrencies() {
    return this.supportedCurrencies;
  }

  /**
   * Get service for a specific currency
   */
  getService(currency) {
    const normalizedCurrency = currency.toUpperCase();
    if (!this.services[normalizedCurrency]) {
      throw new AppError(`Unsupported currency: ${currency}`, 400);
    }
    return this.services[normalizedCurrency];
  }
}

module.exports = new MultiChainWalletService();
