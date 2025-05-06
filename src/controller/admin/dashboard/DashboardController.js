const catchAsync = require("../../../exception/catchAsync");
const User = require("../../../model/User");
const Product = require("../../../model/Product");

exports.getDashboard = catchAsync(async (req, res) => {
  let userCount = await User.countDocuments({
    status: "activated",
    roleType: "user",
  });

  const productStats = await Product.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 }
      }
    }
  ]);

  const productCount = productStats.reduce((acc, curr) => {
    acc[curr._id] = curr.count;
    return acc;
  }, {});

  res.json({
    message: "Fetched successfully",
    data: {
      userCount,
      productCount,
    },
  });
});
