const Product = require("../../model/Product");
const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");

/**
 * Checks the validity of a QR code
 *
 * @function checkQRCodeValidity
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - URL parameters
 * @param {string} req.params.code - Product QR code
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends a JSON response indicating the QR code's validity
 */
exports.checkValidity = catchAsync(async (req, res) => {
  let user = req.user;
  const { code } = req.params;

  // Find the product by code
  const product = await Product.findOne({ code })
    .populate("category")
    .populate("user");

  if (!product) {
    throw new AppError("QR code is invalid", 404);
  }
  if (product.status !== "active") {
    return res.status(400).json({
      message: "QR code is expired",
      valid: false,
      product: {
        name: product.name,
        series: product.series,
        photo: product?.photo,
        category: product?.category?.name,
      },
      ...(product.user && {
        user: {
          firstName: product.user.firstName,
          lastName: product.user.lastName,
          email: product.user.email,
        },
      }),
    });
  }
  // Return the response based on status
  res.json({
    message: "QR code is valid",
    valid: true,
    product: {
      name: product.name,
      series: product.series,
      photo: product?.photo,
      category: product?.category?.name ?? "",
    },
    ...(product.user && {
      user: {
        firstName: product.user.firstName,
        lastName: product.user.lastName,
        email: product.user.email,
      },
    }),
  });
});

exports.applyCode = catchAsync(async (req, res) => {
  const { code } = req.params;
  let user = req.user;
  // Find the product by code
  const product = await Product.findOne({ code })
    .populate("category")
    .populate("user");

  // If product not found, throw an error
  if (!product) {
    throw new AppError("QR code is invalid", 404);
  }
  if (product.status !== "active") {
    return res.status(400).json({
      message: "QR code is expired",
      valid: false,
      product: {
        name: product.name,
        series: product.series,
        photo: product?.photo,
        category: product?.category?.name,
      },
      ...(product.user && {
        user: {
          firstName: product.user.firstName,
          lastName: product.user.lastName,
          email: product.user.email,
        },
      }),
    });
  }

  await Product.findByIdAndUpdate(product._id, {
    status: "expired",
    user: user._id,
  });

  // Return the response based on status
  res.json({
    message: "QR code is applied",
    valid: true,
    product: {
      name: product.name,
      series: product.series,
      photo: product?.photo,
      category: product?.category?.name,
    },
    ...(product.user && {
      user: {
        firstName: product.user.firstName,
        lastName: product.user.lastName,
        email: product.user.email,
      },
    }),
  });
});
