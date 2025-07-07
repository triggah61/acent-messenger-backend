/**
 * @fileoverview Call Controller
 *
 * This module provides controller functions for handling call operations
 * including call initiation, acceptance, decline, and token generation.
 *
 * @module controller/user/CallController
 * @requires ../../exception/AppError
 * @requires ../../exception/catchAsync
 * @requires ../../services/CallService
 * @requires ../../validator/simpleValidator
 */

const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");
const CallService = require("../../services/CallService");
const SimpleValidator = require("../../validator/simpleValidator");

/**
 * Initiate a new call
 */
exports.initiateCall = catchAsync(async (req, res) => {
  const { user } = req;
  const { participantIds, type, chatSessionId } = req.body;
  console.log(req.body);

  SimpleValidator(req.body, {
    participantIds: "required|array",
    type: "required|string",
  });

  if (!['voice', 'video'].includes(type)) {
    throw new AppError("Invalid call type. Must be 'voice' or 'video'", 400);
  }

  if (!participantIds || participantIds.length === 0) {
    throw new AppError("At least one participant is required", 400);
  }

  // Remove initiator from participants if included
  const cleanParticipantIds = participantIds.filter(id => id !== user._id.toString());

  if (cleanParticipantIds.length === 0) {
    throw new AppError("Cannot call yourself", 400);
  }

  const result = await CallService.initiateCall({
    initiatorId: user._id,
    participantIds: cleanParticipantIds,
    type,
    chatSessionId,
    metadata: {
      clientPlatform: req.headers['user-agent'] || 'unknown',
      appVersion: req.headers['app-version'] || 'unknown',
    }
  });

  if (!result.success) {
    throw new AppError(result.error, 400);
  }

  console.log(result.call, result.channelName);

  return res.status(200).json({
    message: "Call initiated successfully",
    data: result.call,
    channelName: result.channelName,
  });
});

/**
 * Accept an incoming call
 */
exports.acceptCall = catchAsync(async (req, res) => {
  const { user } = req;
  const { callId } = req.params;

  SimpleValidator(req.params, {
    callId: "required|mongoid",
  });

  const result = await CallService.acceptCall(callId, user._id.toString());

  if (!result.success) {
    throw new AppError(result.error, 400);
  }

  return res.status(200).json({
    message: "Call accepted successfully",
    data: result.call,
  });
});

/**
 * Decline an incoming call
 */
exports.declineCall = catchAsync(async (req, res) => {
  const { user } = req;
  const { callId } = req.params;

  SimpleValidator(req.params, {
    callId: "required|mongoid",
  });

  const result = await CallService.declineCall(callId, user._id.toString());

  if (!result.success) {
    throw new AppError(result.error, 400);
  }

  return res.status(200).json({
    message: "Call declined successfully",
    data: result.call,
  });
});

/**
 * End an active call
 */
exports.endCall = catchAsync(async (req, res) => {
  const { user } = req;
  const { callId } = req.params;
  const { reason = 'normal' } = req.body;

  SimpleValidator(req.params, {
    callId: "required|mongoid",
  });

  const result = await CallService.endCall(callId, user._id.toString(), reason);

  if (!result.success) {
    throw new AppError(result.error, 400);
  }

  return res.status(200).json({
    message: "Call ended successfully",
    data: result.call,
  });
});

/**
 * Generate Agora token for call
 */
exports.generateToken = catchAsync(async (req, res) => {
  const { user } = req;
  const { callId } = req.params;

  SimpleValidator(req.params, {
    callId: "required|mongoid",
  });

  const result = await CallService.generateCallToken(callId, user._id.toString());

  if (!result.success) {
    throw new AppError(result.error, 400);
  }

  return res.status(200).json({
    message: "Token generated successfully",
    data: result,
  });
});

/**
 * Get call history for user
 */
exports.getCallHistory = catchAsync(async (req, res) => {
  const { user } = req;
  const { page = 1, limit = 20, type, status, startDate, endDate } = req.query;

  const result = await CallService.getCallHistory(user._id.toString(), {
    page: parseInt(page),
    limit: parseInt(limit),
    type,
    status,
    startDate,
    endDate,
  });

  if (!result.success) {
    throw new AppError(result.error, 500);
  }

  return res.status(200).json({
    message: "Call history retrieved successfully",
    data: result.data,
  });
});

/**
 * Get a specific call by ID (for incoming call notifications)
 */
exports.getCallById = catchAsync(async (req, res) => {
  const { user } = req;
  const { callId } = req.params;

  SimpleValidator(req.params, {
    callId: "required|mongoid",
  });

  const Call = require("../../model/Call");
  const call = await Call.findById(callId)
    .populate('initiator', 'firstName lastName photo dialCode phone')
    .populate('participants.user', 'firstName lastName photo dialCode phone');

  if (!call) {
    throw new AppError("Call not found", 404);
  }

  // Check if user is a participant or initiator
  const isParticipant = call.participants.some(p => p.user._id.toString() === user._id.toString());
  const isInitiator = call.initiator._id.toString() === user._id.toString();

  if (!isParticipant && !isInitiator) {
    throw new AppError("You are not authorized to view this call", 403);
  }

  return res.status(200).json({
    message: "Call retrieved successfully",
    data: call,
  });
});

/**
 * Get active calls for user
 */
exports.getActiveCalls = catchAsync(async (req, res) => {
  const { user } = req;

  const Call = require("../../model/Call");
  const activeCalls = await Call.findActiveCallsForUser(user._id);

  return res.status(200).json({
    message: "Active calls retrieved successfully",
    data: activeCalls,
  });
});

/**
 * Update call quality rating
 */
exports.updateCallQuality = catchAsync(async (req, res) => {
  const { user } = req;
  const { callId } = req.params;
  const { rating, networkQuality, issues = [] } = req.body;

  SimpleValidator(req.params, {
    callId: "required|mongoid",
  });

  SimpleValidator(req.body, {
    rating: "required|numeric|min:1|max:5",
  });

  const Call = require("../../model/Call");
  const call = await Call.findById(callId);

  if (!call) {
    throw new AppError("Call not found", 404);
  }

  // Check if user was a participant
  const participant = call.participants.find(p => p.user.toString() === user._id.toString());
  const isInitiator = call.initiator.toString() === user._id.toString();

  if (!participant && !isInitiator) {
    throw new AppError("You are not authorized to rate this call", 403);
  }

  // Update call quality
  call.quality = {
    averageRating: rating,
    networkQuality: networkQuality || call.quality?.networkQuality,
    issues: issues.length > 0 ? issues : call.quality?.issues || [],
  };

  await call.save();

  return res.status(200).json({
    message: "Call quality updated successfully",
    data: call,
  });
}); 