/**
 * @fileoverview Call Service
 *
 * This service handles all call-related operations including call initiation,
 * management, and cleanup. It integrates with Agora for token generation
 * and Pusher for real-time signaling.
 *
 * @module services/CallService
 * @requires ../model/Call
 * @requires ../model/User
 * @requires ../config/agora
 * @requires ../config/pusher
 * @requires ./FCMService
 * @requires uuid
 */

const Call = require("../model/Call");
const User = require("../model/User");
const { generateRtcToken } = require("../config/agora");
const FCMService = require("./FCMService");
const { v4: uuidv4 } = require("uuid");
const mongoose = require("mongoose");

class CallService {
  /**
   * Initiate a new call
   * @param {Object} params - Call parameters
   * @param {string} params.initiatorId - ID of user initiating the call
   * @param {Array} params.participantIds - Array of participant user IDs
   * @param {string} params.type - Call type ('voice' or 'video')
   * @param {string} params.chatSessionId - Associated chat session ID (optional)
   * @param {Object} params.metadata - Additional call metadata
   * @returns {Promise<Object>} Call initiation result
   */
  async initiateCall({
    initiatorId,
    participantIds,
    type,
    chatSessionId = null,
    metadata = {},
  }) {
    try {
      console.log(
        `CallService: Initiating ${type} call from ${initiatorId} to ${participantIds.join(
          ", "
        )}`
      );

      // Validate input parameters
      if (
        !initiatorId ||
        !participantIds ||
        !Array.isArray(participantIds) ||
        participantIds.length === 0
      ) {
        throw new Error(
          "Invalid call parameters: initiatorId and participantIds are required"
        );
      }

      if (!["voice", "video"].includes(type)) {
        throw new Error('Invalid call type: must be "voice" or "video"');
      }

      // Check if initiator exists
      const initiator = await User.findById(initiatorId);
      if (!initiator) {
        throw new Error("Initiator not found");
      }

      // Check if all participants exist
      const participants = await User.find({
        _id: { $in: participantIds },
      });

      if (participants.length !== participantIds.length) {
        throw new Error("Some participants not found");
      }

      // Check if any participant is already in an active call
      const activeCallsForParticipants = await Call.find({
        $or: [
          { initiator: { $in: participantIds } },
          { "participants.user": { $in: participantIds } },
        ],
        status: { $in: ["initiated", "ringing", "active"] },
      });

      if (activeCallsForParticipants.length > 0) {
        return {
          success: false,
          error: "One or more participants are already in an active call",
          busyParticipants: activeCallsForParticipants.map((call) =>
            call.participants.map((p) => p.user)
          ),
        };
      }

      // Generate a new ObjectId for the call - this will also be our channel name
      const callId = new mongoose.Types.ObjectId();
      const channelName = callId.toString(); // Use Call ID as channel name - simple and unique!

      // Create call record
      const callData = {
        _id: callId, // Set the ID explicitly
        channelName,
        type,
        mode: participantIds.length === 1 ? "individual" : "group",
        initiator: initiatorId,
        participants: [
          {
            user: initiatorId,
            role: "caller",
            status: "accepted", // Initiator is automatically accepted
            joinedAt: new Date(),
          },
          ...participantIds.map((participantId) => ({
            user: participantId,
            role: "callee",
            status: "invited",
          })),
        ],
        status: "initiated",
        chatSession: chatSessionId,
        metadata: {
          ...metadata,
          initiatedAt: new Date(),
        },
      };

      const call = new Call(callData);
      await call.save();

      // Populate the call with user details
      await call.populate(
        "initiator",
        "firstName lastName photo dialCode phone"
      );
      await call.populate(
        "participants.user",
        "firstName lastName photo dialCode phone"
      );

      console.log(
        `CallService: Call created with ID ${call._id} and channel ${channelName}`
      );

      // Send real-time notifications to participants
      await this.sendCallInvitation(call);

      // Send FCM notifications to participants
      await this.sendCallNotifications(call);

      return {
        success: true,
        call,
        channelName,
        message: "Call initiated successfully",
      };
    } catch (error) {
      console.error("CallService: Error initiating call:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Accept an incoming call
   * @param {string} callId - Call ID
   * @param {string} userId - User ID accepting the call
   * @returns {Promise<Object>} Call acceptance result
   */
  async acceptCall(callId, userId) {
    try {
      console.log(`CallService: User ${userId} accepting call ${callId}`);

      const call = await Call.findById(callId)
        .populate("initiator", "firstName lastName photo dialCode phone")
        .populate(
          "participants.user",
          "firstName lastName photo dialCode phone"
        );

      if (!call) {
        throw new Error("Call not found");
      }

      // Allow accepting calls that are initiated, ringing, or active
      // (active status can occur when initiator auto-accepts in individual calls)
      if (
        !["initiated", "ringing", "active", "accepted"].includes(call.status)
      ) {
        throw new Error(
          `Call cannot be accepted in current state: ${call.status}`
        );
      }

      // Find the participant
      const participant = call.participants.find(
        (p) => p.user._id.toString() === userId
      );
      if (!participant) {
        throw new Error("User is not a participant in this call");
      }

      // Allow accepting if not already accepted or declined
      if (["accepted", "declined", "ended"].includes(participant.status)) {
        // If already accepted, just return success (idempotent operation)
        if (participant.status === "accepted") {
          return {
            success: true,
            call,
            message: "Call already accepted",
          };
        }
        throw new Error(
          `Call already responded to with status: ${participant.status}`
        );
      }

      // Update participant status
      participant.status = "accepted";
      participant.joinedAt = new Date();

      // Update call status based on participant responses
      const acceptedParticipants = call.participants.filter(
        (p) => p.status === "accepted"
      );
      const totalParticipants = call.participants.length;

      if (call.status === "initiated" && acceptedParticipants.length >= 1) {
        call.status = "ringing";
      }

      // Start the call when at least 2 participants are accepted (including initiator)
      // or when all non-initiator participants have accepted
      const nonInitiatorParticipants = call.participants.filter(
        (p) => p.role === "callee"
      );
      const acceptedNonInitiators = nonInitiatorParticipants.filter(
        (p) => p.status === "accepted"
      );

      if (
        acceptedParticipants.length >= 2 ||
        acceptedNonInitiators.length === nonInitiatorParticipants.length
      ) {
        call.status = "active";
        if (!call.startedAt) {
          call.startedAt = new Date();
        }
      }

      await call.save();

      console.log(`CallService: Call ${callId} accepted by user ${userId}`);

      // Send real-time updates
      await this.sendCallUpdate(call, "call_accepted", {
        acceptedBy: userId,
        acceptedAt: new Date(),
      });

      return {
        success: true,
        call,
        message: "Call accepted successfully",
      };
    } catch (error) {
      console.error("CallService: Error accepting call:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Decline an incoming call
   * @param {string} callId - Call ID
   * @param {string} userId - User ID declining the call
   * @returns {Promise<Object>} Call decline result
   */
  async declineCall(callId, userId) {
    try {
      console.log(`CallService: User ${userId} declining call ${callId}`);

      const call = await Call.findById(callId)
        .populate("initiator", "firstName lastName photo dialCode phone")
        .populate(
          "participants.user",
          "firstName lastName photo dialCode phone"
        );

      if (!call) {
        throw new Error("Call not found");
      }

      if (call.status !== "initiated" && call.status !== "ringing") {
        throw new Error("Call cannot be declined in current state");
      }

      // Find the participant
      const participant = call.participants.find(
        (p) => p.user._id.toString() === userId
      );
      if (!participant) {
        throw new Error("User is not a participant in this call");
      }

      if (
        participant.status !== "invited" &&
        participant.status !== "ringing"
      ) {
        throw new Error("Call already responded to");
      }

      // Update participant status
      participant.status = "declined";
      participant.leftAt = new Date();

      // Check if all participants have declined
      const allDeclined = call.participants
        .filter((p) => p.role === "callee")
        .every((p) => p.status === "declined");

      if (allDeclined) {
        call.status = "declined";
        call.endedAt = new Date();
        call.endReason = "declined";
      }

      await call.save();

      console.log(`CallService: Call ${callId} declined by user ${userId}`);

      // Send real-time updates
      await this.sendCallUpdate(call, "call_declined", {
        declinedBy: userId,
        declinedAt: new Date(),
      });

      return {
        success: true,
        call,
        message: "Call declined successfully",
      };
    } catch (error) {
      console.error("CallService: Error declining call:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * End an active call
   * @param {string} callId - Call ID
   * @param {string} userId - User ID ending the call
   * @param {string} reason - Reason for ending the call
   * @returns {Promise<Object>} Call end result
   */
  async endCall(callId, userId, reason = "normal") {
    try {
      console.log(
        `CallService: User ${userId} ending call ${callId} with reason: ${reason}`
      );

      const call = await Call.findById(callId)
        .populate("initiator", "firstName lastName photo dialCode phone")
        .populate(
          "participants.user",
          "firstName lastName photo dialCode phone"
        );

      if (!call) {
        throw new Error("Call not found");
      }

      if (call.status === "ended") {
        return {
          success: true,
          call,
          message: "Call already ended",
        };
      }

      // Find the participant
      const participant = call.participants.find(
        (p) => p.user._id.toString() === userId
      );
      if (!participant) {
        throw new Error("User is not a participant in this call");
      }

      // End the call
      call.endCall(reason);
      await call.save();

      console.log(`CallService: Call ${callId} ended by user ${userId}`);

      // Send real-time updates
      await this.sendCallUpdate(call, "call_ended", {
        endedBy: userId,
        endedAt: call.endedAt,
        reason: reason,
        duration: call.duration,
      });

      return {
        success: true,
        call,
        message: "Call ended successfully",
      };
    } catch (error) {
      console.error("CallService: Error ending call:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate Agora token for a call participant
   * @param {string} callId - Call ID
   * @param {string} userId - User ID requesting token
   * @returns {Promise<Object>} Token generation result
   */
  async generateCallToken(callId, userId) {
    try {
      console.log(
        `CallService: Generating token for user ${userId} in call ${callId}`
      );

      const call = await Call.findById(callId);
      if (!call) {
        throw new Error("Call not found");
      }

      // Check if user is a participant
      const participant = call.participants.find(
        (p) => p.user.toString() === userId
      );
      if (!participant) {
        throw new Error("User is not a participant in this call");
      }

      // Generate token
      const tokenResult = generateRtcToken(
        call.channelName,
        userId,
        "publisher" // All participants can publish (speak/video)
      );

      if (!tokenResult.success) {
        throw new Error(`Token generation failed: ${tokenResult.error}`);
      }

      console.log(
        `CallService: Token generated successfully for user ${userId} in call ${callId}`
      );

      return {
        success: true,
        token: tokenResult.token,
        channelName: call.channelName,
        appId: tokenResult.appId,
        userId: userId,
        integerUid: tokenResult.integerUid, // Include the UID that was used to generate the token
        expiresAt: tokenResult.expiresAt,
        call: {
          id: call._id,
          type: call.type,
          status: call.status,
          participantCount: call.participants.length,
        },
      };
    } catch (error) {
      console.error("CallService: Error generating token:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get call history for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Call history result
   */
  async getCallHistory(userId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        type = null,
        status = null,
        startDate = null,
        endDate = null,
      } = options;

      // Build query
      const query = {
        $or: [{ initiator: userId }, { "participants.user": userId }],
      };

      if (type) query.type = type;
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const aggregate = Call.aggregate([
        { $match: query },
        {
          $lookup: {
            from: "users",
            localField: "initiator",
            foreignField: "_id",
            as: "initiator",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "participants.user",
            foreignField: "_id",
            as: "participantUsers",
          },
        },
        {
          $addFields: {
            initiator: { $arrayElemAt: ["$initiator", 0] },
            participants: {
              $map: {
                input: "$participants",
                as: "participant",
                in: {
                  $mergeObjects: [
                    "$$participant",
                    {
                      user: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: "$participantUsers",
                              as: "pu",
                              cond: { $eq: ["$$pu._id", "$$participant.user"] },
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
        {
          $project: {
            participantUsers: 0,
            "initiator.password": 0,
            "participants.user.password": 0,
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

      const result = await Call.aggregatePaginate(aggregate, {
        page: parseInt(page),
        limit: parseInt(limit),
      });

      console.log(
        `CallService: Retrieved ${result.docs.length} call history records for user ${userId}`
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error("CallService: Error getting call history:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send call invitation via real-time events
   * @param {Object} call - Call object
   * @private
   */
  async sendCallInvitation(call) {
    try {
      // Send to each participant's personal channel
      for (const participant of call.participants) {
        if (participant.role === "callee") {
          const eventData = {
            type: "incoming_call",
            callId: call._id,
            channelName: call.channelName,
            callType: call.type,
            mode: call.mode,
            caller: {
              id: call.initiator._id,
              name: `${call.initiator.firstName} ${call.initiator.lastName}`,
              photo: call.initiator.photo,
              phone: call.initiator.phone,
            },
            participants: call.participants.map((p) => ({
              id: p.user._id,
              name: `${p.user.firstName} ${p.user.lastName}`,
              photo: p.user.photo,
              role: p.role,
              status: p.status,
            })),
            timestamp: new Date().toISOString(),
          };

          // Send via Pusher
          if (global.pusher) {
            await global.pusher.trigger(
              `private-user_${participant.user._id}`,
              "incoming_call",
              eventData
            );
          }
        }
      }

      console.log(
        `CallService: Call invitation sent to ${
          call.participants.length - 1
        } participants`
      );
    } catch (error) {
      console.error("CallService: Error sending call invitation:", error);
    }
  }

  /**
   * Send call update via real-time events
   * @param {Object} call - Call object
   * @param {string} event - Event type
   * @param {Object} data - Additional event data
   * @private
   */
  async sendCallUpdate(call, event, data = {}) {
    try {
      const eventData = {
        type: event,
        callId: call._id,
        channelName: call.channelName,
        callType: call.type,
        status: call.status,
        ...data,
        timestamp: new Date().toISOString(),
      };

      // Send to all participants
      for (const participant of call.participants) {
        if (global.pusher) {
          await global.pusher.trigger(
            `private-user_${participant.user._id}`,
            event,
            eventData
          );
        }
      }

      console.log(
        `CallService: Call update "${event}" sent to ${call.participants.length} participants`
      );
    } catch (error) {
      console.error("CallService: Error sending call update:", error);
    }
  }

  /**
   * Send FCM notifications for call invitation
   * @param {Object} call - Call object
   * @private
   */
  async sendCallNotifications(call) {
    try {
      // Send to each participant (except initiator)
      for (const participant of call.participants) {
        if (participant.role === "callee") {
          const callData = {
            id: call._id,
            type: call.type,
            channelName: call.channelName,
          };

          const callerData = {
            _id: call.initiator._id,
            firstName: call.initiator.firstName,
            lastName: call.initiator.lastName,
            photo: call.initiator.photo,
          };

          // Send FCM notification
          FCMService.sendIncomingCallNotification(
            participant.user._id.toString(),
            callData,
            callerData
          ).catch((error) => {
            console.error(
              `CallService: Error sending FCM notification to ${participant.user._id}:`,
              error
            );
          });
        }
      }

      console.log(`CallService: FCM notifications sent for call ${call._id}`);
    } catch (error) {
      console.error("CallService: Error sending FCM notifications:", error);
    }
  }

  /**
   * Clean up expired calls
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupExpiredCalls() {
    try {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Find calls that are still in initiated/ringing state but created more than 30 minutes ago
      const expiredCalls = await Call.find({
        status: { $in: ["initiated", "ringing"] },
        createdAt: { $lt: thirtyMinutesAgo },
      });

      let cleanedCount = 0;

      for (const call of expiredCalls) {
        call.endCall("timeout");
        await call.save();

        // Send notification that call ended due to timeout
        await this.sendCallUpdate(call, "call_ended", {
          reason: "timeout",
          endedAt: call.endedAt,
        });

        cleanedCount++;
      }

      console.log(`CallService: Cleaned up ${cleanedCount} expired calls`);

      return {
        success: true,
        cleanedCount,
      };
    } catch (error) {
      console.error("CallService: Error cleaning up expired calls:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new CallService();
