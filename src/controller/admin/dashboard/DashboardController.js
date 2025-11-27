const catchAsync = require("../../../exception/catchAsync");
const User = require("../../../model/User");

exports.getDashboard = catchAsync(async (req, res) => {
  let userCount = await User.countDocuments({
    status: "activated",
    roleType: "user",
  });

  res.json({
    message: "Fetched successfully",
    data: {
      userCount,
    },
  });
});
