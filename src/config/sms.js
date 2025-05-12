require("dotenv").config();
const AppError = require("../exception/AppError");
class SMS {
  to = null;
  message = null;
  constructor(to) {
    if (!to) {
      throw new AppError(422, "Destination phone number is required");
    }
    this.to = to;
  }

  text(message) {
    this.message = message;
    return this;
  }

  send() {
    // const sms = await sendSMS(this.to, this.message);
    console.log("SMS sent to: " + this.to);
    return this;
  }
}

module.exports = SMS;
