
const catchAsync = require("../exception/catchAsync");
const authRouter = require("./api/admin/auth");
const configRouter = require("./api/admin/config");
const profileRouter = require("./api/admin/profile");
const securityRouter = require("./api/admin/security");
const userRouter = require("./api/user");
const adminRouter = require("./api/admin");
const router = require("express").Router();
require("express-group-routes");
router.group("/api", (api) => {
  api.use(configRouter);
  api.use(authRouter);
  api.use(profileRouter);
  api.use(securityRouter);
  api.use(adminRouter);
  api.use(userRouter);
  api.get(
    "/",
    catchAsync(async (req, res) => {
      res.json({
        status: "Api server is running",
      });
    })
  );
});

module.exports = router;
