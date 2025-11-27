const express = require("express");
const Authenticated = require("../../../middleware/Authenticated");
const contactRouter = require("./contact");
const chatRouter = require("./chat");
const postRouter = require("./post");
const profileRouter = require("../admin/profile");
const walletRouter = require("./wallet");
const notificationRouter = require("./notification");
// const authRouter = require("./auth");
const callRouter = require("./call");
const translationRouter = require("./translation");
const subscriptionRouter = require("./subscription");
const userRouter = express.Router();
require("express-group-routes");

userRouter.group("/user", (user) => {
  user.use(Authenticated);
  user.use(profileRouter);
  user.use(contactRouter);
  user.use(chatRouter);
  user.use(postRouter);
  user.use(walletRouter);
  user.use(notificationRouter);
  user.use(translationRouter);
  user.use(subscriptionRouter);
  // user.use(authRouter);
  user.use(callRouter);
  user.get("/", (req, res) => {
    res.json({
      message: "User route",
    });
  });
});

module.exports = userRouter;
