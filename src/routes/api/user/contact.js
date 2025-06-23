const {
  getContacts,
  sendInvitation,
  sendRequest,
  acceptRequest,
  findContact,
  checkPhoneNumbers,
  globalSearch,
} = require("../../../controller/user/ContactController");
const Authenticated = require("../../../middleware/Authenticated");

const contactRouter = require("express").Router();
require("express-group-routes");
contactRouter.group("/contact", (contact) => {
  contact.get("/list", getContacts);
  contact.post("/invite", sendInvitation);
  contact.post("/find", findContact);
  contact.post("/checkPhoneNumbers", checkPhoneNumbers);
  contact.post("/globalSearch", globalSearch);
  contact.post("/request/:receiverId", sendRequest);
  contact.post("/accept/:senderId", acceptRequest);
});

module.exports = contactRouter;
