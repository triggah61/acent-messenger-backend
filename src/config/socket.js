/**
 * @fileoverview Socket.IO handler for real-time communication
 *
 * This module configures and manages Socket.IO connections for real-time
 * chat functionality, including message delivery, typing indicators,
 * and online status updates.
 *
 * @module config/socket
 * @requires socket.io
 * @requires jsonwebtoken
 * @requires ../model/User
 */

const socketIO = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../model/User");

// Track user connections: userId -> Set of socket IDs
const userConnections = new Map();
// Track socket to user mapping: socketId -> userId
const socketUserMap = new Map();

/**
 * Initialize Socket.IO server and configure event handlers
 * @function
 * @param {Object} server - HTTP server instance
 * @returns {Object} Socket.IO server instance
 */
const initSocketServer = (server) => {
  global.io = socketIO(server, {
    path: "/api/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      transports: ["websocket", "polling"],
      credentials: false,
    },
    // Add ping/pong configuration for connection health
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Socket.IO middleware for authentication
  io.use(async (socket, next) => {
    try {
      // Check for token in headers (from Authorization: Bearer <token>)
      const authHeader = socket.handshake.headers.authorization;
      let token = null;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
      
      // Fallback to auth token if no bearer token
      if (!token) {
        token = socket.handshake.auth.token;
      }

      if (!token) {
        return next(new Error("Authentication error: Token missing"));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from database
      const user = await User.findById(decoded.id);

      if (!user) {
        return next(new Error("Authentication error: User not found"));
      }

      if (user.status === "blocked" || user.status === "deleted") {
        return next(new Error("Authentication error: User blocked or deleted"));
      }

      // Attach user to socket
      socket.user = {
        id: user._id.toString(),
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      };

      console.log(`Authentication successful for user: ${user._id}`);
      next();
    } catch (error) {
      console.error(`Authentication error: ${error.message}`);
      return next(new Error("Authentication error: " + error.message));
    }
  });

  // Connection handler
  io.on("connection", async (socket) => {
    if (!socket.user) {
      console.log("Socket connected without user info - disconnecting");
      socket.disconnect();
      return;
    }

    const userId = socket.user.id;
    console.log(`Socket connected for user: ${userId}, socket: ${socket.id}`);

    // Track this connection
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId).add(socket.id);
    socketUserMap.set(socket.id, userId);

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      console.log(`Socket disconnected for user: ${userId}, socket: ${socket.id}, reason: ${reason}`);
      
      // Clean up connection tracking
      if (userConnections.has(userId)) {
        userConnections.get(userId).delete(socket.id);
        if (userConnections.get(userId).size === 0) {
          userConnections.delete(userId);
          console.log(`All connections closed for user: ${userId}`);
          
          // Broadcast user offline status
          socket.broadcast.emit("user_offline", {
            userId: userId,
            timestamp: new Date().toISOString(),
          });
        }
      }
      socketUserMap.delete(socket.id);
      
      // Automatically leave all rooms (socket.io handles this, but we log it)
      console.log(`Socket ${socket.id} left all rooms due to disconnect`);
    });

    // Handle connection errors
    socket.on("connect_error", (error) => {
      console.error(`Connection error for user ${userId}:`, error);
    });

    // Broadcast user's online status to others
    socket.broadcast.emit("user_online", {
      userId: userId,
      timestamp: new Date().toISOString(),
    });

    // Handle ping/pong for connection health
    socket.on("ping", (data) => {
      console.log(`Ping received from user ${userId}`);
      socket.emit("pong", { userId, timestamp: new Date().toISOString() });
    });

    // Handle user joining their personal room
    socket.on("join_user_room", (requestedUserId) => {
      // Security check: only allow joining own room
      if (requestedUserId !== userId) {
        console.warn(`User ${userId} tried to join room for user ${requestedUserId} - denied`);
        return;
      }
      
      const roomName = `user_${userId}`;
      socket.join(roomName);
      console.log(`User ${userId} joined their personal room: ${roomName}`);
      
      // Confirm to client
      socket.emit("joined_user_room", { userId, roomName });
    });

    // Handle user leaving their personal room
    socket.on("leave_user_room", (requestedUserId) => {
      // Security check: only allow leaving own room
      if (requestedUserId !== userId) {
        console.warn(`User ${userId} tried to leave room for user ${requestedUserId} - denied`);
        return;
      }
      
      const roomName = `user_${userId}`;
      socket.leave(roomName);
      console.log(`User ${userId} left their personal room: ${roomName}`);
      
      // Confirm to client
      socket.emit("left_user_room", { userId, roomName });
    });

    // Handle joining chat sessions
    socket.on("join_chat", (chatSessionId) => {
      console.log(`User ${userId} joining chat: ${chatSessionId}`);
      socket.join(chatSessionId);
      socket.emit("joined_chat", { chatSessionId });
    });

    // Handle leaving chat sessions
    socket.on("leave_chat", (chatSessionId) => {
      console.log(`User ${userId} leaving chat: ${chatSessionId}`);
      socket.leave(chatSessionId);
      socket.emit("left_chat", { chatSessionId });
    });

    // Handle typing indicators
    socket.on("typing", (data) => {
      console.log(`Typing event from user ${userId}:`, data);
      if (data && data.chatSessionId) {
        // Broadcast to all users in the chat session except sender
        socket.to(data.chatSessionId).emit("typing_start", {
          userId: userId,
          chatSessionId: data.chatSessionId,
          timestamp: new Date().toISOString(),
        });
      }
    });

    socket.on("stop_typing", (data) => {
      console.log(`Stop typing event from user ${userId}:`, data);
      if (data && data.chatSessionId) {
        // Broadcast to all users in the chat session except sender
        socket.to(data.chatSessionId).emit("stop_typing", {
          userId: userId,
          chatSessionId: data.chatSessionId,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle message delivery status
    socket.on("message_delivered", async (data) => {
      if (data && data.messageId && data.senderId) {
        io.to(`user_${data.senderId}`).emit("message_delivered", {
          messageId: data.messageId,
          userId: userId,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle global typing indicators
    socket.on("global_typing_indicator", (data) => {
      console.log(`Global typing indicator from user ${userId}:`, data);
      if (data && data.chatSessionId) {
        // Broadcast to all users in the chat session except sender
        socket.to(data.chatSessionId).emit("global_typing", {
          userId: userId,
          chatSessionId: data.chatSessionId,
          isTyping: data.isTyping,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle user status updates
    socket.on("update_user_status", (data) => {
      console.log(`User ${userId} status update:`, data);
      if (data && data.status) {
        // Broadcast status to all connected users
        socket.broadcast.emit("global_user_status", {
          userId: userId,
          status: data.status,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle mark message as read
    socket.on("mark_message_read", (data) => {
      console.log(`Message read by user ${userId}:`, data);
      if (data && data.messageId && data.chatSessionId) {
        // Broadcast to chat session
        socket.to(data.chatSessionId).emit("global_message_read", {
          messageId: data.messageId,
          chatSessionId: data.chatSessionId,
          readBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
    });
  });

  // Add helper function to get user connection count
  global.getUserConnectionCount = (userId) => {
    return userConnections.has(userId) ? userConnections.get(userId).size : 0;
  };

  // Add helper function to check if user is online
  global.isUserOnline = (userId) => {
    return userConnections.has(userId) && userConnections.get(userId).size > 0;
  };

  // Add helper function to disconnect all user sessions (for admin use)
  global.disconnectUser = (userId) => {
    if (userConnections.has(userId)) {
      const socketIds = Array.from(userConnections.get(userId));
      socketIds.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
        }
      });
      console.log(`Disconnected all sessions for user: ${userId}`);
    }
  };

  // Periodic cleanup of stale connections (every 5 minutes)
  setInterval(() => {
    console.log(`Active user connections: ${userConnections.size}`);
    console.log(`Active socket connections: ${io.engine.clientsCount}`);
    
    // Clean up any orphaned entries
    for (const [socketId, userId] of socketUserMap.entries()) {
      if (!io.sockets.sockets.has(socketId)) {
        console.log(`Cleaning up orphaned socket mapping: ${socketId} -> ${userId}`);
        socketUserMap.delete(socketId);
        if (userConnections.has(userId)) {
          userConnections.get(userId).delete(socketId);
          if (userConnections.get(userId).size === 0) {
            userConnections.delete(userId);
          }
        }
      }
    }
  }, 5 * 60 * 1000); // 5 minutes

  return io;
};

module.exports = {
  initSocketServer,
};
