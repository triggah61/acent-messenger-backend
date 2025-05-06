
const catchAsync = require("../exception/catchAsync");
const AppError = require("../exception/AppError");
module.exports = catchAsync(async (req, res, next) => {
  let user = req.user;
  if (!user) {
    throw new AppError("You are not authenticated", 401);
  } else if (!["superAdmin", "admin"].includes(user.roleType)) {
    console.log(user.roleType);
    throw new AppError("You are not authorized to access this resource", 403);
  }
  next();
});
