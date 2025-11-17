const multerMiddleware = require("../../../config/multer");
const { translate, getSonioxConfig } = require("../../../controller/user/TranslationController");
const Authenticated = require("../../../middleware/Authenticated");
const translationRouter = require("express").Router();
require("express-group-routes");
translationRouter.group("/translation", (chat) => {
  chat.use(Authenticated);
  chat.post("/translate", translate);
  chat.get("/soniox-config", getSonioxConfig);
});

module.exports = translationRouter;
