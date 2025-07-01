/**
 * @fileoverview Pusher configuration for real-time communication
 *
 * This module configures and manages Pusher connections for real-time
 * chat functionality, including message delivery, typing indicators,
 * and online status updates. This replaces the socket.io implementation
 * while maintaining the same functionality and behavior.
 *
 * @module config/pusher
 * @requires pusher
 * @requires jsonwebtoken
 * @requires ../model/User
 */

const Pusher = require("pusher");
const jwt = require("jsonwebtoken");
const User = require("../model/User");

// Track user connections and their channels
const userConnections = new Map(); // userId -> Set of connection info
const activeUserChannels = new Map(); // userId -> Set of channel names
const userActiveChatSessions = new Map(); // userId -> Set of chatSessionIds

/**
 * Initialize Pusher server and configure event handlers
 * @function
 * @returns {Object} Pusher server instance
 */
const initPusherServer = () => {
  // Initialize Pusher with environment variables
  global.pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER || "mt1",
    useTLS: true,
  });

  console.log("Pusher server initialized with real-time messaging support");
  console.log(`Pusher configuration: cluster=${process.env.PUSHER_CLUSTER || "mt1"}, key=${process.env.PUSHER_KEY}`);

  return global.pusher;
};

/**
 * Authenticate user for Pusher channels
 * @param {string} token - JWT token
 * @returns {Object} User object or null
 */
const authenticateUserForPusher = async (token) => {
  try {
    if (!token) {
      return null;
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const user = await User.findById(decoded.id);

    if (!user) {
      return null;
    }

    if (user.status === "blocked" || user.status === "deleted") {
      return null;
    }

    return {
      id: user._id.toString(),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  } catch (error) {
    console.error(`Pusher authentication error: ${error.message}`);
    return null;
  }
};

/**
 * Handle user connection to Pusher
 * @param {string} userId - User ID
 * @param {string} socketId - Pusher socket ID
 */
const handleUserConnection = async (userId, socketId) => {
  console.log(`Pusher: User ${userId} connected with socket ${socketId}`);

  // Track connection
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  userConnections.get(userId).add(socketId);

  // Initialize user channels
  if (!activeUserChannels.has(userId)) {
    activeUserChannels.set(userId, new Set());
  }

  // Initialize user chat sessions
  if (!userActiveChatSessions.has(userId)) {
    userActiveChatSessions.set(userId, new Set());
  }

  // Broadcast user online status
  try {
    await global.pusher.trigger("presence-user-status", "user_online", {
      userId: userId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error broadcasting user online status: ${error.message}`);
  }
};

/**
 * Handle user disconnection from Pusher
 * @param {string} userId - User ID
 * @param {string} socketId - Pusher socket ID
 */
const handleUserDisconnection = async (userId, socketId) => {
  console.log(`Pusher: User ${userId} disconnected, socket ${socketId}`);

  // Clean up connection tracking
  if (userConnections.has(userId)) {
    userConnections.get(userId).delete(socketId);
    if (userConnections.get(userId).size === 0) {
      userConnections.delete(userId);
      console.log(`All connections closed for user: ${userId}`);

      // Clean up user channels and sessions
      activeUserChannels.delete(userId);
      userActiveChatSessions.delete(userId);

      // Broadcast user offline status
      try {
        await global.pusher.trigger("presence-user-status", "user_offline", {
          userId: userId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`Error broadcasting user offline status: ${error.message}`);
      }
    }
  }
};

/**
 * Subscribe user to a chat session channel
 * @param {string} userId - User ID
 * @param {string} chatSessionId - Chat session ID
 */
const joinChatSession = async (userId, chatSessionId) => {
  if (!chatSessionId) {
    console.warn(`User ${userId} tried to join chat with invalid ID`);
    return false;
  }

  console.log(`User ${userId} joining chat: ${chatSessionId}`);

  // Add to user's active chat sessions
  if (!userActiveChatSessions.has(userId)) {
    userActiveChatSessions.set(userId, new Set());
  }
  userActiveChatSessions.get(userId).add(chatSessionId);

  // Add to user's active channels
  if (!activeUserChannels.has(userId)) {
    activeUserChannels.set(userId, new Set());
  }
  activeUserChannels.get(userId).add(`private-chat_${chatSessionId}`);

  console.log(`User ${userId} successfully joined chat: ${chatSessionId}`);
  return true;
};

/**
 * Unsubscribe user from a chat session channel
 * @param {string} userId - User ID
 * @param {string} chatSessionId - Chat session ID
 */
const leaveChatSession = async (userId, chatSessionId) => {
  if (!chatSessionId) {
    console.warn(`User ${userId} tried to leave chat with invalid ID`);
    return false;
  }

  console.log(`User ${userId} leaving chat: ${chatSessionId}`);

  // Remove from user's active chat sessions
  if (userActiveChatSessions.has(userId)) {
    userActiveChatSessions.get(userId).delete(chatSessionId);
  }

  // Remove from user's active channels
  if (activeUserChannels.has(userId)) {
    activeUserChannels.get(userId).delete(`private-chat_${chatSessionId}`);
  }

  console.log(`User ${userId} successfully left chat: ${chatSessionId}`);
  return true;
};

/**
 * Send message to a chat session
 * @param {string} chatSessionId - Chat session ID
 * @param {Object} messageData - Message data
 */
const sendMessageToChat = async (chatSessionId, messageData) => {
  try {
    // Send to chat channel for real-time updates
    await global.pusher.trigger(
      `private-chat_${chatSessionId}`,
      "new_message",
      messageData
    );
    
    console.log(`Message sent to chat channel: private-chat_${chatSessionId}`);

    // Send notification to all participants' personal channels
    if (messageData.participants && Array.isArray(messageData.participants)) {
      for (const participant of messageData.participants) {
        if (participant.user && participant.user._id) {
          const userId = participant.user._id.toString();
          
          // Don't send to the sender
          if (userId !== messageData.sender._id.toString()) {
            try {
              await global.pusher.trigger(
                `private-user_${userId}`,
                "global_new_message",
                messageData
              );
              console.log(`Global message notification sent to user: ${userId}`);
            } catch (error) {
              console.error(`Error sending global message to user ${userId}:`, error);
            }
          }
        }
      }
    }

    return true;
  } catch (error) {
    console.error(`Failed to send message to chat ${chatSessionId}:`, error);
    return false;
  }
};

/**
 * Send typing indicator to chat session
 * @param {string} chatSessionId - Chat session ID
 * @param {string} userId - User ID who is typing
 * @param {boolean} isTyping - Whether user is typing
 */
const sendTypingIndicator = async (chatSessionId, userId, isTyping) => {
  try {
    const eventName = isTyping ? "typing_start" : "typing_stop";
    
    await global.pusher.trigger(`private-chat_${chatSessionId}`, eventName, {
      userId: userId,
      chatSessionId: chatSessionId,
      isTyping: isTyping,
      timestamp: new Date().toISOString(),
    });

    console.log(`Typing indicator sent: ${eventName} for user ${userId} in chat ${chatSessionId}`);
    return true;
  } catch (error) {
    console.error(`Failed to send typing indicator:`, error);
    return false;
  }
};

/**
 * Send message read status
 * @param {string} chatSessionId - Chat session ID
 * @param {string} messageId - Message ID
 * @param {string} readByUserId - User ID who read the message
 */
const sendMessageReadStatus = async (chatSessionId, messageId, readByUserId) => {
  try {
    await global.pusher.trigger(`private-chat_${chatSessionId}`, "message_read", {
      messageId: messageId,
      chatSessionId: chatSessionId,
      readBy: readByUserId,
      timestamp: new Date().toISOString(),
    });

    console.log(`Message read status sent for message ${messageId} by user ${readByUserId}`);
    return true;
  } catch (error) {
    console.error(`Failed to send message read status:`, error);
    return false;
  }
};

/**
 * Send message reactions update
 * @param {string} chatSessionId - Chat session ID
 * @param {Object} reactionData - Reaction data
 */
const sendMessageReactionsUpdate = async (chatSessionId, reactionData) => {
  try {
    await global.pusher.trigger(
      `private-chat_${chatSessionId}`,
      "message_reactions_updated",
      reactionData
    );
    
    console.log(`Message reactions update sent to chat ${chatSessionId}`);
    return true;
  } catch (error) {
    console.error(`Failed to send message reactions update:`, error);
    return false;
  }
};

/**
 * Send user status update
 * @param {string} userId - User ID
 * @param {string} status - User status (online, offline, away)
 */
const sendUserStatusUpdate = async (userId, status) => {
  try {
    await global.pusher.trigger("presence-user-status", "user_status_update", {
      userId: userId,
      status: status,
      timestamp: new Date().toISOString(),
    });

    console.log(`User status update sent: ${userId} -> ${status}`);
    return true;
  } catch (error) {
    console.error(`Failed to send user status update:`, error);
    return false;
  }
};

/**
 * Send new chat session notification
 * @param {string} recipientUserId - Recipient user ID
 * @param {Object} sessionData - Chat session data
 */
const sendNewChatSession = async (recipientUserId, sessionData) => {
  try {
    await global.pusher.trigger(
      `private-user_${recipientUserId}`, 
      "new_chat_session", 
      sessionData
    );
    
    console.log(`New chat session notification sent to user ${recipientUserId}`);
    return true;
  } catch (error) {
    console.error(`Failed to send new chat session notification:`, error);
    return false;
  }
};

// Helper functions for compatibility with existing code
global.getUserConnectionCount = (userId) => {
  return userConnections.has(userId) ? userConnections.get(userId).size : 0;
};

global.isUserOnline = (userId) => {
  return userConnections.has(userId) && userConnections.get(userId).size > 0;
};

global.getUserRooms = (userId) => {
  return activeUserChannels.has(userId)
    ? Array.from(activeUserChannels.get(userId))
    : [];
};

global.getUserActiveChatSessions = (userId) => {
  return userActiveChatSessions.has(userId)
    ? Array.from(userActiveChatSessions.get(userId))
    : [];
};

global.getConnectionStats = () => {
  const connectedUserCount = userConnections.size;
  const totalConnections = Array.from(userConnections.values()).reduce(
    (total, connections) => total + connections.size,
    0
  );

  return {
    connectedUsers: connectedUserCount,
    totalConnections: totalConnections,
    activeChannels: Array.from(activeUserChannels.values()).reduce(
      (total, channels) => total + channels.size,
      0
    ),
  };
};

module.exports = {
  initPusherServer,
  authenticateUserForPusher,
  handleUserConnection,
  handleUserDisconnection,
  joinChatSession,
  leaveChatSession,
  sendMessageToChat,
  sendTypingIndicator,
  sendMessageReadStatus,
  sendUserStatusUpdate,
  sendNewChatSession,
  sendMessageReactionsUpdate,
};
