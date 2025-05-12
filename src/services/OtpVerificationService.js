const { v4 } = require("uuid");
const SMS = require("../config/sms");
const OtpVerification = require("../model/OtpVerification");

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

  if (via == "phone") {
    let sms = new SMS(phone).text(`Your OTP is ${code}`).send();
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

  if (via == "phone") {
    let sms = new SMS(phoneWithDialCode).text(`Your OTP is ${code}`).send();
  }

  return verification;
};
