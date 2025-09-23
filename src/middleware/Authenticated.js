/**
 * Middleware function that authenticates a user based on a Bearer token in the request headers.
 *
 * This middleware function is responsible for verifying the JWT token in the request headers and
 * ensuring that the user is authenticated and active. It first checks Redis cache for user data
 * to improve performance, and falls back to database lookup if cache miss occurs.
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
const UserCacheService = require("../services/UserCacheService");

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
    let user = null;

    // First try to get user from Redis cache
    user = await UserCacheService.getCachedUser(id);
    
    if (!user) {
      // Cache miss - fetch from database
      console.log(`Cache miss for user ${id}, fetching from database`);
      user = await User.findById(id)
        .select("firstName lastName username email phone dialCode photo status gender dob language")
        .lean();
      if (user) {
        // Cache the user data for future requests
        await UserCacheService.cacheUser(id, user);
      }
    } else {
      console.log(`Cache hit for user ${id}`);
    }

    if (!user) {
      return next(
        new AppError(
          "The user belonging to this token does no longer exist",
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
      new AppError("The user belonging to this token does no longer exist", 401)
    );
  }

  if (!authenticated) {
    return next(
      new AppError("You are not logged in! Please log in to get access", 401)
    );
  }
  next();
});
