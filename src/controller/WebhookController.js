const catchAsync = require("../exception/catchAsync");
const AppError = require("../exception/AppError");
const webhookHandlerService = require("../services/WebhookHandlerService");
const googlePlayBillingService = require("../services/GooglePlayBillingService");

/**
 * Google Play Webhook Controller
 * Handles Real-time Developer Notifications from Google Play
 */

/**
 * Process Google Play webhook notification
 * @route POST /api/webhooks/google-play
 * @access Public (but verified via signature)
 */
exports.handleGooglePlayWebhook = catchAsync(async (req, res) => {
  // Always return 200 OK immediately (Google Play requirement)
  // Process asynchronously
  res.status(200).json({
    status: "success",
    message: "Webhook received",
  });

  // Process notification asynchronously (don't await)
  processWebhookAsync(req.body).catch((error) => {
    console.error("WebhookController: Error processing webhook asynchronously:", error);
  });
});

/**
 * Process webhook asynchronously
 * @param {Object} payload - Webhook payload
 */
async function processWebhookAsync(payload) {
  try {
    console.log("WebhookController: Processing webhook notification...");

    // Parse notification based on Google Play RTDN format
    // Google Play sends notifications via Pub/Sub, which wraps the data
    let notificationData;

    // Handle Pub/Sub message format
    if (payload.message && payload.message.data) {
      // Decode base64 data if present
      const messageData = payload.message.data;
      const decodedData = Buffer.from(messageData, "base64").toString("utf-8");
      notificationData = JSON.parse(decodedData);
    } else if (payload.subscriptionNotification) {
      // Direct notification format (for testing)
      notificationData = payload;
    } else {
      throw new Error("Invalid webhook payload format");
    }

    // Verify notification structure
    const isValid = await googlePlayBillingService.verifyWebhookNotification(
      notificationData
    );

    if (!isValid) {
      throw new AppError("Invalid webhook notification", 400);
    }

    // Process notification
    const result = await webhookHandlerService.processNotification(
      notificationData,
      payload
    );

    console.log(
      `WebhookController: Webhook processed successfully - ${notificationData.subscriptionNotification?.notificationType}`
    );

    return result;
  } catch (error) {
    console.error("WebhookController: Error processing webhook:", error);
    throw error;
  }
}

/**
 * Get webhook logs (for debugging/admin)
 * @route GET /api/webhooks/logs
 * @access Private (Admin only)
 */
exports.getWebhookLogs = catchAsync(async (req, res) => {
  const WebhookLog = require("../model/WebhookLog");
  const { page = 1, limit = 50, status, notificationType } = req.query;

  const query = {};
  if (status) {
    query.status = status;
  }
  if (notificationType) {
    query.notificationType = notificationType;
  }

  const logs = await WebhookLog.find(query)
    .populate("user subscriptionHistory")
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit));

  const total = await WebhookLog.countDocuments(query);

  res.json({
    status: "success",
    message: "Webhook logs fetched successfully",
    data: {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

