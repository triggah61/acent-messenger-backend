const express = require("express");
const Authenticated = require("../../../middleware/Authenticated");
const contactRouter = require("./contact");
const chatRouter = require("./chat");
const postRouter = require("./post");
const profileRouter = require("../admin/profile");
const userRouter = express.Router();
require("express-group-routes");

userRouter.group("/user", (user) => {
  user.use(Authenticated);
  user.use(profileRouter);
  user.use(contactRouter);
  user.use(chatRouter);
  user.use(postRouter);
  user.get("/", (req, res) => {
    res.json({
      message: "User route",
    });
  });
});

module.exports = userRouter;
