const express = require("express");
const Authenticated = require("../../../middleware/Authenticated");
const TopUpController = require("../../../controller/user/TopUpController");

const topupRouter = express.Router();
require("express-group-routes");

topupRouter.group("/topup", (topup) => {
  topup.use(Authenticated);

  // Get all credit packages
  topup.get("/packages", TopUpController.getTopUpPackages);

  // Verify Google Play one-time purchase for top-up
  topup.post("/verify-google-play", TopUpController.verifyGooglePlayTopUp);

  // Get top-up history
  topup.get("/history", TopUpController.getTopUpHistory);
});

module.exports = topupRouter;

