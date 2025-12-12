const catchAsync = require("../exception/catchAsync");
const authRouter = require("./api/auth");
const configRouter = require("./api/admin/config");
const profileRouter = require("./api/admin/profile");
const userRouter = require("./api/user");
const adminRouter = require("./api/admin");
const pusherRouter = require("./api/pusher");
const webhookRouter = require("./api/webhook");
const Wallet = require("../model/Wallet");
const Authenticated = require("../middleware/Authenticated");
const { triggerBtcScan } = require("../cronJob/bitcoinTransactionListener");
const router = require("express").Router();
require("express-group-routes");
router.group("/api", (api) => {
  api.use(configRouter);
  api.use(authRouter);
  api.use(profileRouter);
  api.use(adminRouter);
  api.use(userRouter);
  api.use("/pusher",  pusherRouter);
  api.use(webhookRouter);

  api.get(
    "/test",
    catchAsync(async (req, res) => {
      triggerBtcScan();
      res.json({
        status: "Api server is running",
      });
    })
  );
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
