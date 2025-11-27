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

  // Get subscribed users for filter dropdown
  history.get(
    "/subscribed-users",
    HasPermission("subscription.read"),
    SubscriptionHistoryController.getSubscribedUsers
  );
});

module.exports = subscriptionHistoryRouter;

