const socketIO = require("socket.io");
const jwt = require("jsonwebtoken");
const config = require("../config/config");

let io;

const initializeSocket = (server) => {
  io = socketIO(server, {
    cors: {
      origin: config.clientUrl,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error"));
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      socket.userId = decoded.sub;
      next();
    } catch (err) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.userId}`);

    // Join chat session
    socket.on("join_chat", (sessionId) => {
      socket.join(`chat_${sessionId}`);
    });

    // Leave chat session
    socket.on("leave_chat", (sessionId) => {
      socket.leave(`chat_${sessionId}`);
    });

    // Handle new message
    socket.on("new_message", (data) => {
      const { sessionId, message } = data;
      io.to(`chat_${sessionId}`).emit("message_received", {
        ...message,
        senderId: socket.userId,
      });
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.userId}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized");
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
};
