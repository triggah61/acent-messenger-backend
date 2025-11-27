const express = require("express");
const Authenticated = require("../../../middleware/Authenticated");
const SubscriptionController = require("../../../controller/user/SubscriptionController");

const subscriptionRouter = express.Router();
require("express-group-routes");

subscriptionRouter.group("/subscriptions", (subscription) => {
  subscription.use(Authenticated);

  // Get all subscription plans
  subscription.get("/plans", SubscriptionController.getSubscriptionPlans);

  // Subscribe to a plan
  subscription.post("/subscribe", SubscriptionController.subscribeToPlan);

  // Get subscription history
  subscription.get("/history", SubscriptionController.getSubscriptionHistory);
});

module.exports = subscriptionRouter;

