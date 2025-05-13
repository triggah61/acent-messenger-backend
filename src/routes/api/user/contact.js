const {
  getContacts,
  sendInvitation,
  sendRequest,
  acceptRequest,
  findContact,
} = require("../../../controller/user/ContactController");
const Authenticated = require("../../../middleware/Authenticated");

const contactRouter = require("express").Router();
require("express-group-routes");
contactRouter.group("/contact", (contact) => {
  contact.get("/list", getContacts);
  contact.post("/invite", sendInvitation);
  contact.post("/find", findContact);
  contact.post("/request/:receiverId", sendRequest);
  contact.post("/accept/:senderId", acceptRequest);
});

module.exports = contactRouter;
