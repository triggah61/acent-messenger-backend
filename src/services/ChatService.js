const { Types } = require("mongoose");
const ChatSession = require("../model/ChatSession");
const Message = require("../model/Message");

exports.initiateChatSession = async (title, type, user, receipients) => {
  const chatSession = await ChatSession.create({
    title,
    type,
    user,
    receipients,
  });

  return chatSession;
};

exports.getFormattedReactions = async (messageId) => {
  const reactionsAgg = await Message.aggregate([
    { $match: { _id: new Types.ObjectId(messageId) } },
    { $unwind: { path: "$reactions", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "users",
        localField: "reactions.reactedBy",
        foreignField: "_id",
        as: "reactionUser",
      },
    },
    { $unwind: { path: "$reactionUser", preserveNullAndEmptyArrays: true } },
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
      $addFields: {
        reactions: {
          $filter: {
            input: "$reactions",
            as: "reactionItem",
            cond: { $ne: ["$$reactionItem.reaction", null] },
          },
        },
      },
    },
    {
      $project: {
        reactions: 1,
        _id: 0,
      },
    },
  ]);

  let records = reactionsAgg[0]?.reactions || [];
  records = records.filter((record) => record?.reaction );
  return records;
};
