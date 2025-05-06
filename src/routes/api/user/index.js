const express = require("express");
const Authenticated = require("../../../middleware/Authenticated");

const userRouter = express.Router();
require("express-group-routes");

userRouter.group("/user", (user) => {
  user.use(Authenticated);
  user.get("/", (req, res) => {
    res.json({
      message: "User route",
    });
  });
});

module.exports = userRouter;
