/**
 * @fileoverview Pusher authentication and webhook routes
 *
 * This module handles Pusher channel authentication and webhook events
 * to maintain the same functionality as the previous socket.io implementation.
 */

const express = require("express");
const {
  authenticateUserForPusher,
  handleUserConnection,
  handleUserDisconnection,
  joinChatSession,
  leaveChatSession,
  sendTypingIndicator,
  sendMessageReadStatus,
  sendUserStatusUpdate,
  sendMessageReactionsUpdate,
} = require("../../config/pusher");
const Authenticated = require("../../middleware/Authenticated");

const router = express.Router();

/**
 * Pusher channel authentication endpoint
 * Authenticates users for private and presence channels
 */
router.post("/auth", Authenticated, async (req, res) => {
  try {
    const { socket_id, channel_name } = req.body;

    console.log("Pusher auth request: ", req.user);
    const userId = req.user._id;

    console.log(
      `Pusher auth request: User ${userId}, Channel: ${channel_name}, Socket: ${socket_id}`
    );

    // Check if user is authenticated
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Handle different channel types
    if (channel_name.startsWith("private-user_")) {
      // Personal channel - only allow access to own channel
      const channelUserId = channel_name.replace("private-user_", "");

      if (channelUserId !== userId) {
        return res.status(403).json({ error: "Access denied to this channel" });
      }

      // Authenticate for personal channel
      const authData = global.pusher.authenticate(socket_id, channel_name);

      // Track connection
      await handleUserConnection(userId, socket_id);

      return res.json(authData);
    } else if (channel_name.startsWith("private-chat_")) {
      // Chat channel - verify user has access to this chat
      const chatSessionId = channel_name.replace("private-chat_", "");

      // TODO: Add chat session access verification here
      // For now, authenticate all chat channels
      const authData = global.pusher.authenticate(socket_id, channel_name);

      return res.json(authData);
    } else if (channel_name.startsWith("presence-")) {
      // Presence channel - authenticate with user info
      // Ensure user_id is a string as required by Pusher
      const firstName = req.user.firstName || "";
      const lastName = req.user.lastName || "";
      const fullName =
        `${firstName} ${lastName}`.trim() || req.user.username || "User";

      const presenceData = {
        user_id: userId.toString(),
        user_info: {
          id: userId.toString(),
          name: fullName,
          username: req.user.username || "unknown",
        },
      };

      console.log("Pusher presence auth data:", presenceData);
      const authData = global.pusher.authenticate(
        socket_id,
        channel_name,
        presenceData
      );
      console.log("Pusher presence auth response:", authData);

      // Ensure channel_data is valid JSON string
      if (authData.channel_data) {
        try {
          // Parse and re-stringify to ensure valid JSON
          const parsed = JSON.parse(authData.channel_data);
          authData.channel_data = JSON.stringify(parsed);
          console.log("Validated channel_data:", authData.channel_data);
        } catch (e) {
          console.error("Error validating channel_data JSON:", e);
        }
      }

      return res.json(authData);
    } else {
      return res.status(403).json({ error: "Unknown channel type" });
    }
  } catch (error) {
    console.error("Pusher auth error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
});

/**
 * Pusher webhook endpoint
 * Handles connection/disconnection events and other Pusher webhooks
 */
router.post("/webhook", async (req, res) => {
  try {
    const { events } = req.body;

    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    for (const event of events) {
      console.log(`Pusher webhook event: ${event.name}`, event);

      switch (event.name) {
        case "channel_occupied":
          console.log(`Channel occupied: ${event.channel}`);
          break;

        case "channel_vacated":
          console.log(`Channel vacated: ${event.channel}`);
          break;

        case "member_added":
          // Handle user connecting to presence channel
          if (event.channel.startsWith("presence-")) {
            const userData = event.user_info;
            if (userData && userData.id) {
              await handleUserConnection(userData.id, event.socket_id);
            }
          }
          break;

        case "member_removed":
          // Handle user disconnecting from presence channel
          if (event.channel.startsWith("presence-")) {
            const userData = event.user_info;
            if (userData && userData.id) {
              await handleUserDisconnection(userData.id, event.socket_id);
            }
          }
          break;

        default:
          console.log(`Unhandled webhook event: ${event.name}`);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Pusher webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

/**
 * Client-triggered events endpoint
 * Handles events sent from clients (equivalent to socket.io events)
 */
router.post("/events", Authenticated, async (req, res) => {
  try {
    const { event, data } = req.body;
    const userId = req.user._id;

    console.log(`Client event: ${event} from user ${userId}`, data);

    switch (event) {
      case "join_chat":
        const chatSessionId = data.chatSessionId || data;
        await joinChatSession(userId, chatSessionId);
        res.json({ success: true, message: "Joined chat session" });
        break;

      case "leave_chat":
        const leaveChatSessionId = data.chatSessionId || data;
        await leaveChatSession(userId, leaveChatSessionId);
        res.json({ success: true, message: "Left chat session" });
        break;

      case "typing":
        if (data.chatSessionId) {
          const userInfo = {
            firstName: req.user.firstName,
            lastName: req.user.lastName,
            username: req.user.username,
          };
          await sendTypingIndicator(data.chatSessionId, userId, true, userInfo);
          res.json({ success: true, message: "Typing indicator sent" });
        } else {
          res.status(400).json({ error: "Chat session ID required" });
        }
        break;

      case "stop_typing":
        if (data.chatSessionId) {
          const userInfo = {
            firstName: req.user.firstName,
            lastName: req.user.lastName,
            username: req.user.username,
          };
          await sendTypingIndicator(data.chatSessionId, userId, false, userInfo);
          res.json({ success: true, message: "Stop typing indicator sent" });
        } else {
          res.status(400).json({ error: "Chat session ID required" });
        }
        break;

      case "mark_message_read":
        if (data.messageId && data.chatSessionId) {
          await sendMessageReadStatus(
            data.chatSessionId,
            data.messageId,
            userId
          );
          res.json({ success: true, message: "Message read status sent" });
        } else {
          res
            .status(400)
            .json({ error: "Message ID and chat session ID required" });
        }
        break;

      case "update_user_status":
        if (data.status) {
          await sendUserStatusUpdate(userId, data.status);
          res.json({ success: true, message: "User status updated" });
        } else {
          res.status(400).json({ error: "Status required" });
        }
        break;

      case "message_reaction":
        if (data.messageId && data.chatSessionId && data.reaction) {
          await sendMessageReactionsUpdate(data.chatSessionId, {
            messageId: data.messageId,
            userId: userId,
            reaction: data.reaction,
            action: data.action || "add", // 'add' or 'remove'
            timestamp: new Date().toISOString(),
          });
          res.json({ success: true, message: "Message reaction sent" });
        } else {
          res
            .status(400)
            .json({
              error: "Message ID, chat session ID, and reaction required",
            });
        }
        break;

      default:
        console.log(`Unhandled client event: ${event}`);
        res.status(400).json({ error: `Unknown event: ${event}` });
    }
  } catch (error) {
    console.error("Client event error:", error);
    res.status(500).json({ error: "Event processing failed" });
  }
});

/**
 * Ping endpoint for connection health check
 */
router.post("/ping", Authenticated, async (req, res) => {
  try {
    const userId = req.user._id;

    // Send pong back to user's personal channel
    await global.pusher.trigger(`private-user_${userId}`, "pong", {
      userId: userId,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Pong sent",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Ping error:", error);
    res.status(500).json({ error: "Ping failed" });
  }
});

/**
 * Test presence channel endpoint
 */
router.post("/test-presence", Authenticated, async (req, res) => {
  try {
    const userId = req.user._id;

    // Send test event to presence channel
    await global.pusher.trigger("presence-user-status", "test_presence_event", {
      userId: userId,
      message: "This is a test presence event",
      timestamp: new Date().toISOString(),
    });

    console.log(`Test presence event sent for user ${userId}`);

    res.json({
      success: true,
      message: "Test presence event sent",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Test presence error:", error);
    res.status(500).json({ error: "Test presence failed" });
  }
});

module.exports = router;
