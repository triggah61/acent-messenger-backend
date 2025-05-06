const express = require("express");
const Authenticated = require("../../../middleware/Authenticated");
const userRouter = require("./user");
const IsAdmin = require("../../../middleware/IsAdmin");

const adminRouter = express.Router();
require("express-group-routes");

adminRouter.group("/", (admin) => {
  admin.use(Authenticated);
  // admin.use(IsAdmin);
  admin.use(userRouter);
});

module.exports = adminRouter;
