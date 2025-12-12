const CreditPackageController = require("../../../controller/admin/creditPackage/CreditPackageController");
const Authenticated = require("../../../middleware/Authenticated");
const HasPermission = require("../../../middleware/HasPermission");

const creditPackageRouter = require("express").Router();
require("express-group-routes");

creditPackageRouter.group("/credit-packages", (package) => {
  package.use(Authenticated);

  // Create a new credit package
  package.post(
    "/",
    HasPermission("subscription.create"), // Reuse subscription permission for now
    CreditPackageController.createCreditPackage
  );

  // Get all credit packages (with filters and pagination)
  package.get(
    "/",
    HasPermission("subscription.read"),
    CreditPackageController.getAllCreditPackages
  );

  // Get a specific credit package by ID
  package.get(
    "/:id",
    HasPermission("subscription.read"),
    CreditPackageController.getCreditPackage
  );

  // Update a specific credit package by ID
  package.patch(
    "/:id",
    HasPermission("subscription.update"),
    CreditPackageController.updateCreditPackage
  );

  // Soft delete a specific credit package by ID
  package.delete(
    "/:id",
    HasPermission("subscription.delete"),
    CreditPackageController.deleteCreditPackage
  );

  // Google Play Billing Integration Routes

  // Get Google Play Billing service status
  package.get(
    "/google-play/status",
    HasPermission("subscription.read"),
    CreditPackageController.getGooglePlayStatus
  );

  // Sync all packages with Google Play
  package.post(
    "/google-play/sync-all",
    HasPermission("subscription.update"),
    CreditPackageController.syncAllPackagesWithGooglePlay
  );

  // Sync a specific package with Google Play
  package.post(
    "/:id/google-play/sync",
    HasPermission("subscription.update"),
    CreditPackageController.syncPackageWithGooglePlay
  );
});

module.exports = creditPackageRouter;

