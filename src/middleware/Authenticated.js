/**
 * Middleware function that authenticates a user based on a Bearer token in the request headers.
 *
 * This middleware function is responsible for verifying the JWT token in the request headers and
 * ensuring that the user is authenticated and active. If the token is valid and the user is
 * activated, the middleware will attach the user object and the token to the request object,
 * allowing subsequent middleware functions to access this information.
 *
 * If the token is missing, invalid, or the user is not activated, the middleware will throw an
 * appropriate error with a 401 Unauthorized status code.
 *
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 * @param {Function} next - The next middleware function in the stack.
 * @returns {void}
 */
const jwt = require("jsonwebtoken");
const catchAsync = require("../exception/catchAsync");
const AppError = require("../exception/AppError");
const User = require("../model/User");
module.exports = catchAsync(async (req, res, next) => {
  const secret = process.env.JWT_SECRET;
  let authenticated = false;
  let token = null;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    throw new AppError("Bearer token is required", 401);
  }
  try {
    var decoded = await jwt.verify(token, secret);
    let { id, roleType } = decoded;
    let user = await User.findById(id)
      .select("firstName lastName username email phone photo status")
      .lean();
    if (!user) {
      return next(
        new AppError(
          "The user belonging to this takes does no longer exist",
          401
        )
      );
    } else if (user.status != "activated") {
      return next(new AppError("User is not activated", 401));
    }

    if (user) {
      req.user = user;
      req.token = token;
      authenticated = true;
    }
  } catch (error) {
    console.log(error.message);
    return next(
      new AppError("The user belonging to this takes does no longer exist", 401)
    );
  }

  if (!authenticated) {
    return next(
      new AppError("You are not logged in! Please log in to get access", 401)
    );
  }
  next();
});
