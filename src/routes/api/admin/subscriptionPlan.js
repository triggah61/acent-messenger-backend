const multerMiddleware = require("../../../config/multer");
const SubscriptionPlanController = require("../../../controller/admin/subscription/SubscriptionPlanController");
const Authenticated = require("../../../middleware/Authenticated");
const HasPermission = require("../../../middleware/HasPermission");

const subscriptionPlanRouter = require("express").Router();
require("express-group-routes");

subscriptionPlanRouter.group("/subscription-plans", (plan) => {
  plan.use(Authenticated);

  // Create a new subscription plan
  plan.post(
    "/",
    HasPermission("subscription.create"),
    multerMiddleware.single("icon"),
    SubscriptionPlanController.createSubscriptionPlan
  );

  // Get all subscription plans (with filters and pagination)
  plan.get(
    "/",
    HasPermission("subscription.read"),
    SubscriptionPlanController.getAllSubscriptionPlans
  );

  // Get a specific subscription plan by ID
  plan.get(
    "/:id",
    HasPermission("subscription.read"),
    SubscriptionPlanController.getSubscriptionPlan
  );

  // Update a specific subscription plan by ID
  plan.patch(
    "/:id",
    HasPermission("subscription.update"),
    multerMiddleware.single("icon"),
    SubscriptionPlanController.updateSubscriptionPlan
  );

  // Soft delete a specific subscription plan by ID
  plan.delete(
    "/:id",
    HasPermission("subscription.delete"),
    SubscriptionPlanController.deleteSubscriptionPlan
  );

  // Google Play Billing Integration Routes
  
  // Get Google Play Billing service status
  plan.get(
    "/google-play/status",
    HasPermission("subscription.read"),
    SubscriptionPlanController.getGooglePlayStatus
  );

  // Sync all plans with Google Play
  plan.post(
    "/google-play/sync-all",
    HasPermission("subscription.update"),
    SubscriptionPlanController.syncAllPlansWithGooglePlay
  );

  // Sync a specific plan with Google Play
  plan.post(
    "/:id/google-play/sync",
    HasPermission("subscription.update"),
    SubscriptionPlanController.syncPlanWithGooglePlay
  );
});

module.exports = subscriptionPlanRouter;

