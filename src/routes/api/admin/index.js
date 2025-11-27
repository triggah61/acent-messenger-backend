const express = require("express");
const Authenticated = require("../../../middleware/Authenticated");
const userRouter = require("./user");
const IsAdmin = require("../../../middleware/IsAdmin");
const dashboardRouter = require("./dashboard");
const subscriptionPlanRouter = require("./subscriptionPlan");
const subscriptionHistoryRouter = require("./subscriptionHistory");
const configRouter = require("./config");
const adminRouter = express.Router();
require("express-group-routes");

adminRouter.group("/admin", (admin) => {
  admin.use(Authenticated);
  // admin.use(IsAdmin);
  admin.use(configRouter);
  admin.use(userRouter);
  admin.use(dashboardRouter);
  admin.use(subscriptionPlanRouter);
  admin.use(subscriptionHistoryRouter);
});

module.exports = adminRouter;
