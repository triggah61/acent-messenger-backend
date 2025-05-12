const AppError = require("../exception/AppError");
const catchAsync = require("../exception/catchAsync");
const OtpVerification = require("../model/OtpVerification");
const simpleValidator = require("../validator/simpleValidator");

module.exports = catchAsync(async (req, res, next) => {
  let rules = {
    traceId: "required",
    code: "required",
  };
  await simpleValidator(req.body, rules);

  let { traceId, code } = req.body;
  let trace = await OtpVerification.findOne({ traceId });
  if (!trace) {
    throw new AppError("Invalid trace id provided", 422);
  } else if (trace.status != "pending") {
    throw new AppError(`This trace is already ${trace.status}`, 422);
  }
  if (trace.code != code) {
    throw new AppError(`Invalid verification code provided!`, 422);
  }
  await OtpVerification.findByIdAndUpdate(trace._id, {
    status: "verified",
  });
  req.body.trace = trace;
  next();
});
