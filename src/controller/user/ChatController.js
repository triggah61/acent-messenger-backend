const { upload } = require("../../config/file");
const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");
const Attachment = require("../../model/Attachment");
const ChatSession = require("../../model/ChatSession");
const Message = require("../../model/Message");
const User = require("../../model/User");
const SimpleValidator = require("../../validator/simpleValidator");

exports.findChatSessionByReceipient = catchAsync(async (req, res) => {
  const { user } = req;
  const { receipientId } = req.params;

  SimpleValidator(req.params, {
    receipientId: "required|string",
  });

  let checkContact = await User.findOne({
    _id: user._id,
    contacts: { $elemMatch: { user: receipientId, status: "active" } },
  });

  if (!checkContact) {
    throw new AppError("Contact not found", 404);
  }

  // Find a personal chat session where both users are recipients
  const chatSession = await ChatSession.findOne({
    type: "personal",
    receipients: {
      $all: [
        { $elemMatch: { user: user._id } },
        { $elemMatch: { user: receipientId } },
      ],
    },
  });

  if (!chatSession) {
    const newChatSession = await ChatSession.create({
      type: "personal",
      receipients: [
        { user: user._id, status: "active" },
        { user: receipientId, status: "active" },
      ],
    });
    return res.status(200).json({
      message: "Chat session created successfully",
      data: newChatSession,
    });
  }

  return res.status(200).json({
    message: "Chat session found",
    data: chatSession,
  });
});

exports.createChatSession = catchAsync(async (req, res) => {
  const { user } = req;
  const { receipientIds, title, type } = req.body;

  SimpleValidator(req.body, {
    receipientIds: "required|array",
    type: "required|string",
  });

  const receipients = receipientIds.map((id) => ({
    user: id,
    status: "active",
  }));

  const chatSession = await ChatSession.create({
    receipients,
    title,
    createdBy: user._id,
  });

  return res.status(200).json({
    message: "Chat session created successfully",
    data: chatSession,
  });
});

exports.sendMessage = catchAsync(async (req, res) => {
  const { user } = req;
  const { chatSessionId, message } = req.body;

  const attachments = req.files;

  SimpleValidator(req.body, {
    chatSessionId: "required|mongoid",
    // message: "required|string",
  });

  console.log("attachments", attachments);

  if (attachments.length <= 0 && !req.body?.message) {
    throw new AppError("Message is required", 400);
  }

  // Check if the chat session exists
  const chatSession = await ChatSession.findById(chatSessionId);
  if (!chatSession) {
    throw new AppError("Chat session not found", 404);
  }

  // Check if the user is a recipient of the chat session
  if (
    chatSession.receipients.some(
      (receipient) => receipient.user.toString() !== user._id.toString()
    )
  ) {
    throw new AppError(
      "You are not allowed to send message to this chat session",
      403
    );
  }

  let attachmentIds = [];
  for (const attachment of attachments) {
    const file = await upload(attachment, "attachments");
    const attachmentInfo = await Attachment.create({
      user: user._id,
      url: file.Location,
      name: file.Key,
      size: file.Size,
    });
    attachmentIds.push(attachmentInfo._id);
  }

  const messageInfo = await Message.create({
    chatSession: chatSessionId,
    message,
    attachments: attachmentIds,
    sender: user._id,
  });

  return res.status(200).json({
    message: "Message sent successfully",
    data: messageInfo,
  });
});
