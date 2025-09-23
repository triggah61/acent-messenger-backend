const multerMiddleware = require("../../../config/multer");
const { translate } = require("../../../controller/user/TranslationController");
const Authenticated = require("../../../middleware/Authenticated");
const translationRouter = require("express").Router();
require("express-group-routes");
translationRouter.group("/translation", (chat) => {
  chat.use(Authenticated);
  chat.post("/translate", translate);
});

module.exports = translationRouter;
