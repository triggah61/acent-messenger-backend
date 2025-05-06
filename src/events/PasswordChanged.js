const Email = require("../config/email");
const { createNotification } = require("../services/NotificationService");

module.exports = async (user) => {
  await createNotification(user._id, "password_change", user);
  await new Email(user?.email)
    .subject("Password Changed")
    .file("password-change")
    .data({ user })
    .send();

  return;
};
