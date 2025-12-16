const Authenticated = require("../../../middleware/Authenticated");
const HasPermission = require("../../../middleware/HasPermission");
const SubscriptionHistoryController = require("../../../controller/admin/subscription/SubscriptionHistoryController");

const subscriptionHistoryRouter = require("express").Router();
require("express-group-routes");

subscriptionHistoryRouter.group("/subscription-history", (history) => {
  history.use(Authenticated);

  // Get all subscription history (with filters and pagination)
  history.get(
    "/",
    HasPermission("subscription.read"),
    SubscriptionHistoryController.getAllSubscriptionHistory
  );

  // Get all subscription history with detailed events/payments summary
  history.get(
    "/all-detailed",
    HasPermission("subscription.read"),
    SubscriptionHistoryController.getAllSubscriptionHistoryDetailed
  );

  // Get subscribed users for filter dropdown
  history.get(
    "/subscribed-users",
    HasPermission("subscription.read"),
    SubscriptionHistoryController.getSubscribedUsers
  );

  // Get detailed subscription with full events and payments
  history.get(
    "/:id/details",
    HasPermission("subscription.read"),
    SubscriptionHistoryController.getSubscriptionDetails
  );

  // Get subscription events (paginated)
  history.get(
    "/:id/events",
    HasPermission("subscription.read"),
    SubscriptionHistoryController.getSubscriptionEvents
  );

  // Get subscription payments (paginated)
  history.get(
    "/:id/payments",
    HasPermission("subscription.read"),
    SubscriptionHistoryController.getSubscriptionPayments
  );
});

module.exports = subscriptionHistoryRouter;

