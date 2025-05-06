/**
 * Defines the routes for the admin profile API.
 *
 * The `profileRouter` handles the following routes:
 * - `GET /profile/info`: Retrieves the user's profile information.
 * - `POST /profile/updateProfile`: Updates the user's profile information.
 *
 * The routes are protected by the `Authenticated` middleware, which ensures that only authenticated users can access these endpoints.
 */
const multerMiddleware = require("../../../config/multer");
const {
  info,
  updateProfile,
  switchWorkspace,
} = require("../../../controller/admin/profile/ProfileController");
const Authenticated = require("../../../middleware/Authenticated");

const profileRouter = require("express").Router();
require("express-group-routes");
profileRouter.group("/profile", (profile) => {
  profile.use(Authenticated);
  profile.get("/info", info);
  profile.post(
    "/updateProfile",
    multerMiddleware.single("photo"),
    updateProfile
  );
});

module.exports = profileRouter;
