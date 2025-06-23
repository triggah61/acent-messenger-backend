require("dotenv").config();
const twilio = require("twilio");
const AppError = require("../exception/AppError");

class SMS {
  to = null;
  message = null;
  client = null;

  constructor(to) {
    if (!to) {
      throw new AppError("Destination phone number is required", 422);
    }

    // Validate Twilio credentials
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_PHONE_NUMBER
    ) {
      throw new AppError(
        "Twilio credentials are not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in environment variables",
        500
      );
    }

    this.to = to;
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  text(message) {
    if (!message) {
      throw new AppError("Message is required", 422);
    }
    this.message = message;
    return this;
  }

  async send() {
    try {
      if (!this.message) {
        throw new AppError("Message is required", 422);
      }

      // Ensure phone number is in E.164 format
      let formattedPhone = this.to;
      if (!formattedPhone.startsWith("+")) {
        // If no country code, assume it's already formatted or add default
        if (!formattedPhone.startsWith("1") && formattedPhone.length === 10) {
          formattedPhone = "+1" + formattedPhone; // Default to US if 10 digits
        } else if (!formattedPhone.startsWith("+")) {
          formattedPhone = "+" + formattedPhone;
        }
      }

      const messageOptions = {
        body: this.message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone,
      };

      // Send SMS via Twilio
      const result = await this.client.messages.create(messageOptions);

      console.log(
        `SMS sent successfully to ${formattedPhone}. Message SID: ${result.sid}`
      );

      return {
        success: true,
        messageSid: result.sid,
        to: formattedPhone,
        status: result.status,
        message: this.message,
      };
    } catch (error) {
      console.error("SMS sending failed:", error.message);

      // Handle specific Twilio errors
      if (error.code) {
        switch (error.code) {
          case 21211:
            throw new AppError("Invalid phone number format", 422);
          case 21408:
            throw new AppError(
              "Permission to send SMS to this number denied",
              422
            );
          case 21610:
            throw new AppError(
              "Message cannot be sent to landline number",
              422
            );
          case 21614:
            throw new AppError("Invalid mobile number", 422);
          default:
            throw new AppError(`SMS sending failed: ${error.message}`, 500);
        }
      }

      throw new AppError(`SMS sending failed: ${error.message}`, 500);
    }
  }
}

module.exports = SMS;
