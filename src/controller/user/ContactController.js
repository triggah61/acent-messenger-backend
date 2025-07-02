const SMS = require("../../config/sms");
const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");
const User = require("../../model/User");
const SimpleValidator = require("../../validator/simpleValidator");
const {
  createPhoneMatchingPipeline,
  isValidPhoneNumber,
} = require("../../utils/phoneNumberUtils");

exports.sendInvitation = catchAsync(async (req, res) => {
  const { user } = req;
  const { phone, dialCode } = req.body;
  SimpleValidator(req.body, {
    phone: "required|string",
    // dialCode: "required|string",
  });
  const invitedUser = await User.findOne({ phone });
  if (invitedUser) {
    throw new AppError("User already exists", 400);
  }

  try {
    // Send SMS to the user
    const smsResult = await new SMS(`${dialCode}${phone}`)
      .text(
        `You have been invited to join the ${process.env.APP_NAME} app. Please download the app from the link below: ${process.env.APP_URL}`
      )
      .send();

    console.log("Invitation SMS sent successfully:", smsResult);

    return res.status(200).json({
      message: "Invitation SMS sent to the user",
      smsResult: {
        messageSid: smsResult.messageSid,
        status: smsResult.status,
      },
    });
  } catch (error) {
    console.error("Failed to send invitation SMS:", error.message);
    throw new AppError(`Failed to send invitation SMS: ${error.message}`, 500);
  }
});

exports.findContact = catchAsync(async (req, res) => {
  const { user } = req;
  const { phone, dialCode } = req.body;
  SimpleValidator(req.body, {
    phone: "required|string",
  });

  // Use the phone matching pipeline for a single phone number
  const phoneToSearch = dialCode ? `${dialCode}${phone}` : phone;
  const matchingPipeline = createPhoneMatchingPipeline([phoneToSearch]);

  if (matchingPipeline.length === 0) {
    throw new AppError("Invalid phone number format", 400);
  }

  // Build aggregation pipeline
  const aggregationPipeline = [
    // First match users with activated status
    {
      $match: {
        status: "activated",
      },
    },
    // Apply phone matching pipeline
    ...matchingPipeline,
    // Select required fields including searchedPhone
    {
      $project: {
        phone: 1,
        dialCode: 1,
        firstName: 1,
        lastName: 1,
        photo: 1,
        username: 1,
        searchedPhone: 1, // Include the searched phone number
      },
    },
  ];

  let contacts = await User.aggregate(aggregationPipeline);

  if (contacts.length === 0) {
    throw new AppError("User not found", 404);
  }
  return res.status(200).json({
    message: "Contact found",
    contacts,
  });
});

exports.checkPhoneNumbers = catchAsync(async (req, res) => {
  const { user } = req;
  const { phoneNumbers } = req.body;

  SimpleValidator(req.body, {
    phoneNumbers: "required|array",
  });

  // Filter out invalid phone numbers
  const validPhoneNumbers = phoneNumbers.filter((phone) =>
    isValidPhoneNumber(phone)
  );

  if (validPhoneNumbers.length === 0) {
    return res.status(200).json([]);
  }

  // Use the phone matching pipeline for robust phone number matching
  const matchingPipeline = createPhoneMatchingPipeline(validPhoneNumbers);

  // If no valid phone numbers provided, return empty array
  if (matchingPipeline.length === 0) {
    return res.status(200).json([]);
  }

  // Build aggregation pipeline
  const aggregationPipeline = [
    // First match users with activated status
    {
      $match: {
        status: "activated",
      },
    },
    // Apply phone matching pipeline
    ...matchingPipeline,
    // Select required fields including searchedPhone
    {
      $project: {
        firstName: 1,
        lastName: 1,
        phone: 1,
        dialCode: 1,
        photo: 1,
        username: 1,
        searchedPhone: 1, // Include the searched phone number
      },
    },
  ];

  const existingUsers = await User.aggregate(aggregationPipeline);

  // console.log(existingUsers);

  // Update user's contacts with found user IDs
  if (existingUsers.length > 0) {
    let ids = existingUsers.map((foundUser) => foundUser._id);
    console.log("existingUsers", ids,user);
    await User.findByIdAndUpdate(user._id, { contacts: ids });
  }

  res.status(200).json(existingUsers);
});

exports.globalSearch = catchAsync(async (req, res) => {
  const { user } = req;
  const { search, excepts } = req.body;
  const users = await User.aggregate([
    {
      $match: {
        status: "activated",
        _id: { $ne: user._id },
        ...(excepts && {
          _id: { $nin: excepts },
        }),
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
      },
    },
  ]);
  return res.status(200).json(users);
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
  const { senderId } = req.params;
  let checkAccount = await User.findOne({ _id: senderId });
  if (!checkAccount) {
    throw new AppError("User not found", 404);
  }
  let checkContact = await User.findOne({
    _id: user._id,
    contacts: { $elemMatch: { user: checkAccount._id, status: "received" } },
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
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "contacts",
        foreignField: "_id",
        as: "contacts",
        pipeline: [
          {
            $match: {
              status: "activated",
              _id: { $ne: user._id },
            },
          },
        ],
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

  if (limit == -1) {
    limit = 999999;
  }

  let contacts = await User.aggregatePaginate(aggregatedQuery, {
    page,
    limit,
  });

  return res.status(200).json({
    message: "Contacts fetched successfully",
    contacts,
  });
});
