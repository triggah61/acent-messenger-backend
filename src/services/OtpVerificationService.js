const { v4 } = require("uuid");
const SMS = require("../config/sms");
const OtpVerification = require("../model/OtpVerification");
const AppError = require("../exception/AppError");

exports.createOtp = async (userId, criteria, via, phone, data = {}) => {
  let traceId = v4();
  let code = Math.floor(100000 + Math.random() * 900000);
  if (process.env.NODE_ENV == "dev") {
    code = 123456;
  }
  let verification = await OtpVerification.create({
    user: userId,
    traceId,
    phoneWithDialCode: phone,
    code,
    criteria,
    data,
    via,
  });

  if (via == "phone" && process.env.NODE_ENV !== "dev") {
    try {
      let smsResult = await new SMS(phone).text(`Your OTP is ${code}`).send();
      console.log("OTP SMS sent successfully:", smsResult);
    } catch (error) {
      throw new AppError(error.message);
      console.error("Failed to send OTP SMS:", error.message);
      // Don't throw error here to allow OTP creation to proceed
      // The user can still be notified about SMS failure separately
    }
  }

  return verification;
};

exports.resendOtp = async (traceId) => {
  let code = Math.floor(100000 + Math.random() * 900000);
  if (process.env.NODE_ENV == "dev") {
    code = 123456;
  }
  let verification = await OtpVerification.findOneAndUpdate(
    { traceId },
    {
      code,
    },
    { new: true }
  );

  let { criteria, phoneWithDialCode, user: userId, via, status } = verification;
  if (status !== "pending") {
    return {
      message: `OTP already ${status}`,
      data: { traceId },
    };
  }

  if (via == "phone" && process.env.NODE_ENV !== "dev") {
    try {
      let smsResult = await new SMS(phoneWithDialCode)
        .text(`Your OTP is ${code}`)
        .send();
      console.log("Resend OTP SMS sent successfully:", smsResult);
    } catch (error) {
      console.error("Failed to resend OTP SMS:", error.message);
      // Don't throw error here to allow OTP resend to proceed
    }
  }

  return verification;
};
