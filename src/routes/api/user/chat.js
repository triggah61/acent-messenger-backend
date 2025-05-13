const multerMiddleware = require("../../../config/multer");
const {
  findChatSessionByReceipient,
  createChatSession,
  sendMessage,
  sessionList,
} = require("../../../controller/user/ChatController");
const Authenticated = require("../../../middleware/Authenticated");
const chatRouter = require("express").Router();
require("express-group-routes");
chatRouter.group("/chat", (chat) => {
  chat.use(Authenticated);
  chat.post(
    "/findChatSessionByReceipient/:receipientId",
    findChatSessionByReceipient
  );
  chat.post("/createChatSession", createChatSession);
  chat.post(
    "/sendMessage",
    multerMiddleware.array("attachments", 5),
    sendMessage
  );
  chat.get("/sessionList", sessionList);
});

module.exports = chatRouter;
