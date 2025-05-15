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
      // credentials: true
      transports: ["websocket", "polling"],
      credentials: false,
    },
  });

  // Socket.IO middleware for authentication
  // io.use(async (socket, next) => {
  //   try {
  //     const token = socket.handshake.auth.token;

  //     if (!token) {
  //       return next(new Error("Authentication error: Token missing"));
  //     }

  //     // Verify JWT token
  //     const decoded = jwt.verify(token, process.env.JWT_SECRET);

  //     // Get user from database
  //     const user = await User.findById(decoded.id);

  //     if (!user) {
  //       return next(new Error("Authentication error: User not found"));
  //     }

  //     if (user.status === "blocked" || user.status === "deleted") {
  //       return next(new Error("Authentication error: User blocked or deleted"));
  //     }

  //     // Attach user to socket
  //     socket.user = {
  //       id: user._id.toString(),
  //       username: user.username,
  //       firstName: user.firstName,
  //       lastName: user.lastName,
  //     };

  //     next();
  //   } catch (error) {
  //     return next(new Error("Authentication error: " + error.message));
  //   }
  // });

  // Connection handler
  io.on("connection", async (socket) => {
    console.log("Socket Connected: ");

    socket.on("disconnect", () => {
      console.log("Disconnected: " + socket);
    });

    // Broadcast user's online status to others
    socket.broadcast.emit("user_online", {
      // userId: socket.user.id,
    });

    socket.on("join_chat", (chatSessionId) => {
      console.log("join_chat", chatSessionId);
      socket.join(chatSessionId);
    });

    socket.on("leave_chat", (chatSessionId) => {
      console.log("leave_chat", chatSessionId);
      socket.leave(chatSessionId);
    });

    // Handle typing indicators
    socket.on("typing", (data) => {
      console.log("typing", data);
      if (data && data.receiverId) {
        io.to(`user_${data.receiverId}`).emit("typing_start", {
          // userId: socket.user.id,
        });
      }
    });

    socket.on("stop_typing", (data) => {
      console.log("stop_typing", data);
      if (data && data.receiverId) {
        io.to(`user_${data.receiverId}`).emit("stop_typing", {
          // userId: socket.user.id,
        });
      }
    });

    // Handle message delivery status
    socket.on("message_delivered", async (data) => {
      if (data && data.messageId && data.senderId) {
        io.to(`user_${data.senderId}`).emit("message_delivered", {
          messageId: data.messageId,
          // userId: socket.user.id,
        });
      }
    });
    
  });

  return io;
};

module.exports = {
  initSocketServer,
};
