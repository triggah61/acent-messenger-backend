const multerMiddleware = require("../../../config/multer");
const UserController = require("../../../controller/admin/user/UserController");
const Authenticated = require("../../../middleware/Authenticated");
const HasPermission = require("../../../middleware/HasPermission");

const userRouter = require("express").Router();
require("express-group-routes");

userRouter.group("/users", (user) => {
  user.use(Authenticated);

  // Create a new user
  user.post(
    "/",
    HasPermission("user.create"),
    multerMiddleware.single("photo"),
    UserController.createUser
  );

  // Get all users (with filters and pagination)
  user.get("/", HasPermission("user.read"), UserController.getAllUsers);

  // Get a specific user by ID
  user.get("/:id", HasPermission("user.read"), UserController.getUser);

  // Update a specific user by ID
  user.patch(
    "/:id",
    HasPermission("user.update"),
    multerMiddleware.single("photo"),
    UserController.updateUser
  );

  // Soft delete a specific user by ID
  user.delete("/:id", HasPermission("user.delete"), UserController.deleteUser);
});

module.exports = userRouter;
