const express = require("express");
const WebhookController = require("../../controller/WebhookController");
const rateLimit = require("express-rate-limit");

const webhookRouter = express.Router();
require("express-group-routes");

// Rate limiting for webhook endpoint
// Allow higher limit for webhooks (Google Play may send multiple notifications)
const webhookRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Allow up to 100 requests per window per IP
  message: "Too many webhook requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
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

