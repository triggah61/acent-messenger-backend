const { google } = require("googleapis");
const AppError = require("../exception/AppError");
const fs = require("fs");
const path = require("path");

/**
 * Google Play Billing Service
 * Handles verification of Google Play subscription and one-time purchases
 */
class GooglePlayBillingService {
  constructor() {
    this.androidPublisher = null;
    this.packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.qmessenger.app";
    this.useSandbox = process.env.GOOGLE_PLAY_USE_SANDBOX === "true";
    this.isInitialized = false;
  }

  /**
   * Initialize Google Play API client
   */
  async initialize() {
    if (this.isInitialized && this.androidPublisher) {
      return;
    }

    try {
      const serviceAccountEmail =
        process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
      const serviceAccountKeyPath =
        process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_PATH;

      if (!serviceAccountEmail || !serviceAccountKeyPath) {
        console.warn(
          "GooglePlayBillingService: Service account credentials not configured. Google Play verification will be disabled."
        );
        return;
      }

      // Check if service account key file exists
      const keyPath = path.resolve(serviceAccountKeyPath);
      if (!fs.existsSync(keyPath)) {
        console.warn(
          `GooglePlayBillingService: Service account key file not found at ${keyPath}. Google Play verification will be disabled.`
        );
        return;
      }

      // Read service account key
      const serviceAccountKey = JSON.parse(fs.readFileSync(keyPath, "utf8"));

      // Create JWT client
      const jwtClient = new google.auth.JWT(
        serviceAccountEmail,
        null,
        serviceAccountKey.private_key,
        ["https://www.googleapis.com/auth/androidpublisher"],
        null
      );

      // Authenticate
      await jwtClient.authorize();

      // Create Android Publisher API client
      this.androidPublisher = google.androidpublisher({
        version: "v3",
        auth: jwtClient,
      });

      this.isInitialized = true;
      console.log("GooglePlayBillingService: ✅ Initialized successfully");
    } catch (error) {
      console.error("GooglePlayBillingService: ❌ Initialization failed:", error);
      throw new AppError(
        "Google Play Billing service initialization failed",
        500
      );
    }
  }

  /**
   * Verify subscription purchase
   * @param {String} purchaseToken - Purchase token from Google Play
   * @param {String} subscriptionId - Subscription product ID
   * @returns {Promise<Object>} Purchase details
   */
  async verifySubscription(purchaseToken, subscriptionId) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized. Please configure service account credentials.",
        503
      );
    }

    try {
      const response = await this.androidPublisher.purchases.subscriptions.get({
        packageName: this.packageName,
        subscriptionId: subscriptionId,
        token: purchaseToken,
      });

      const purchase = response.data;

      // Check if purchase is valid
      if (!purchase || !purchase.expiryTimeMillis) {
        throw new AppError("Invalid subscription purchase", 400);
      }

      // Check if subscription is active
      const expiryTime = parseInt(purchase.expiryTimeMillis);
      const currentTime = Date.now();
      const isActive = expiryTime > currentTime;

      return {
        valid: true,
        active: isActive,
        purchaseToken: purchaseToken,
        orderId: purchase.orderId || null,
        purchaseType: purchase.purchaseType || 0,
        autoRenewing: purchase.autoRenewing === true,
        expiryTimeMillis: expiryTime,
        startTimeMillis: parseInt(purchase.startTimeMillis || 0),
        cancelReason: purchase.cancelReason || null,
        userCancellationTimeMillis: purchase.userCancellationTimeMillis
          ? parseInt(purchase.userCancellationTimeMillis)
          : null,
        acknowledgementState: purchase.acknowledgementState || 0,
        kind: purchase.kind || null,
      };
    } catch (error) {
      console.error(
        "GooglePlayBillingService: Subscription verification error:",
        error
      );

      if (error.response && error.response.status === 410) {
        // Purchase token is no longer valid (expired or refunded)
        throw new AppError("Purchase token is no longer valid", 410);
      } else if (error.response && error.response.status === 404) {
        // Purchase not found
        throw new AppError("Purchase not found", 404);
      } else {
        throw new AppError(
          `Subscription verification failed: ${error.message}`,
          500
        );
      }
    }
  }

  /**
   * Verify one-time purchase
   * @param {String} purchaseToken - Purchase token from Google Play
   * @param {String} productId - Product ID
   * @returns {Promise<Object>} Purchase details
   */
  async verifyOneTimePurchase(purchaseToken, productId) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized. Please configure service account credentials.",
        503
      );
    }

    try {
      const response = await this.androidPublisher.purchases.products.get({
        packageName: this.packageName,
        productId: productId,
        token: purchaseToken,
      });

      const purchase = response.data;

      // Check if purchase is valid
      if (!purchase) {
        throw new AppError("Invalid purchase", 400);
      }

      // Check purchase state
      // 0: Purchased, 1: Canceled
      const purchaseState = purchase.purchaseState || 0;
      const isPurchased = purchaseState === 0;

      return {
        valid: true,
        purchased: isPurchased,
        purchaseToken: purchaseToken,
        orderId: purchase.orderId || null,
        purchaseState: purchaseState,
        consumptionState: purchase.consumptionState || 0,
        purchaseTimeMillis: purchase.purchaseTimeMillis
          ? parseInt(purchase.purchaseTimeMillis)
          : null,
        acknowledgementState: purchase.acknowledgementState || 0,
        kind: purchase.kind || null,
      };
    } catch (error) {
      console.error(
        "GooglePlayBillingService: One-time purchase verification error:",
        error
      );

      if (error.response && error.response.status === 410) {
        // Purchase token is no longer valid (expired or refunded)
        throw new AppError("Purchase token is no longer valid", 410);
      } else if (error.response && error.response.status === 404) {
        // Purchase not found
        throw new AppError("Purchase not found", 404);
      } else {
        throw new AppError(
          `One-time purchase verification failed: ${error.message}`,
          500
        );
      }
    }
  }

  /**
   * Acknowledge subscription purchase
   * @param {String} purchaseToken - Purchase token
   * @param {String} subscriptionId - Subscription product ID
   * @returns {Promise<Boolean>} Success status
   */
  async acknowledgeSubscription(purchaseToken, subscriptionId) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized",
        503
      );
    }

    try {
      await this.androidPublisher.purchases.subscriptions.acknowledge({
        packageName: this.packageName,
        subscriptionId: subscriptionId,
        token: purchaseToken,
        requestBody: {},
      });

      return true;
    } catch (error) {
      console.error(
        "GooglePlayBillingService: Acknowledge subscription error:",
        error
      );
      throw new AppError(
        `Failed to acknowledge subscription: ${error.message}`,
        500
      );
    }
  }

  /**
   * Acknowledge one-time purchase
   * @param {String} purchaseToken - Purchase token
   * @param {String} productId - Product ID
   * @returns {Promise<Boolean>} Success status
   */
  async acknowledgeOneTimePurchase(purchaseToken, productId) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized",
        503
      );
    }

    try {
      await this.androidPublisher.purchases.products.acknowledge({
        packageName: this.packageName,
        productId: productId,
        token: purchaseToken,
        requestBody: {},
      });

      return true;
    } catch (error) {
      console.error(
        "GooglePlayBillingService: Acknowledge one-time purchase error:",
        error
      );
      throw new AppError(
        `Failed to acknowledge purchase: ${error.message}`,
        500
      );
    }
  }

  /**
   * Consume one-time purchase (for consumable products)
   * @param {String} purchaseToken - Purchase token
   * @param {String} productId - Product ID
   * @returns {Promise<Boolean>} Success status
   */
  async consumePurchase(purchaseToken, productId) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized",
        503
      );
    }

    try {
      await this.androidPublisher.purchases.products.consume({
        packageName: this.packageName,
        productId: productId,
        token: purchaseToken,
      });

      return true;
    } catch (error) {
      console.error(
        "GooglePlayBillingService: Consume purchase error:",
        error
      );
      throw new AppError(`Failed to consume purchase: ${error.message}`, 500);
    }
  }

  /**
   * Get product ID based on environment (sandbox or production)
   * @param {String} productionId - Production product ID
   * @param {String} sandboxId - Sandbox product ID
   * @returns {String} Product ID to use
   */
  getProductId(productionId, sandboxId) {
    if (this.useSandbox && sandboxId) {
      return sandboxId;
    }
    return productionId;
  }

  /**
   * Generate regional configs for all major Google Play regions
   * This ensures subscriptions are available worldwide, not just in one country
   * @param {Number} priceAmountMicros - Price in micros (e.g., 9990000 for $9.99)
   * @param {String} priceCurrencyCode - Currency code (e.g., 'USD')
   * @returns {Array} Array of regional config objects
   */
  _generateAllRegionsConfig(priceAmountMicros, priceCurrencyCode = 'USD') {
    // List of major Google Play regions
    // Using USD as base currency - Google Play will handle currency conversion
    const regions = [
      'US', // United States
      'GB', // United Kingdom
      'CA', // Canada
      'AU', // Australia
      'DE', // Germany
      'FR', // France
      'ES', // Spain
      'IT', // Italy
      'NL', // Netherlands
      'BE', // Belgium
      'AT', // Austria
      'CH', // Switzerland
      'SE', // Sweden
      'NO', // Norway
      'DK', // Denmark
      'FI', // Finland
      'IE', // Ireland
      'PT', // Portugal
      'PL', // Poland
      'CZ', // Czech Republic
      'HU', // Hungary
      'RO', // Romania
      'BG', // Bulgaria
      'HR', // Croatia
      'SK', // Slovakia
      'SI', // Slovenia
      'GR', // Greece
      'JP', // Japan
      'KR', // South Korea
      'TW', // Taiwan
      'HK', // Hong Kong
      'SG', // Singapore
      'MY', // Malaysia
      'TH', // Thailand
      'ID', // Indonesia
      'PH', // Philippines
      'VN', // Vietnam
      'IN', // India
      'PK', // Pakistan
      'BD', // Bangladesh
      'AE', // United Arab Emirates
      'SA', // Saudi Arabia
      'EG', // Egypt
      'ZA', // South Africa
      'NG', // Nigeria
      'KE', // Kenya
      'BR', // Brazil
      'MX', // Mexico
      'AR', // Argentina
      'CL', // Chile
      'CO', // Colombia
      'PE', // Peru
      'NZ', // New Zealand
      'RU', // Russia
      'UA', // Ukraine
      'TR', // Turkey
      'IL', // Israel
    ];

    const priceUnits = Math.floor(priceAmountMicros / 1000000).toString();
    const priceNanos = (priceAmountMicros % 1000000) * 1000;

    return regions.map(regionCode => ({
      regionCode: regionCode,
      newSubscriberAvailability: true,
      price: {
        currencyCode: priceCurrencyCode,
        units: priceUnits,
        nanos: priceNanos,
      },
    }));
  }

  /**
   * Generate a valid product ID from plan name
   * Google Play subscription product IDs can contain: lowercase letters, numbers, underscores (_), and periods (.)
   * NOTE: Hyphens (-) are NOT allowed in subscription product IDs, only in base plan IDs
   * @param {String} planName - Plan name
   * @param {String} billingPeriod - 'monthly' or 'annual'
   * @returns {String} Valid product ID
   */
  generateProductId(planName, billingPeriod = 'monthly') {
    // Clean the plan name: convert to lowercase, replace non-alphanumeric with underscores
    // Google Play subscription product IDs must use underscores, not hyphens
    const cleanName = planName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    const suffix = billingPeriod === 'annual' ? '_annual' : '_monthly';
    
    // Return product ID with underscores (e.g., 'test_monthly')
    // Base plan IDs will convert underscores to hyphens later
    return `${cleanName}${suffix}`;
  }

  /**
   * Create a subscription product in Google Play Console
   * @param {Object} subscriptionData - Subscription details
   * @param {String} subscriptionData.productId - Unique product ID
   * @param {String} subscriptionData.name - Display name
   * @param {String} subscriptionData.description - Description
   * @param {Number} subscriptionData.priceAmountMicros - Price in micros (price * 1,000,000)
   * @param {String} subscriptionData.priceCurrencyCode - Currency code (e.g., 'USD')
   * @param {String} subscriptionData.billingPeriod - 'P1M' for monthly, 'P1Y' for yearly
   * @returns {Promise<Object>} Created subscription details
   */
  async createSubscription(subscriptionData) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized. Please configure service account credentials.",
        503
      );
    }

    const {
      productId,
      name,
      description,
      priceAmountMicros,
      priceCurrencyCode = 'USD',
      billingPeriod = 'P1M', // P1M = monthly, P1Y = yearly
    } = subscriptionData;

    try {
      console.log(`GooglePlayBillingService: Creating subscription ${productId} with base plan...`);

      // Create base plan ID
      // Base plan IDs can only contain lowercase letters, numbers, and hyphens (no underscores)
      // Convert underscores in productId to hyphens for base plan ID
      const basePlanId = `${productId.replace(/_/g, '-')}-baseplan`;

      // Create the subscription WITH base plan included
      // Google Play API now requires at least one base plan to be included when creating a subscription
      const subscriptionResponse = await this.androidPublisher.monetization.subscriptions.create({
        packageName: this.packageName,
        productId: productId,
        'regionsVersion.version': '2025/02', // Latest regions version from Google Play
        requestBody: {
          packageName: this.packageName,
          productId: productId,
          listings: [
            {
              languageCode: 'en-GB', // Default language of the app in Google Play Console
              title: name,
              description: description || name,
              benefits: [],
            },
            {
              languageCode: 'en-US', // Also include US English
              title: name,
              description: description || name,
              benefits: [],
            },
          ],
          // Include base plan in the subscription creation
          basePlans: [
            {
              basePlanId: basePlanId,
              state: 'ACTIVE', // Create as active directly
              autoRenewingBasePlanType: {
                billingPeriodDuration: billingPeriod,
                gracePeriodDuration: 'P3D', // 3 days grace period
                resubscribeState: 'RESUBSCRIBE_STATE_ACTIVE',
                prorationMode: 'SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE', // Correct enum value with SUBSCRIPTION_ prefix
              },
              // Make subscription available in ALL regions where Google Play operates
              // This ensures users in any country can subscribe
              regionalConfigs: this._generateAllRegionsConfig(priceAmountMicros, priceCurrencyCode),
            },
          ],
        },
      });

      console.log(`GooglePlayBillingService: ✅ Subscription ${productId} created, activating base plan...`);

      // Activate the base plan to make it available for purchase
      await this.androidPublisher.monetization.subscriptions.basePlans.activate({
        packageName: this.packageName,
        productId: productId,
        basePlanId: basePlanId,
      });

      console.log(`GooglePlayBillingService: ✅ Base plan activated successfully for ${productId}`);

      return {
        success: true,
        productId: productId,
        basePlanId: basePlanId,
        subscription: subscriptionResponse.data,
      };
    } catch (error) {
      console.error(`GooglePlayBillingService: ❌ Failed to create subscription ${productId}:`, error);

      // Check if subscription already exists
      if (error.response && error.response.status === 409) {
        console.log(`GooglePlayBillingService: Subscription ${productId} already exists, attempting to update...`);
        return await this.updateSubscription(subscriptionData);
      }

      throw new AppError(
        `Failed to create subscription in Google Play: ${error.message}`,
        500
      );
    }
  }

  /**
   * Update an existing subscription in Google Play Console
   * @param {Object} subscriptionData - Subscription details
   * @returns {Promise<Object>} Updated subscription details
   */
  async updateSubscription(subscriptionData) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized",
        503
      );
    }

    const { productId, name, description } = subscriptionData;

    try {
      console.log(`GooglePlayBillingService: Updating subscription ${productId}...`);

      const response = await this.androidPublisher.monetization.subscriptions.patch({
        packageName: this.packageName,
        productId: productId,
        updateMask: 'listings',
        'regionsVersion.version': '2025/02', // Latest regions version from Google Play
        requestBody: {
          packageName: this.packageName,
          productId: productId,
          listings: [
            {
              languageCode: 'en-GB', // Default language of the app in Google Play Console (required)
              title: name,
              description: description || name,
              benefits: [],
            },
            {
              languageCode: 'en-US', // Also include US English
              title: name,
              description: description || name,
              benefits: [],
            },
          ],
        },
      });

      console.log(`GooglePlayBillingService: ✅ Subscription ${productId} updated successfully`);

      return {
        success: true,
        productId: productId,
        subscription: response.data,
      };
    } catch (error) {
      console.error(`GooglePlayBillingService: ❌ Failed to update subscription ${productId}:`, error);
      throw new AppError(
        `Failed to update subscription in Google Play: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get subscription details from Google Play Console
   * @param {String} productId - Product ID
   * @returns {Promise<Object>} Subscription details
   */
  async getSubscriptionDetails(productId) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized",
        503
      );
    }

    try {
      const response = await this.androidPublisher.monetization.subscriptions.get({
        packageName: this.packageName,
        productId: productId,
      });

      return {
        success: true,
        subscription: response.data,
      };
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return { success: false, exists: false };
      }
      throw new AppError(
        `Failed to get subscription details: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete/archive a subscription from Google Play Console
   * Note: Subscriptions cannot be fully deleted, only archived
   * @param {String} productId - Product ID
   * @returns {Promise<Boolean>} Success status
   */
  async archiveSubscription(productId) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized",
        503
      );
    }

    try {
      console.log(`GooglePlayBillingService: Archiving subscription ${productId}...`);

      await this.androidPublisher.monetization.subscriptions.delete({
        packageName: this.packageName,
        productId: productId,
      });

      console.log(`GooglePlayBillingService: ✅ Subscription ${productId} archived successfully`);
      return true;
    } catch (error) {
      console.error(`GooglePlayBillingService: ❌ Failed to archive subscription ${productId}:`, error);
      throw new AppError(
        `Failed to archive subscription: ${error.message}`,
        500
      );
    }
  }

  /**
   * Create a one-time (in-app) product in Google Play Console
   * 
   * NOTE: As of December 2024, Google has deprecated the old inappproducts API
   * and the new API endpoints are not yet available in the googleapis Node.js library.
   * This method will throw an error indicating manual creation is required.
   * 
   * @param {Object} productData - Product details
   * @param {String} productData.productId - Unique product ID
   * @param {String} productData.name - Display name
   * @param {String} productData.description - Description
   * @param {Number} productData.priceAmountMicros - Price in micros
   * @param {String} productData.priceCurrencyCode - Currency code
   * @returns {Promise<Object>} Created product details
   */
  async createInAppProduct(productData) {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized",
        503
      );
    }

    const {
      productId,
      name,
      description,
      priceAmountMicros,
      priceCurrencyCode = 'USD',
    } = productData;

    console.log(`GooglePlayBillingService: ⚠️  In-app product creation via API is not available`);
    console.log(`   - Google has deprecated the old inappproducts API`);
    console.log(`   - The new API endpoints are not yet available in googleapis Node.js library`);
    console.log(`   - Manual creation in Google Play Console is required`);
    console.log(`   - Product ID to create: ${productId}`);
    console.log(`   - Price: $${(priceAmountMicros / 1000000).toFixed(2)} ${priceCurrencyCode}`);
    console.log(`   - Name: ${name}`);
    console.log(`   - Description: ${description || name}`);
    console.log(`   - See GOOGLE_PLAY_INAPP_PRODUCTS_MANUAL_GUIDE.md for instructions`);

    // Return a structured error that indicates manual creation is needed
    throw new AppError(
      `API Not Available: Automatic in-app product creation is not available due to Google API changes. ` +
      `Please create the product manually in Google Play Console:\n\n` +
      `📋 Product Details:\n` +
      `   • Product ID: ${productId}\n` +
      `   • Price: $${(priceAmountMicros / 1000000).toFixed(2)} ${priceCurrencyCode}\n` +
      `   • Name: ${name}\n` +
      `   • Description: ${description || name}\n` +
      `   • Type: Consumable\n\n` +
      `📝 Steps:\n` +
      `1. Go to Play Console → Your App → Monetize → Products → In-app products\n` +
      `2. Click "Create product"\n` +
      `3. Enter Product ID: ${productId}\n` +
      `4. Set price: $${(priceAmountMicros / 1000000).toFixed(2)}\n` +
      `5. Set name and description\n` +
      `6. Set type to "Consumable"\n` +
      `7. Activate the product\n\n` +
      `✅ The package is saved in your database and will work once you create the product in Play Console.\n` +
      `📖 See GOOGLE_PLAY_INAPP_PRODUCTS_MANUAL_GUIDE.md for detailed instructions.`,
      503 // Service Unavailable
    );
  }

  /**
   * List all subscriptions in Google Play Console
   * @returns {Promise<Array>} List of subscriptions
   */
  async listSubscriptions() {
    if (!this.isInitialized || !this.androidPublisher) {
      throw new AppError(
        "Google Play Billing service not initialized",
        503
      );
    }

    try {
      const response = await this.androidPublisher.monetization.subscriptions.list({
        packageName: this.packageName,
      });

      return response.data.subscriptions || [];
    } catch (error) {
      console.error(`GooglePlayBillingService: ❌ Failed to list subscriptions:`, error);
      throw new AppError(
        `Failed to list subscriptions: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get subscription product ID from Google Play (if it exists)
   * This helps us find the actual ID Google Play created, which might differ from what we generated
   * @param {String} generatedProductId - The product ID we generated (with underscores)
   * @returns {Promise<String|null>} The actual product ID from Google Play, or null if not found
   */
  async getSubscriptionProductId(generatedProductId) {
    if (!this.isInitialized || !this.androidPublisher) {
      return null;
    }

    try {
      // Try to get the subscription with the generated ID (using underscores)
      const subscription = await this.androidPublisher.monetization.subscriptions.get({
        packageName: this.packageName,
        productId: generatedProductId,
      });
      
      if (subscription.data && subscription.data.productId) {
        return subscription.data.productId;
      }
    } catch (error) {
      // Subscription doesn't exist with this ID
      // Note: We no longer check for hyphenated versions since Google Play doesn't allow hyphens in subscription product IDs
    }
    
    return null;
  }

  /**
   * Sync subscription plan to Google Play
   * Creates both monthly and annual subscriptions if applicable
   * @param {Object} plan - Subscription plan from database
   * @returns {Promise<Object>} Sync result with created product IDs
   */
  async syncSubscriptionPlan(plan) {
    if (!this.isInitialized || !this.androidPublisher) {
      console.warn("GooglePlayBillingService: Service not initialized, skipping sync");
      return { success: false, reason: "Service not initialized" };
    }

    const results = {
      success: true,
      monthlyProductId: null,
      annualProductId: null,
      errors: [],
    };

    // Skip custom plans
    if (plan.isCustom) {
      console.log(`GooglePlayBillingService: Skipping custom plan ${plan.name}`);
      return { success: true, skipped: true, reason: "Custom plan" };
    }

    try {
      // Create monthly subscription if price > 0
      if (plan.monthlyPrice > 0) {
        const monthlyProductId = this.generateProductId(plan.name, 'monthly');
        
        // Check if subscription already exists with a different ID format
        const existingId = await this.getSubscriptionProductId(monthlyProductId);
        const actualProductId = existingId || monthlyProductId;
        
        if (existingId && existingId !== monthlyProductId) {
          console.log(`GooglePlayBillingService: Found existing subscription with ID ${existingId} (expected ${monthlyProductId})`);
          results.monthlyProductId = existingId;
        } else {
          try {
            await this.createSubscription({
              productId: monthlyProductId,
              name: `${plan.name} (Monthly)`,
              description: plan.description || `${plan.name} monthly subscription`,
              priceAmountMicros: Math.round(plan.monthlyPrice * 1000000),
              priceCurrencyCode: 'USD',
              billingPeriod: 'P1M',
            });
            results.monthlyProductId = monthlyProductId;
          } catch (error) {
            results.errors.push({ period: 'monthly', error: error.message });
            console.error(`Failed to create monthly subscription for ${plan.name}:`, error.message);
          }
        }
      }

      // Create annual subscription if price > 0
      if (plan.annualMonthlyPrice > 0) {
        const annualProductId = this.generateProductId(plan.name, 'annual');
        
        // Check if subscription already exists with a different ID format
        const existingId = await this.getSubscriptionProductId(annualProductId);
        const actualProductId = existingId || annualProductId;
        
        if (existingId && existingId !== annualProductId) {
          console.log(`GooglePlayBillingService: Found existing subscription with ID ${existingId} (expected ${annualProductId})`);
          results.annualProductId = existingId;
        } else {
          const annualPrice = plan.annualMonthlyPrice * 12; // Total annual price
          try {
            await this.createSubscription({
              productId: annualProductId,
              name: `${plan.name} (Annual)`,
              description: plan.description || `${plan.name} annual subscription`,
              priceAmountMicros: Math.round(annualPrice * 1000000),
              priceCurrencyCode: 'USD',
              billingPeriod: 'P1Y',
            });
            results.annualProductId = annualProductId;
          } catch (error) {
            results.errors.push({ period: 'annual', error: error.message });
            console.error(`Failed to create annual subscription for ${plan.name}:`, error.message);
          }
        }
      }

      if (results.errors.length > 0) {
        results.success = false;
      }

      return results;
    } catch (error) {
      console.error(`GooglePlayBillingService: ❌ Failed to sync plan ${plan.name}:`, error);
      return {
        success: false,
        errors: [error.message],
      };
    }
  }

  /**
   * Check if service is properly configured and ready
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      packageName: this.packageName,
      useSandbox: this.useSandbox,
      hasAndroidPublisher: !!this.androidPublisher,
    };
  }

  /**
   * Verify webhook notification signature
   * Note: Google Play RTDN uses Pub/Sub which handles verification automatically
   * This method validates the notification structure
   * @param {Object} notificationData - Notification data
   * @returns {Promise<Boolean>} True if valid
   */
  async verifyWebhookNotification(notificationData) {
    try {
      console.log("GooglePlayBillingService: Verifying webhook notification...");
      
      // Handle test notifications from Play Console
      if (notificationData.testNotification) {
        console.log("GooglePlayBillingService: ✅ Test notification - valid");
        return true;
      }

      // Handle one-time product notifications (not subscriptions)
      if (notificationData.oneTimeProductNotification) {
        console.log("GooglePlayBillingService: One-time product notification detected");
        // You can handle these separately if needed
        return true;
      }

      // Validate subscription notification structure
      if (!notificationData || !notificationData.subscriptionNotification) {
        console.log("GooglePlayBillingService: No subscriptionNotification field found");
        console.log("GooglePlayBillingService: Available fields:", Object.keys(notificationData || {}));
        return false;
      }

      const { subscriptionNotification } = notificationData;
      console.log("GooglePlayBillingService: Subscription notification:", JSON.stringify(subscriptionNotification, null, 2));

      // Check required fields
      if (
        !subscriptionNotification.purchaseToken ||
        !subscriptionNotification.subscriptionId ||
        !subscriptionNotification.notificationType
      ) {
        console.log("GooglePlayBillingService: Missing required fields:");
        console.log("  - purchaseToken:", !!subscriptionNotification.purchaseToken);
        console.log("  - subscriptionId:", !!subscriptionNotification.subscriptionId);
        console.log("  - notificationType:", !!subscriptionNotification.notificationType);
        return false;
      }

      // Valid notification types (numeric values from Google Play)
      // https://developer.android.com/google/play/billing/rtdn-reference#sub
      const validNotificationTypes = [
        // String types (legacy)
        "SUBSCRIPTION_PURCHASED",
        "SUBSCRIPTION_RENEWED",
        "SUBSCRIPTION_CANCELED",
        "SUBSCRIPTION_EXPIRED",
        "SUBSCRIPTION_RESTARTED",
        "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
        "SUBSCRIPTION_DEFERRED",
        "SUBSCRIPTION_PAUSED",
        "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED",
        "SUBSCRIPTION_REVOKED",
        "SUBSCRIPTION_IN_GRACE_PERIOD",
        "SUBSCRIPTION_RECOVERED",
        "SUBSCRIPTION_ON_HOLD",
        // Numeric types (current)
        1,  // SUBSCRIPTION_RECOVERED
        2,  // SUBSCRIPTION_RENEWED
        3,  // SUBSCRIPTION_CANCELED
        4,  // SUBSCRIPTION_PURCHASED
        5,  // SUBSCRIPTION_ON_HOLD
        6,  // SUBSCRIPTION_IN_GRACE_PERIOD
        7,  // SUBSCRIPTION_RESTARTED
        8,  // SUBSCRIPTION_PRICE_CHANGE_CONFIRMED
        9,  // SUBSCRIPTION_DEFERRED
        10, // SUBSCRIPTION_PAUSED
        11, // SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED
        12, // SUBSCRIPTION_REVOKED
        13, // SUBSCRIPTION_EXPIRED
        20, // SUBSCRIPTION_PENDING_PURCHASE_CANCELED
      ];

      const notificationType = subscriptionNotification.notificationType;
      if (!validNotificationTypes.includes(notificationType)) {
        console.warn(
          `GooglePlayBillingService: Unknown notification type: ${notificationType}`
        );
        // Still return true to process it - we can handle unknown types gracefully
        console.log("GooglePlayBillingService: Will attempt to process unknown notification type");
      }

      console.log("GooglePlayBillingService: ✅ Notification verified successfully");
      return true;
    } catch (error) {
      console.error("GooglePlayBillingService: Webhook verification error:", error);
      return false;
    }
  }
}

// Create singleton instance
const googlePlayBillingService = new GooglePlayBillingService();

// Initialize on module load (non-blocking)
googlePlayBillingService.initialize().catch((error) => {
  console.error(
    "GooglePlayBillingService: Failed to initialize on startup:",
    error
  );
});

module.exports = googlePlayBillingService;

