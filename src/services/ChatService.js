const ChatSession = require("../model/ChatSession");

exports.initiateChatSession = async (title, type, user, receipients) => {
  const chatSession = await ChatSession.create({
    title,
    type,
    user,
    receipients,
  });

  return chatSession;
};
