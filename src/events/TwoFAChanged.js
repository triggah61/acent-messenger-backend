const Email = require("../config/email");
const { createNotification } = require("../services/NotificationService");

module.exports = async (user) => {
  await createNotification(
    user._id,
    user?.googleAuthenticator == "on" ? "2fa_activation" : "2fa_deactivation",
    user
  );
  await new Email(user?.email)
    .subject("2FA Changed")
    .file("authenticator-switch")
    .data({ user })
    .send();
  return true;
};
