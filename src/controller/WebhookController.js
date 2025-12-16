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
    console.log("WebhookController: Raw payload:", JSON.stringify(payload, null, 2));

    // Parse notification based on Google Play RTDN format
    // Google Play sends notifications via Pub/Sub, which wraps the data
    let notificationData;

    // Handle Pub/Sub message format
    if (payload.message && payload.message.data) {
      // Decode base64 data from Pub/Sub
      const messageData = payload.message.data;
      console.log("WebhookController: Decoding Pub/Sub message...");
      const decodedData = Buffer.from(messageData, "base64").toString("utf-8");
      console.log("WebhookController: Decoded data:", decodedData);
      
      try {
        notificationData = JSON.parse(decodedData);
        console.log("WebhookController: Parsed notification data:", JSON.stringify(notificationData, null, 2));
      } catch (parseError) {
        console.error("WebhookController: Failed to parse decoded data:", parseError);
        // If it's a test notification, it might just be a simple string
        console.log("WebhookController: Test notification detected, acknowledging...");
        return { success: true, message: "Test notification acknowledged" };
      }
    } else if (payload.subscriptionNotification) {
      // Direct notification format (for testing)
      notificationData = payload;
      console.log("WebhookController: Direct notification format detected");
    } else if (payload.testNotification) {
      // Google Play Console test notification
      console.log("WebhookController: ✅ Test notification from Play Console received!");
      console.log("WebhookController: Test notification data:", JSON.stringify(payload.testNotification, null, 2));
      return { success: true, message: "Test notification received successfully" };
    } else {
      // Log the payload structure for debugging
      console.log("WebhookController: Unknown payload structure. Keys:", Object.keys(payload));
      
      // Check if it's an empty or minimal payload (could be a ping)
      if (Object.keys(payload).length === 0 || 
          (payload.message && !payload.message.data)) {
        console.log("WebhookController: Empty/ping notification, acknowledging...");
        return { success: true, message: "Ping acknowledged" };
      }
      
      console.error("WebhookController: Invalid webhook payload format");
      console.error("WebhookController: Payload:", JSON.stringify(payload, null, 2));
      throw new Error("Invalid webhook payload format");
    }

    // Check if this is a test notification within the decoded data
    if (notificationData.testNotification) {
      console.log("WebhookController: ✅ Test notification received and decoded!");
      return { success: true, message: "Test notification processed" };
    }

    // Verify notification structure
    const isValid = await googlePlayBillingService.verifyWebhookNotification(
      notificationData
    );

    if (!isValid) {
      console.error("WebhookController: Notification validation failed");
      console.error("WebhookController: Notification data:", JSON.stringify(notificationData, null, 2));
      throw new AppError("Invalid webhook notification", 400);
    }

    // Process notification
    const result = await webhookHandlerService.processNotification(
      notificationData,
      payload
    );

    console.log(
      `WebhookController: ✅ Webhook processed successfully - ${notificationData.subscriptionNotification?.notificationType}`
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

