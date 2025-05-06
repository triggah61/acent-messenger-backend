const {
  setAuthenticatorSeed,
  toggleAuthenticatorStatus,
  changePassword,
} = require("../../../controller/admin/profile/SecurityController");
const Authenticated = require("../../../middleware/Authenticated");

const securityRouter = require("express").Router();
require("express-group-routes");
securityRouter.group("/security", (security) => {
  security.use(Authenticated);
  security.post("/changePassword/:id?", changePassword);
  security.get("/setGoogleAuthenticatorSecret/:id?", setAuthenticatorSeed);
  security.post("/toggleAuthenticatorStatus/:id?", toggleAuthenticatorStatus);
});

module.exports = securityRouter;
