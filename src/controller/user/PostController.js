const { upload } = require("../../config/file");
const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");
const Attachment = require("../../model/Attachment");
const Post = require("../../model/Post");
const User = require("../../model/User");
const SimpleValidator = require("../../validator/simpleValidator");
const moment = require("moment");
exports.createPost = catchAsync(async (req, res) => {
  let { user } = req;
  const { caption } = req.body;

  if (!req.file) {
    throw new AppError("Attachment is required", 400);
  }

  const file = await upload(req.file, "attachments");
  const attachmentInfo = await Attachment.create({
    user: user._id,
    url: file.Location,
    name: file.Key,
    size: file.Size,
  });

  const post = await Post.create({
    user,
    attachment: attachmentInfo._id,
    caption,
  });

  res.status(200).json({
    success: true,
    message: "Post created successfully",
    data: post,
  });
});

exports.getPostFeed = catchAsync(async (req, res) => {
  let { user } = req;

  let userDetails = await User.findById(user._id, { contacts: 1 });

  const posts = await Post.find({
    user: { $in: userDetails.contacts },
    createdAt: { $gte: moment().subtract(24, "hours").toDate() },
  })
    .populate("user", "firstName lastName photo username dialCode phone")
    .populate("attachment")
    .sort({
      createdAt: -1,
    });

  res.status(200).json({
    message: "Post feed fetched successfully",
    data: posts,
  });
});
