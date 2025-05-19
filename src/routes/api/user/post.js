const multerMiddleware = require("../../../config/multer");
const { createPost, getPostFeed } = require("../../../controller/user/PostController");
const Authenticated = require("../../../middleware/Authenticated");
const postRouter = require("express").Router();
require("express-group-routes");
postRouter.group("/post", (post) => {
  post.use(Authenticated);
  post.post("/createPost", multerMiddleware.single("attachment"), createPost);
  post.get("/feed", getPostFeed);
});

module.exports = postRouter;
