const express = require("express");
const Authenticated = require("../../../middleware/Authenticated");
const SubscriptionController = require("../../../controller/user/SubscriptionController");

const subscriptionRouter = express.Router();
require("express-group-routes");

subscriptionRouter.group("/subscriptions", (subscription) => {
  subscription.use(Authenticated);

  // Get all subscription plans
  subscription.get("/plans", SubscriptionController.getSubscriptionPlans);

  // Subscribe to a plan (manual - for admin or testing)
  subscription.post("/subscribe", SubscriptionController.subscribeToPlan);

  // Verify Google Play subscription purchase
  subscription.post("/verify-google-play", SubscriptionController.verifyGooglePlaySubscription);

  // Get subscription history
  subscription.get("/history", SubscriptionController.getSubscriptionHistory);
});

module.exports = subscriptionRouter;

