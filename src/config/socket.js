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
  const io = socketIO(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
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
    console.log(`User connected: ${socket.user.id}`);

    // Join user's personal room for private messages
    socket.join(`user_${socket.user.id}`);

    // Update user's online status and socket ID
    await User.findByIdAndUpdate(socket.user.id, {
      isOnline: true,
      lastSeen: Date.now(),
      socketId: socket.id,
    });

    // Broadcast user's online status to others
    socket.broadcast.emit("user_online", {
      userId: socket.user.id,
    });

    // Handle typing indicators
    socket.on("typing_start", (data) => {
      if (data && data.receiverId) {
        io.to(`user_${data.receiverId}`).emit("typing_start", {
          userId: socket.user.id,
        });
      }
    });

    socket.on("typing_stop", (data) => {
      if (data && data.receiverId) {
        io.to(`user_${data.receiverId}`).emit("typing_stop", {
          userId: socket.user.id,
        });
      }
    });

    // Handle message delivery status
    socket.on("message_delivered", async (data) => {
      if (data && data.messageId && data.senderId) {
        io.to(`user_${data.senderId}`).emit("message_delivered", {
          messageId: data.messageId,
          userId: socket.user.id,
        });
      }
    });

    // Handle disconnection
    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${socket.user.id}`);

      // Update user's offline status
      await User.findByIdAndUpdate(socket.user.id, {
        isOnline: false,
        lastSeen: Date.now(),
        socketId: null,
      });

      // Broadcast user's offline status to others
      socket.broadcast.emit("user_offline", {
        userId: socket.user.id,
        lastSeen: new Date(),
      });
    });
  });

  return io;
};

module.exports = initSocketServer;
