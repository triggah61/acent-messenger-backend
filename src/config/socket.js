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
// Track user rooms: userId -> Set of room names
const userRooms = new Map();
// Track user's active chat sessions: userId -> Set of chatSessionIds
const userActiveChatSessions = new Map();

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
    // Enhanced ping/pong configuration for better connection health
    pingTimeout: 30000,  // Reduced for faster detection
    pingInterval: 15000, // More frequent pings
    allowEIO3: true,
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

      console.log(`Socket authentication successful for user: ${user._id}`);
      next();
    } catch (error) {
      console.error(`Socket authentication error: ${error.message}`);
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

    // Initialize user rooms if not exists
    if (!userRooms.has(userId)) {
      userRooms.set(userId, new Set());
    }

    // Initialize user chat sessions if not exists
    if (!userActiveChatSessions.has(userId)) {
      userActiveChatSessions.set(userId, new Set());
    }

    // **CRITICAL: Automatically join user's personal room on connection**
    const personalRoomName = `user_${userId}`;
    socket.join(personalRoomName);
    userRooms.get(userId).add(personalRoomName);
    console.log(`User ${userId} automatically joined personal room: ${personalRoomName}`);

    // Confirm to client that they joined their personal room
    socket.emit("joined_user_room", { 
      userId, 
      roomName: personalRoomName,
      auto: true 
    });

    // Broadcast user's online status to others (after joining personal room)
    socket.broadcast.emit("user_online", {
      userId: userId,
      timestamp: new Date().toISOString(),
    });

    // **Enhanced Connection Health Monitoring**
    let lastPongTime = Date.now();
    let pingInterval;

    // Start health monitoring for this socket
    pingInterval = setInterval(() => {
      const now = Date.now();
      if (now - lastPongTime > 35000) { // 35 seconds timeout
        console.log(`Socket ${socket.id} for user ${userId} appears unhealthy, disconnecting`);
        socket.disconnect(true);
        return;
      }
      socket.emit("ping", { timestamp: now });
    }, 15000); // Every 15 seconds

    // Handle pong responses
    socket.on("pong", (data) => {
      lastPongTime = Date.now();
      console.log(`Pong received from user ${userId}`);
    });

    // Enhanced ping handler
    socket.on("ping", (data) => {
      console.log(`Ping received from user ${userId}`);
      socket.emit("pong", { userId, timestamp: new Date().toISOString() });
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      console.log(`Socket disconnected for user: ${userId}, socket: ${socket.id}, reason: ${reason}`);
      
      // Clear health monitoring
      if (pingInterval) {
        clearInterval(pingInterval);
      }

      // Clean up connection tracking
      if (userConnections.has(userId)) {
        userConnections.get(userId).delete(socket.id);
        if (userConnections.get(userId).size === 0) {
          userConnections.delete(userId);
          console.log(`All connections closed for user: ${userId}`);
          
          // Clean up user rooms and sessions
          userRooms.delete(userId);
          userActiveChatSessions.delete(userId);
          
          // Broadcast user offline status
          socket.broadcast.emit("user_offline", {
            userId: userId,
            timestamp: new Date().toISOString(),
          });
        }
      }
      socketUserMap.delete(socket.id);
      
      console.log(`Socket ${socket.id} left all rooms due to disconnect`);
    });

    // Handle connection errors
    socket.on("connect_error", (error) => {
      console.error(`Connection error for user ${userId}:`, error);
    });

    // **Enhanced Room Management**

    // Handle user joining their personal room (manual request)
    socket.on("join_user_room", (requestedUserId) => {
      // Security check: only allow joining own room
      if (requestedUserId !== userId) {
        console.warn(`User ${userId} tried to join room for user ${requestedUserId} - denied`);
        socket.emit("join_user_room_error", { 
          error: "Cannot join another user's room",
          requestedUserId 
        });
        return;
      }
      
      const roomName = `user_${userId}`;
      socket.join(roomName);
      userRooms.get(userId).add(roomName);
      console.log(`User ${userId} manually joined their personal room: ${roomName}`);
      
      // Confirm to client
      socket.emit("joined_user_room", { 
        userId, 
        roomName,
        manual: true 
      });
    });

    // Handle user leaving their personal room (usually not needed)
    socket.on("leave_user_room", (requestedUserId) => {
      // Security check: only allow leaving own room
      if (requestedUserId !== userId) {
        console.warn(`User ${userId} tried to leave room for user ${requestedUserId} - denied`);
        return;
      }
      
      const roomName = `user_${userId}`;
      socket.leave(roomName);
      userRooms.get(userId).delete(roomName);
      console.log(`User ${userId} left their personal room: ${roomName}`);
      
      // Confirm to client
      socket.emit("left_user_room", { userId, roomName });
    });

    // **Enhanced Chat Session Management**

    // Handle joining chat sessions
    socket.on("join_chat", (chatSessionId) => {
      if (!chatSessionId) {
        console.warn(`User ${userId} tried to join chat with invalid ID`);
        socket.emit("join_chat_error", { error: "Invalid chat session ID" });
        return;
      }

      console.log(`User ${userId} joining chat: ${chatSessionId}`);
      socket.join(chatSessionId);
      userActiveChatSessions.get(userId).add(chatSessionId);
      userRooms.get(userId).add(chatSessionId);
      
      socket.emit("joined_chat", { chatSessionId });
      console.log(`User ${userId} successfully joined chat: ${chatSessionId}`);
    });

    // Handle leaving chat sessions
    socket.on("leave_chat", (chatSessionId) => {
      if (!chatSessionId) {
        console.warn(`User ${userId} tried to leave chat with invalid ID`);
        return;
      }

      console.log(`User ${userId} leaving chat: ${chatSessionId}`);
      socket.leave(chatSessionId);
      userActiveChatSessions.get(userId).delete(chatSessionId);
      userRooms.get(userId).delete(chatSessionId);
      
      socket.emit("left_chat", { chatSessionId });
      console.log(`User ${userId} successfully left chat: ${chatSessionId}`);
    });

    // **Re-enabled and Enhanced Typing Indicators**
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

    // **Enhanced Message Delivery System**
    socket.on("message_delivered", async (data) => {
      if (data && data.messageId && data.senderId) {
        console.log(`Message ${data.messageId} delivered to user ${userId} from ${data.senderId}`);
        io.to(`user_${data.senderId}`).emit("message_delivered", {
          messageId: data.messageId,
          userId: userId,
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
        
        // Also emit to personal rooms of all participants
        socket.broadcast.emit("global_message_read", {
          messageId: data.messageId,
          chatSessionId: data.chatSessionId,
          readBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // **Enhanced Room Rejoin Handler** (for reconnections)
    socket.on("rejoin_rooms", (data) => {
      console.log(`User ${userId} requesting to rejoin rooms:`, data);
      
      // Always rejoin personal room
      const personalRoomName = `user_${userId}`;
      socket.join(personalRoomName);
      userRooms.get(userId).add(personalRoomName);
      
      // Rejoin active chat sessions if provided
      if (data && data.chatSessions && Array.isArray(data.chatSessions)) {
        data.chatSessions.forEach(chatSessionId => {
          if (chatSessionId) {
            socket.join(chatSessionId);
            userActiveChatSessions.get(userId).add(chatSessionId);
            userRooms.get(userId).add(chatSessionId);
            console.log(`User ${userId} rejoined chat: ${chatSessionId}`);
          }
        });
      }
      
      socket.emit("rooms_rejoined", {
        personalRoom: personalRoomName,
        chatSessions: data?.chatSessions || [],
        timestamp: new Date().toISOString()
      });
    });

    // **Debug/Status Handlers**
    socket.on("get_connection_status", () => {
      const userRoomsList = Array.from(userRooms.get(userId) || []);
      const activeChatsList = Array.from(userActiveChatSessions.get(userId) || []);
      
      socket.emit("connection_status", {
        userId,
        socketId: socket.id,
        rooms: userRoomsList,
        activeChatSessions: activeChatsList,
        isConnected: true,
        timestamp: new Date().toISOString()
      });
    });

    // **Emergency Room Recovery** (in case client loses sync)
    socket.on("force_rejoin_personal_room", () => {
      const personalRoomName = `user_${userId}`;
      socket.join(personalRoomName);
      userRooms.get(userId).add(personalRoomName);
      
      socket.emit("joined_user_room", { 
        userId, 
        roomName: personalRoomName,
        forced: true 
      });
      
      console.log(`User ${userId} force rejoined personal room: ${personalRoomName}`);
    });

    // Log successful connection setup
    console.log(`Socket setup complete for user ${userId} - rooms: ${Array.from(userRooms.get(userId))}`);
  });

  // **Enhanced Helper Functions**

  // Get user connection count
  global.getUserConnectionCount = (userId) => {
    return userConnections.has(userId) ? userConnections.get(userId).size : 0;
  };

  // Check if user is online
  global.isUserOnline = (userId) => {
    return userConnections.has(userId) && userConnections.get(userId).size > 0;
  };

  // Get user's active rooms
  global.getUserRooms = (userId) => {
    return userRooms.has(userId) ? Array.from(userRooms.get(userId)) : [];
  };

  // Get user's active chat sessions
  global.getUserActiveChatSessions = (userId) => {
    return userActiveChatSessions.has(userId) ? Array.from(userActiveChatSessions.get(userId)) : [];
  };

  // Force user to join their personal room (admin/debug function)
  global.forceUserToPersonalRoom = (userId) => {
    if (userConnections.has(userId)) {
      const socketIds = Array.from(userConnections.get(userId));
      const personalRoomName = `user_${userId}`;
      
      socketIds.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.join(personalRoomName);
          if (!userRooms.has(userId)) {
            userRooms.set(userId, new Set());
          }
          userRooms.get(userId).add(personalRoomName);
          socket.emit("joined_user_room", { 
            userId, 
            roomName: personalRoomName, 
            admin_forced: true 
          });
        }
      });
      console.log(`Admin: Forced user ${userId} to join personal room: ${personalRoomName}`);
      return true;
    }
    return false;
  };

  // Disconnect all user sessions
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
      return true;
    }
    return false;
  };

  // Enhanced periodic cleanup (every 2 minutes for better responsiveness)
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
            userRooms.delete(userId);
            userActiveChatSessions.delete(userId);
            console.log(`Cleaned up all data for user: ${userId}`);
          }
        }
      }
    }

    // Log room statistics
    const totalRooms = Array.from(userRooms.values()).reduce((sum, rooms) => sum + rooms.size, 0);
    console.log(`Total user rooms: ${totalRooms}`);
  }, 2 * 60 * 1000); // 2 minutes

  // **Global status reporter for debugging**
  global.getSocketStatus = () => {
    return {
      activeUsers: userConnections.size,
      totalConnections: io.engine.clientsCount,
      userConnections: Object.fromEntries(
        Array.from(userConnections.entries()).map(([userId, sockets]) => [
          userId, 
          { 
            socketCount: sockets.size, 
            socketIds: Array.from(sockets),
            rooms: Array.from(userRooms.get(userId) || []),
            activeChatSessions: Array.from(userActiveChatSessions.get(userId) || [])
          }
        ])
      )
    };
  };

  console.log("Socket.IO server initialized with enhanced real-time messaging support");
  return io;
};

module.exports = {
  initSocketServer,
};
