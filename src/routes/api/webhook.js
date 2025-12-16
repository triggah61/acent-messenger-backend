const express = require("express");
const WebhookController = require("../../controller/WebhookController");
const rateLimit = require("express-rate-limit");

const webhookRouter = express.Router();
require("express-group-routes");

// Rate limiting for webhook endpoint
// Allow higher limit for webhooks (Google Play may send multiple notifications)
// Note: We disable validation for webhooks since they come from Google's servers
// and we trust them via the Pub/Sub verification
const webhookRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Allow up to 500 requests per window (webhooks can be frequent)
  message: "Too many webhook requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  // Skip validation warnings for webhooks from trusted sources
  validate: {
    trustProxy: false, // Disable trust proxy validation for webhooks
    xForwardedForHeader: false, // Disable X-Forwarded-For validation
  },
});

webhookRouter.group("/webhooks", (webhook) => {
  // Google Play webhook endpoint (public, but verified)
  webhook.post(
    "/google-play",
    webhookRateLimiter,
    WebhookController.handleGooglePlayWebhook
  );

  // Webhook logs (admin only - add authentication middleware if needed)
  // webhook.get("/logs", Authenticated, AdminOnly, WebhookController.getWebhookLogs);
  webhook.get("/logs", WebhookController.getWebhookLogs);
});

module.exports = webhookRouter;

