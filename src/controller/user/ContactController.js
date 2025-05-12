const SMS = require("../../config/sms");
const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");
const User = require("../../model/User");
const SimpleValidator = require("../../validator/simpleValidator");

exports.sendInvitation = catchAsync(async (req, res) => {
  const { user } = req;
  const { phone, dialCode } = req.body;
  SimpleValidator(req.body, {
    phone: "required|string",
    dialCode: "required|string",
  });
  const invitedUser = await User.findOne({ phone });
  if (invitedUser) {
    throw new AppError("User already exists", 400);
  }

  // Send SMS to the user
  const sms = new SMS(`${dialCode}${phone}`)
    .text(
      `You have been invited to join the ${process.env.APP_NAME} app. Please download the app from the link below: ${process.env.APP_URL}`
    )
    .send();
  return res.status(200).json({
    message: "Invitation SMS sent to the user",
  });
});

exports.findContact = catchAsync(async (req, res) => {
  const { user } = req;
  const { phone, dialCode } = req.body;
  SimpleValidator(req.body, {
    phone: "required|string",
  });
  let contacts = await User.find({ phone })
    .select("phone dialCode firstName lastName photo username")
    .lean();
  if (contacts.length === 0) {
    throw new AppError("User not found", 404);
  }
  return res.status(200).json({
    message: "Contact found",
    contacts,
  });
});

exports.sendRequest = catchAsync(async (req, res) => {
  const { user } = req;
  const { receiverId } = req.params;
  let checkAccount = await User.findOne({ _id: receiverId });
  if (!checkAccount) {
    throw new AppError("User not found", 404);
  }
  let checkContact = await User.findOne({
    _id: user._id,
    contacts: { $elemMatch: { user: checkAccount._id } },
  });
  if (checkContact) {
    throw new AppError("Contact already exists", 400);
  }
  await User.updateOne(
    { _id: user._id },
    { $push: { contacts: { user: checkAccount._id, status: "sent" } } }
  );
  await User.updateOne(
    { _id: checkAccount._id },
    { $push: { contacts: { user: user._id, status: "received" } } }
  );
  return res.status(200).json({
    message: "Request sent to the user",
  });
});

exports.acceptRequest = catchAsync(async (req, res) => {
  const { user } = req;
  const { receiverId } = req.params;
  let checkAccount = await User.findOne({ _id: receiverId });
  if (!checkAccount) {
    throw new AppError("User not found", 404);
  }
  let checkContact = await User.findOne({
    _id: user._id,
    contacts: { $elemMatch: { user: checkAccount._id, status: "sent" } },
  });
  if (!checkContact) {
    throw new AppError("Contact not found", 404);
  }
  await User.updateOne(
    { _id: user._id, "contacts.user": checkAccount._id },
    { $set: { "contacts.$.status": "active" } }
  );
  await User.updateOne(
    { _id: checkAccount._id, "contacts.user": user._id },
    { $set: { "contacts.$.status": "active" } }
  );
  return res.status(200).json({
    message: "Request accepted",
  });
});

exports.getContacts = catchAsync(async (req, res) => {
  const { user } = req;
  let { page = 1, limit = 10, status = "active", search = "" } = req.query;
  page = parseInt(page);
  limit = parseInt(limit);

  let aggregatedQuery = User.aggregate([
    {
      $match: {
        _id: user._id,
        "contacts.status": status,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "contacts.user",
        foreignField: "_id",
        as: "contacts",
      },
    },
    {
      $unwind: "$contacts",
    },
    {
      $replaceRoot: {
        newRoot: "$contacts",
      },
    },

    {
      $match: {
        ...(search && {
          $or: [
            { firstName: { $regex: search, $options: "i" } },
            { lastName: { $regex: search, $options: "i" } },
            { username: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
          ],
        }),
      },
    },
    {
      $project: {
        _id: 1,
        firstName: 1,
        lastName: 1,
        username: 1,
        phone: 1,
        dialCode: 1,
        photo: 1,
        status: 1,
      },
    },
  ]);

  let contacts = await User.aggregatePaginate(aggregatedQuery, {
    page,
    limit,
  });

  return res.status(200).json({
    message: "Contacts fetched successfully",
    contacts,
  });
});
