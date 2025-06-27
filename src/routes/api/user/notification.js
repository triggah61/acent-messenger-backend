/**
 * @fileoverview Notification Routes
 *
 * This module defines routes for notification management including
 * FCM token registration, notification settings, and push notification sending.
 *
 * @module routes/api/user/notification
 * @requires express
 * @requires ../../../controller/user/NotificationController
 */

const express = require("express");
const {
  registerFCMToken,
  removeFCMToken,
  deactivateFCMToken,
  getNotificationSettings,
  updateNotificationSettings,
  sendTestNotification,
  getFCMStatus,
  sendNotificationToUser,
  getUserTokens,
} = require("../../../controller/user/NotificationController");

const notificationRouter = express.Router();
require("express-group-routes");

// Group all notification routes under /notification prefix
notificationRouter.group("/notification", (notification) => {
  
  // FCM Token Management
  notification.post("/register-token", registerFCMToken);
  notification.delete("/remove-token", removeFCMToken);
  notification.post("/deactivate-token", deactivateFCMToken);
  notification.get("/tokens", getUserTokens);
  
  // Notification Settings
  notification.get("/settings", getNotificationSettings);
  notification.put("/settings", updateNotificationSettings);
  
  // Testing & Debug
  notification.post("/test", sendTestNotification);
  notification.get("/status", getFCMStatus);
  
  // Admin functions (send to specific user)
  notification.post("/send", sendNotificationToUser);
});

module.exports = notificationRouter; 