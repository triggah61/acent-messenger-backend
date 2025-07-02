const { Types } = require("mongoose");
const { upload } = require("../../config/file");
const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");
const Attachment = require("../../model/Attachment");
const ChatSession = require("../../model/ChatSession");
const Message = require("../../model/Message");
const User = require("../../model/User");
const SimpleValidator = require("../../validator/simpleValidator");
const { getFormattedReactions } = require("../../services/ChatService");
const FCMService = require("../../services/FCMService");
const { 
  sendNewChatSession, 
  sendMessageToChat, 
  sendMessageReactionsUpdate 
} = require("../../config/pusher");

/**
 * Asynchronously add users to each other's contacts (fire and forget)
 * @param {string} userId1 - First user ID
 * @param {string} userId2 - Second user ID
 */
const addUsersToContacts = async (userId1, userId2) => {
  try {
    // Add userId2 to userId1's contacts and userId1 to userId2's contacts
    await Promise.all([
      User.findByIdAndUpdate(
        userId1,
        { $addToSet: { contacts: new Types.ObjectId(userId2) } }
      ),
      User.findByIdAndUpdate(
        userId2,
        { $addToSet: { contacts: new Types.ObjectId(userId1) } }
      )
    ]);
    
    console.log(`Contacts updated: Added ${userId1} and ${userId2} to each other's contacts`);
  } catch (error) {
    console.error('Error adding users to contacts:', error);
    // Don't throw error as this is a background operation
  }
};

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
        { $elemMatch: { user: new Types.ObjectId(user._id) } },
        { $elemMatch: { user: new Types.ObjectId(receipientId) } },
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
        { user: new Types.ObjectId(user._id), status: "active" },
        { user: new Types.ObjectId(receipientId), status: "active" },
      ],
    });
    let newChatSession = await ChatSession.create({
      type: "personal",
      receipients: [
        { user: new Types.ObjectId(user._id), status: "active" },
        { user: new Types.ObjectId(receipientId), status: "active" },
      ],
    });

    newChatSession = await ChatSession.findById(newChatSession._id)
      .populate("lastMessage")
      .populate(
        "receipients.user",
        "firstName lastName photo dialCode phone status"
      )
      .lean();

    // Emit to each recipient's personal room using Pusher
    for (const recipient of newChatSession.receipients || []) {
      if (recipient.user?._id) {
        await sendNewChatSession(recipient.user._id.toString(), newChatSession);
        console.log(`Emitted new_chat_session to user_${recipient.user._id}`);
      }
    }

    // Add users to each other's contacts asynchronously (fire and forget)
    addUsersToContacts(user._id.toString(), receipientId).catch(err => 
      console.error('Background contact addition failed:', err)
    );

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
    // Add users to each other's contacts asynchronously (fire and forget)
    // This handles the case where users have an existing chat but aren't in contacts
    addUsersToContacts(user._id.toString(), receipientId).catch(err => 
      console.error('Background contact addition failed:', err)
    );

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

  // Emit to each recipient's personal room using Pusher
  for (const recipient of chatSession.receipients || []) {
    if (recipient.user?._id) {
      await sendNewChatSession(recipient.user._id.toString(), chatSession);
      console.log(`Emitted new_chat_session to user_${recipient.user._id}`);
    }
  }

  // Add users to each other's contacts asynchronously for personal chats (fire and forget)
  if (chatSession.type === "personal" && recepientIds.length === 1) {
    addUsersToContacts(user._id.toString(), recepientIds[0]).catch(err => 
      console.error('Background contact addition failed:', err)
    );
  }

  return res.status(200).json({
    message: "Chat session created successfully",
    data: chatSession,
  });
});

exports.sessionList = catchAsync(async (req, res) => {
  const { user } = req;

  console.log("user", user);
  const { page, limit, type = "personal" } = req.query;

  let aggregate = ChatSession.aggregate([
    {
      $match: {
        receipients: { $elemMatch: { user: new Types.ObjectId(user._id) } },
        lastMessage: { $ne: null },
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

    // Lookup for recipients user details
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

    // Map recipients with their user details
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

    // Add otherUser field for personal chats (the user who is NOT the current user)
    {
      $addFields: {
        otherUser: {
          $cond: {
            if: { $eq: ["$type", "personal"] },
            then: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$receipientUsers",
                    as: "ru",
                    cond: { $ne: ["$$ru._id", new Types.ObjectId(user._id)] },
                  },
                },
                0,
              ],
            },
            else: null,
          },
        },
      },
    },

    // Set title based on chat type
    {
      $addFields: {
        title: {
          $cond: {
            if: { $eq: ["$type", "personal"] },
            then: {
              $concat: ["$otherUser.firstName", " ", "$otherUser.lastName"],
            },
            else: "$title",
          },
        },
      },
    },

    // Set photo based on chat type
    {
      $addFields: {
        photo: {
          $cond: {
            if: { $eq: ["$type", "personal"] },
            then: "$otherUser.photo",
            else: "$photo",
          },
        },
      },
    },

    // Remove temporary field
    {
      $project: {
        receipientUsers: 0,
      },
    },

    {
      $sort: {
        updatedAt: -1, // Sort by updatedAt to show most recent chats first
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
      (receipient) => receipient.user.toString() === user._id.toString()
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

  // Enhanced Pusher event emission with participants data
  console.log(`Emitting new_message to chat session: ${chatSessionId}`);
  
  // Add participants data and session type for global event broadcasting
  const messageDataWithParticipants = {
    ...messageInfo,
    sessionType: chatSession.type, // Add session type for smart update routing
    participants: chatSession.receipients.map(recipient => ({
      user: {
        _id: recipient.user.toString()
      }
    }))
  };
  
  sendMessageToChat(chatSessionId, messageDataWithParticipants);
  console.log(`Emitted new_message and global_new_message via Pusher to ${chatSession.receipients.length} participants`);

  // Send FCM push notifications to recipients (excluding sender)
  try {
    const recipientIds = chatSession.receipients
      .filter(recipient => recipient.user.toString() !== user._id.toString())
      .map(recipient => recipient.user.toString());

    if (recipientIds.length > 0) {
      // Prepare sender data for notification
      const senderData = {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
      };

      if (chatSession.type === 'group') {
        // Send group message notification
        const groupData = {
          _id: chatSession._id,
          title: chatSession.title,
        };
        
        FCMService.sendGroupMessageNotification(
          recipientIds,
          messageInfo,
          senderData,
          groupData
        ).catch(error => {
          console.error('FCM: Error sending group message notification:', error);
        });
      } else {
        // Send personal message notification to each recipient
        for (const recipientId of recipientIds) {
          FCMService.sendNewMessageNotification(
            recipientId,
            messageInfo,
            senderData
          ).catch(error => {
            console.error(`FCM: Error sending message notification to ${recipientId}:`, error);
          });  
        }
      }
    }
  } catch (error) {
    console.error('FCM: Error in sendMessage notification process:', error);
    // Don't throw error here - message was sent successfully, just notification failed
  }

  res.status(200).json({
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

  // Emit via Pusher
  await sendMessageReactionsUpdate(message.chatSession.toString(), {
    messageId,
    chatSessionId: message.chatSession.toString(),
    reactions,
  });

  return res.status(200).json({
    message: "Message reacted successfully",
    data: message,
  });
});

/**
 * Get chat session by ID
 * Used for FCM notification navigation
 */
exports.getChatSessionById = catchAsync(async (req, res) => {
  const { user } = req;
  const { sessionId } = req.params;

  SimpleValidator(req.params, {
    sessionId: "required|string",
  });

  // Find the chat session and verify user has access to it
  const chatSession = await ChatSession.findOne({
    _id: new Types.ObjectId(sessionId),
    receipients: {
      $elemMatch: { user: new Types.ObjectId(user._id) }
    }
  })
    .populate("lastMessage")
    .populate(
      "receipients.user",
      "firstName lastName photo dialCode phone status"
    )
    .lean();

  if (!chatSession) {
    return res.status(404).json({
      message: "Chat session not found or access denied",
      data: null,
    });
  }

  // Format the response similar to other chat endpoints
  let otherUser = {};
  if (chatSession.type === "personal") {
    otherUser = chatSession.receipients.find(
      (recipient) => recipient.user._id.toString() !== user._id.toString()
    )?.user ?? {};
  }

  chatSession.otherUser = otherUser;
  chatSession.title = chatSession.type === "personal"
    ? `${otherUser.firstName || ''} ${otherUser.lastName || ''}`.trim()
    : chatSession.title;
  chatSession.photo = chatSession.type === "personal" 
    ? otherUser.photo 
    : chatSession.photo;

  return res.status(200).json({
    message: "Chat session found",
    data: chatSession,
  });
});
