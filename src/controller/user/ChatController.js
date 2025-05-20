const { Types } = require("mongoose");
const { upload } = require("../../config/file");
const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");
const Attachment = require("../../model/Attachment");
const ChatSession = require("../../model/ChatSession");
const Message = require("../../model/Message");
const User = require("../../model/User");
const SimpleValidator = require("../../validator/simpleValidator");
const { pushNotification } = require("../../config/pusher");
const { getFormattedReactions } = require("../../services/ChatService");
exports.findChatSessionByReceipient = catchAsync(async (req, res) => {
  const { user } = req;
  const { receipientId } = req.params;

  SimpleValidator(req.params, {
    receipientId: "required|string",
  });

  // Find a personal chat session where both users are recipients
  const chatSession = await ChatSession.findOne({
    type: "personal",
    receipients: {
      $all: [
        { $elemMatch: { user: user._id } },
        { $elemMatch: { user: receipientId } },
      ],
    },
  })
    .populate("lastMessage")

    .populate(
      "receipients.user",
      "firstName lastName photo dialCode phone status"
    )
    .lean();

  if (!chatSession) {
    console.log("chatSession not found", {
      type: "personal",
      receipients: [
        { user: user._id, status: "active" },
        { user: receipientId, status: "active" },
      ],
    });
    let newChatSession = await ChatSession.create({
      type: "personal",
      receipients: [
        { user: user._id, status: "active" },
        { user: receipientId, status: "active" },
      ],
    });

    newChatSession = await ChatSession.findById(newChatSession._id)
      .populate("lastMessage")
      .populate(
        "receipients.user",
        "firstName lastName photo dialCode phone status"
      )
      .lean();
    let otherUser =
      newChatSession.receipients.find(
        (receipient) => receipient.user._id.toString() !== user._id.toString()
      )?.user ?? {};

    newChatSession.otherUser = otherUser;
    newChatSession.title =
      newChatSession.type === "personal"
        ? `${otherUser.firstName} ${otherUser.lastName}`
        : newChatSession.title;
    newChatSession.photo =
      newChatSession.type === "personal"
        ? otherUser.photo
        : newChatSession.photo;

    return res.status(200).json({
      message: "Chat session created successfully",
      data: newChatSession,
    });
  } else {
    let otherUser =
      chatSession.receipients.find(
        (receipient) => receipient.user?._id.toString() !== user._id.toString()
      )?.user ?? {};

    chatSession.otherUser = otherUser;
    chatSession.title =
      chatSession.type === "personal"
        ? `${otherUser.firstName} ${otherUser.lastName}`
        : chatSession.title;
    chatSession.photo =
      chatSession.type === "personal" ? otherUser.photo : chatSession.photo;
  }

  return res.status(200).json({
    message: "Chat session found",
    data: chatSession,
  });
});

exports.createChatSession = catchAsync(async (req, res) => {
  const { user } = req;
  console.log("req.body", req.body);
  const { recepientIds, title, type } = req.body;

  SimpleValidator(req.body, {
    recepientIds: "required|array",
    type: "required|string",
  });

  let receipients = recepientIds.map((id) => ({
    user: id,
    status: "active",
  }));

  receipients.push({
    user: user._id,
    status: "active",
    role: "admin",
  });

  let chatSession = await ChatSession.create({
    receipients,
    title,
    createdBy: user._id,
    type,
  });

  chatSession = await ChatSession.findById(chatSession._id)
    .populate("lastMessage")
    .populate(
      "receipients.user",
      "firstName lastName photo dialCode phone status"
    )
    .lean();
  let otherUser =
    chatSession.receipients.find(
      (receipient) => receipient.user.toString() !== user._id.toString()
    )?.user ?? {};

  chatSession.otherUser = otherUser;
  chatSession.title =
    chatSession.type === "personal"
      ? `${otherUser.firstName} ${otherUser.lastName}`
      : chatSession.title;
  chatSession.photo =
    chatSession.type === "personal" ? otherUser.photo : chatSession.photo;

  return res.status(200).json({
    message: "Chat session created successfully",
    data: chatSession,
  });
});

exports.sessionList = catchAsync(async (req, res) => {
  const { user } = req;
  const { page, limit, type = "personal" } = req.query;

  let aggregate = ChatSession.aggregate([
    {
      $match: {
        receipients: { $elemMatch: { user: user._id } },
        // lastMessage: { $ne: null },

        ...(type && { type }),
      },
    },

    {
      $lookup: {
        from: "messages",
        localField: "lastMessage",
        foreignField: "_id",
        as: "lastMessage",
      },
    },
    {
      $unwind: {
        path: "$lastMessage",
        preserveNullAndEmptyArrays: true,
      },
    },
    // Add lookup for other user in personal chats
    {
      $lookup: {
        from: "users",
        let: { receipients: "$receipients" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$receipients.user"] },
                  { $ne: ["$_id", user._id] },
                ],
              },
            },
          },
          {
            $project: {
              firstName: 1,
              lastName: 1,
              photo: 1,
              dialCode: 1,
              phone: 1,
              _id: 1,
              status: 1,
            },
          },
        ],
        as: "otherUser",
      },
    },
    {
      $addFields: {
        title: {
          $cond: {
            if: { $eq: ["$type", "personal"] },
            then: {
              $concat: [
                { $arrayElemAt: ["$otherUser.firstName", 0] },
                " ",
                { $arrayElemAt: ["$otherUser.lastName", 0] },
              ],
            },
            else: "$title",
          },
        },
      },
    },

    {
      $lookup: {
        from: "users",
        localField: "receipients.user",
        foreignField: "_id",
        as: "receipientUsers",
        pipeline: [
          {
            $project: {
              firstName: 1,
              lastName: 1,
              photo: 1,
              dialCode: 1,
              phone: 1,
              _id: 1,
              status: 1,
            },
          },
        ],
      },
    },
    {
      $addFields: {
        receipients: {
          $map: {
            input: "$receipients",
            as: "receipient",
            in: {
              $mergeObjects: [
                "$$receipient",
                {
                  user: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$receipientUsers",
                          as: "ru",
                          cond: { $eq: ["$$ru._id", "$$receipient.user"] },
                        },
                      },
                      0,
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },

    {
      $addFields: {
        photo: {
          $cond: {
            if: { $eq: ["$type", "personal"] },
            then: { $arrayElemAt: ["$otherUser.photo", 0] },
            else: "$photo",
          },
        },
      },
    },
    {
      $unwind: {
        path: "$otherUser",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: {
        createdAt: -1,
      },
    },
  ]);

  let records = await ChatSession.aggregatePaginate(aggregate, {
    page: parseInt(page),
    limit: parseInt(limit),
  });

  return res.status(200).json({
    message: "Chat sessions fetched successfully",
    data: records,
  });
});

exports.sendMessage = catchAsync(async (req, res) => {
  const { user } = req;
  const { chatSessionId, message, replyTo } = req.body;

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
    !chatSession.receipients.some(
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
      criteria: "message",
    });
    attachmentIds.push(attachmentInfo._id);
  }

  let messageInfo = await Message.create({
    chatSession: chatSessionId,
    content: message,
    attachments: attachmentIds,
    sender: user._id,
    replyTo,
  });

  await ChatSession.findByIdAndUpdate(chatSessionId, {
    $set: {
      lastMessage: messageInfo._id,
    },
  });

  messageInfo = await Message.findById(messageInfo._id)
    .populate("attachments")
    .populate("sender", "firstName lastName photo dialCode phone")
    .populate("replyTo", "content")
    .lean();

  io.to(chatSessionId).emit("new_message", messageInfo);

  return res.status(200).json({
    message: "Message sent successfully",
    data: messageInfo,
  });
});

exports.getMessages = catchAsync(async (req, res) => {
  const { user } = req;
  const { page, limit } = req.query;
  const { chatSessionId } = req.params;

  SimpleValidator(req.params, {
    chatSessionId: "required|mongoid",
  });

  const chatSession = await ChatSession.findById(chatSessionId);
  if (!chatSession) {
    throw new AppError("Chat session not found", 404);
  }

  let aggregate = Message.aggregate([
    {
      $match: {
        chatSession: new Types.ObjectId(chatSessionId),
      },
    },
    {
      $unwind: {
        path: "$reactions",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "reactions.reactedBy",
        foreignField: "_id",
        as: "reactionUser",
      },
    },
    {
      $unwind: {
        path: "$reactionUser",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: {
          messageId: "$_id",
          reaction: "$reactions.reaction",
        },
        users: {
          $push: {
            _id: "$reactionUser._id",
            firstName: "$reactionUser.firstName",
            lastName: "$reactionUser.lastName",
            reaction: "$reactions.reaction",
            reactedAt: "$reactions.reactedAt",
          },
        },
        doc: { $first: "$$ROOT" },
      },
    },
    {
      $group: {
        _id: "$_id.messageId",
        reactions: {
          $push: {
            reaction: "$_id.reaction",
            users: "$users",
          },
        },
        doc: { $first: "$doc" },
      },
    },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ["$doc", { reactions: "$reactions" }],
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "sender",
        foreignField: "_id",
        as: "sender",
        pipeline: [
          {
            $project: {
              firstName: 1,
              lastName: 1,
              photo: 1,
              dialCode: 1,
              phone: 1,
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: "$sender",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: "attachments",
        localField: "attachments",
        foreignField: "_id",
        as: "attachments",
      },
    },
    {
      $lookup: {
        from: "messages",
        localField: "replyTo",
        foreignField: "_id",
        as: "replyTo",
        pipeline: [
          {
            $project: {
              content: 1,
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: "$replyTo",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: {
        createdAt: -1,
      },
    },
  ]);

  let records = await Message.aggregatePaginate(aggregate, {
    page: parseInt(page),
    limit: parseInt(limit),
  });


  records.docs = await Promise.all(
    records.docs.map(async (record) => {
      delete record.reactionUser;

      let reactions = record.reactions?.filter(
        (reaction) => reaction?.reaction
      );

      console.log("reactions", reactions);
      delete record.reactions;

      return { ...record, reactions };
    })
  );
  return res.status(200).json({
    message: "Messages fetched successfully",
    data: records,
  });
});

exports.toggleReaction = catchAsync(async (req, res) => {
  const { user } = req;
  const { messageId, reactionType } = req.body;
  console.log("req.body", req.body);

  const message = await Message.findById(messageId);

  if (!message) {
    throw new AppError("Message not found", 404);
  }

  const reaction = message.reactions.find(
    (reaction) =>
      // reaction.reaction === reactionType &&
      reaction.reactedBy.toString() === user._id.toString()
  );

  if (reaction) {
    message.reactions = message.reactions.filter(
      (reaction) => reaction.reactedBy.toString() !== user._id.toString()
    );
  }

  if (!reaction || (reaction && reactionType !== reaction?.reaction)) {
    message.reactions.push({
      reaction: reactionType,
      reactedBy: user._id,
    });
  }

  await message.save();

  // Get formatted reactions
  const reactions = await getFormattedReactions(messageId);

  // Emit via socket
  io.to(message.chatSession.toString()).emit("message_reactions_updated", {
    messageId,
    reactions,
  });

  return res.status(200).json({
    message: "Message reacted successfully",
    data: message,
  });
});
