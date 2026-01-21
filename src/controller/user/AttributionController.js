const catchAsync = require("../../exception/catchAsync");
const AppError = require("../../exception/AppError");
const User = require("../../model/User");
const SimpleValidator = require("../../validator/simpleValidator");

/**
 * Store Facebook attribution data for user
 * 
 * @route POST /api/user/facebook-attribution
 * @access Private
 */
exports.storeFacebookAttribution = catchAsync(async (req, res) => {
  const { user } = req;

  // Validate input
  await SimpleValidator(req.body, {
    attributionData: "required|object",
  });

  const { attributionData } = req.body;

  // Update user with attribution data
  const updateData = {
    "facebookAttribution.fbclid": attributionData.fbclid || null,
    "facebookAttribution.fbc": attributionData._fbc || attributionData.fbc || null,
    "facebookAttribution.fbp": attributionData._fbp || attributionData.fbp || null,
    "facebookAttribution.utmSource": attributionData.utm_source || attributionData.utmSource || null,
    "facebookAttribution.utmMedium": attributionData.utm_medium || attributionData.utmMedium || null,
    "facebookAttribution.utmCampaign": attributionData.utm_campaign || attributionData.utmCampaign || null,
    "facebookAttribution.attributionCapturedAt": new Date(),
  };

  await User.findByIdAndUpdate(user._id, updateData);

  res.json({
    status: "success",
    message: "Facebook attribution data stored successfully",
  });
});

