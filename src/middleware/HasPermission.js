const AppError = require("../exception/AppError");
const catchAsync = require("../exception/catchAsync");

module.exports = (permissionName) => {
  return catchAsync(async (req, res, next) => {
    const user = req.user;

      return next();

    next();
  });
};
