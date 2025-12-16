/**
 * @fileoverview TranslationSession controller
 *
 * Handles all translation session operations including:
 * - Starting new translation sessions
 * - Stopping sessions and calculating costs
 * - Adding translation history records
 * - Fetching session history
 */

const catchAsync = require("../exception/catchAsync");
const AppError = require("../exception/AppError");
const TranslationSession = require("../model/TranslationSession");
const TranslationHistory = require("../model/TranslationHistory");
const User = require("../model/User");
const Setting = require("../model/Setting");
const BalanceService = require("../services/BalanceService");
const SimpleValidator = require("../validator/simpleValidator");

/**
 * Start a new translation session
 * POST /api/translation-session/start
 */
exports.startSession = catchAsync(async (req, res) => {
  const userId = req.user._id;

  console.log('═══════════════════════════════════════════════════');
  console.log('TranslationSessionController: 🚀 START SESSION REQUEST');
  console.log('═══════════════════════════════════════════════════');
  console.log('User ID:', userId);
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  const {
    speaker1Language,
    speaker2Language,
    speaker1Earpiece = "left",
    speaker2Earpiece = "right",
    speaker1Gender = "male",
    speaker2Gender = "female",
    mode = "realtime",
    twsConnected = false,
    twsDeviceName = null,
    metadata = {},
  } = req.body;

  // Validation
  SimpleValidator(req.body, {
    speaker1Language: "required|string",
    speaker2Language: "required|string",
  });
  console.log('TranslationSessionController: ✅ Validation passed');

  // Get user's current balance
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  const currentBalance =
    Number(user.topUpCreditBalance || 0) +
    Number(user.monthlySubscriptionCreditBalance || 0);

  // Get current fee configuration
  let feeConfig = {
    inputCreditPerSec: 0.5,
    outputCreditPerChar: 0.01,
  };

  try {
    const feeSetting = await Setting.findOne({ name: "FEE_CONFIGURATION" });
    if (feeSetting && feeSetting.value) {
      const parsedConfig =
        typeof feeSetting.value === "string"
          ? JSON.parse(feeSetting.value)
          : feeSetting.value;
      feeConfig = {
        inputCreditPerSec:
          Number(parsedConfig.inputCreditPerSec) || feeConfig.inputCreditPerSec,
        outputCreditPerChar:
          Number(parsedConfig.outputCreditPerChar) ||
          feeConfig.outputCreditPerChar,
      };
    }
  } catch (e) {
    console.error("Error fetching fee configuration:", e);
    // Use defaults if error
  }

  // Create new translation session
  console.log('TranslationSessionController: Creating session with config:', {
    speaker1Language,
    speaker2Language,
    mode,
    twsConnected,
    currentBalance,
    feeConfig,
  });

  const session = await TranslationSession.create({
    user: userId,
    status: "active",
    sessionStartTime: new Date(),
    speaker1Language,
    speaker2Language,
    speaker1Earpiece,
    speaker2Earpiece,
    speaker1Gender,
    speaker2Gender,
    mode,
    twsConnected,
    twsDeviceName,
    balanceBeforeSession: currentBalance,
    appliedFeeRates: feeConfig,
    metadata: {
      clientPlatform: metadata.clientPlatform || null,
      appVersion: metadata.appVersion || null,
      deviceModel: metadata.deviceModel || null,
    },
  });

  console.log('TranslationSessionController: ✅✅✅ SESSION CREATED');
  console.log('Session ID:', session._id);
  console.log('Status:', session.status);
  console.log('═══════════════════════════════════════════════════');

  res.status(201).json({
    message: "Translation session started successfully",
    data: {
      sessionId: session._id,
      status: session.status,
      sessionStartTime: session.sessionStartTime,
      speaker1Language: session.speaker1Language,
      speaker2Language: session.speaker2Language,
      appliedFeeRates: session.appliedFeeRates,
      balanceBeforeSession: session.balanceBeforeSession,
    },
  });
});

/**
 * Stop translation session and calculate final cost
 * POST /api/translation-session/stop/:sessionId
 */
exports.stopSession = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { sessionId } = req.params;

  console.log('═══════════════════════════════════════════════════');
  console.log('TranslationSessionController: 🛑 STOP SESSION REQUEST');
  console.log('═══════════════════════════════════════════════════');
  console.log('Session ID:', sessionId);
  console.log('User ID:', userId);
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  const {
    totalAudioDurationSec = 0,
    totalInputTokens = 0,
    totalTranscriptionCharacters = 0,
    totalTranslationCharacters = 0,
    totalOutputTokens = 0,
    speaker1TranscriptionCharacters = 0,
    speaker1TranslationCharacters = 0,
    speaker2TranscriptionCharacters = 0,
    speaker2TranslationCharacters = 0,
    totalTranslations = 0,
    averageLatencyMs = 0,
    errorMessage = null,
  } = req.body;

  // Find session
  const session = await TranslationSession.findById(sessionId);
  if (!session) {
    throw new AppError("Translation session not found", 404);
  }

  // Verify ownership
  if (session.user.toString() !== userId.toString()) {
    throw new AppError("Unauthorized access to this session", 403);
  }

  // Check if session is already ended
  if (session.status === "ended") {
    throw new AppError("Session is already ended", 400);
  }

  // Calculate session end time and duration
  const sessionEndTime = new Date();
  const totalDuration = Math.round(
    (sessionEndTime - session.sessionStartTime) / 1000
  ); // in seconds

  // Calculate costs based on applied fee rates
  const inputCost =
    Number(totalAudioDurationSec || 0) *
    Number(session.appliedFeeRates.inputCreditPerSec || 0);
  const outputCost =
    (Number(totalTranscriptionCharacters || 0) +
      Number(totalTranslationCharacters || 0)) *
    Number(session.appliedFeeRates.outputCreditPerChar || 0);
  const totalCost = inputCost + outputCost;

  // Update session with final metrics
  session.status = errorMessage ? "error" : "ended";
  session.sessionEndTime = sessionEndTime;
  session.totalDuration = totalDuration;
  session.totalAudioDurationSec = Number(totalAudioDurationSec || 0);
  session.totalInputTokens = Number(totalInputTokens || 0);
  session.totalTranscriptionCharacters = Number(
    totalTranscriptionCharacters || 0
  );
  session.totalTranslationCharacters = Number(totalTranslationCharacters || 0);
  session.totalOutputTokens = Number(totalOutputTokens || 0);
  session.speaker1TranscriptionCharacters = Number(
    speaker1TranscriptionCharacters || 0
  );
  session.speaker1TranslationCharacters = Number(
    speaker1TranslationCharacters || 0
  );
  session.speaker2TranscriptionCharacters = Number(
    speaker2TranscriptionCharacters || 0
  );
  session.speaker2TranslationCharacters = Number(
    speaker2TranslationCharacters || 0
  );
  session.totalTranslations = Number(totalTranslations || 0);
  session.inputCost = inputCost;
  session.outputCost = outputCost;
  session.totalCost = totalCost;
  session.averageLatencyMs = Number(averageLatencyMs || 0);
  session.errorMessage = errorMessage;

  // Deduct credits from user balance if cost > 0
  if (totalCost > 0) {
    try {
      // Get current balance before deduction
      const currentUser = await User.findById(userId);
      let topUpBalance = Number(currentUser.topUpCreditBalance || 0);
      let subscriptionBalance = Number(currentUser.monthlySubscriptionCreditBalance || 0);
      const initialSubscriptionBalance = subscriptionBalance; // Store initial value for comparison
      const currentBalance = topUpBalance + subscriptionBalance;
      
      console.log('TranslationSessionController: 💰 Credit Deduction Info:');
      console.log(`  Balance before deduction: ${currentBalance} (TopUp: ${topUpBalance}, Subscription: ${subscriptionBalance})`);
      console.log(`  Total cost to deduct: ${totalCost}`);
      
      // Calculate how much we can actually deduct
      const amountToDeduct = Math.min(totalCost, Math.max(0, currentBalance));
      
      if (amountToDeduct > 0) {
        // Manually deduct credits from balance (similar to deductCredit but allows partial deduction)
        let remainingToDeduct = amountToDeduct;
        
        // Deduct from subscription balance first
        if (subscriptionBalance > 0 && remainingToDeduct > 0) {
          const subscriptionDeductable = Math.min(remainingToDeduct, subscriptionBalance);
          subscriptionBalance -= subscriptionDeductable;
          remainingToDeduct -= subscriptionDeductable;
        }
        
        // Deduct from top-up balance if still needed
        if (topUpBalance > 0 && remainingToDeduct > 0) {
          const topUpDeductable = Math.min(remainingToDeduct, topUpBalance);
          topUpBalance -= topUpDeductable;
          remainingToDeduct -= topUpDeductable;
        }
        
        // Update user balances in database
        await User.findByIdAndUpdate(userId, {
          monthlySubscriptionCreditBalance: subscriptionBalance,
          topUpCreditBalance: topUpBalance,
        });
        
        // Update active subscription's currentCycleBalance if subscription credits were deducted
        if (subscriptionBalance < initialSubscriptionBalance) {
          const SubscriptionHistory = require("../model/SubscriptionHistory");
          const mongoose = require("mongoose");
          const moment = require("moment");
          
          // Find the first active subscription (user should only have one, but pick first if multiple)
          const activeSubscription = await SubscriptionHistory.findOne({
            user: new mongoose.Types.ObjectId(userId),
            status: "active",
            $or: [
              { subscriptionEndDate: { $gte: moment.utc().toDate() } },
              { subscriptionEndDate: null },
            ],
          })
            .sort({ createdAt: -1 }); // Latest first

          if (activeSubscription) {
            // Update currentCycleBalance to match the new subscription balance
            await SubscriptionHistory.findByIdAndUpdate(activeSubscription._id, {
              currentCycleBalance: subscriptionBalance,
            });
          }
        }
        
        // Create transaction record
        const CreditTransaction = require("../model/CreditTransaction");
        const transaction = await CreditTransaction.create({
          user: userId,
        source: "translationSession",
          amount: amountToDeduct,
          type: "debit",
          status: "active",
        remarks: `Translation session - ${totalDuration}s duration, ${totalTranslations} translations. Input: ${totalAudioDurationSec}s, Output: ${
          totalTranscriptionCharacters + totalTranslationCharacters
        } chars`,
      });

      session.creditTransaction = transaction._id;

        console.log(`TranslationSessionController: ✅ Deducted ${amountToDeduct} credits from balance`);
        console.log(`TranslationSessionController: ✅ Transaction created: ${transaction._id}`);
      } else {
        console.warn(`TranslationSessionController: ⚠️ Cannot deduct - insufficient balance. Current: ${currentBalance}, Cost: ${totalCost}`);
        session.remarks = `Credit deduction skipped - insufficient balance. Cost: ${totalCost}, Available: ${currentBalance}`;
      }
      
      // Get updated balance after deduction
      const updatedUser = await User.findById(userId);
      session.balanceAfterSession =
        Number(updatedUser.topUpCreditBalance || 0) +
        Number(updatedUser.monthlySubscriptionCreditBalance || 0);
        
      console.log(`TranslationSessionController: 💰 Balance after deduction: ${session.balanceAfterSession}`);
      
      // Log if full amount couldn't be deducted
      if (amountToDeduct < totalCost && currentBalance > 0) {
        const remainingCost = totalCost - amountToDeduct;
        session.remarks = `Partial credit deduction. Cost: ${totalCost}, Deducted: ${amountToDeduct}, Remaining cost: ${remainingCost}, Final balance: ${session.balanceAfterSession}`;
        console.warn(`TranslationSessionController: ⚠️ Partial deduction - Cost: ${totalCost}, Deducted: ${amountToDeduct}, Remaining: ${remainingCost}, Balance: ${session.balanceAfterSession}`);
      } else if (amountToDeduct < totalCost && currentBalance <= 0) {
        session.remarks = `Credit deduction failed - insufficient balance. Cost: ${totalCost}, Available: ${currentBalance}, Deducted: 0`;
        console.warn(`TranslationSessionController: ⚠️ No deduction - Cost: ${totalCost}, Balance: ${currentBalance}`);
      }
    } catch (error) {
      console.error("TranslationSessionController: ❌ Error deducting credits:", error);
      console.error("TranslationSessionController: Error stack:", error.stack);
      // Don't fail the session stop, but log the error
      session.remarks = `Credit deduction failed: ${error.message}`;
      
      // Still try to get current balance for recording
      try {
        const currentUser = await User.findById(userId);
        session.balanceAfterSession =
          Number(currentUser.topUpCreditBalance || 0) +
          Number(currentUser.monthlySubscriptionCreditBalance || 0);
        console.log(`TranslationSessionController: 💰 Balance recorded after error: ${session.balanceAfterSession}`);
      } catch (balanceError) {
        console.error("TranslationSessionController: ❌ Error getting balance:", balanceError);
        session.balanceAfterSession = session.balanceBeforeSession || 0;
      }
    }
  } else {
    // No cost, just record final balance
    const currentUser = await User.findById(userId);
    session.balanceAfterSession =
      Number(currentUser.topUpCreditBalance || 0) +
      Number(currentUser.monthlySubscriptionCreditBalance || 0);
  }

  await session.save();

  console.log('TranslationSessionController: ✅✅✅ SESSION STOPPED');
  console.log('Total cost:', session.totalCost);
  console.log('Input cost:', session.inputCost);
  console.log('Output cost:', session.outputCost);
  console.log('Balance before:', session.balanceBeforeSession);
  console.log('Balance after:', session.balanceAfterSession);
  console.log('═══════════════════════════════════════════════════');

  res.json({
    message: "Translation session stopped successfully",
    data: {
      sessionId: session._id,
      status: session.status,
      sessionStartTime: session.sessionStartTime,
      sessionEndTime: session.sessionEndTime,
      totalDuration: session.totalDuration,
      totalCost: session.totalCost,
      inputCost: session.inputCost,
      outputCost: session.outputCost,
      totalTranslations: session.totalTranslations,
      balanceBeforeSession: session.balanceBeforeSession,
      balanceAfterSession: session.balanceAfterSession,
      costBreakdown: {
        audioDuration: totalAudioDurationSec,
        inputRate: session.appliedFeeRates.inputCreditPerSec,
        inputCost: inputCost,
        outputCharacters: totalTranscriptionCharacters + totalTranslationCharacters,
        outputRate: session.appliedFeeRates.outputCreditPerChar,
        outputCost: outputCost,
      },
    },
  });
});

/**
 * Add translation to session
 * POST /api/translation-session/:sessionId/add-translation
 */
exports.addTranslation = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { sessionId } = req.params;

  console.log('─────────────────────────────────────────────────');
  console.log('TranslationSessionController: 💾 ADD TRANSLATION REQUEST');
  console.log('Session ID:', sessionId);
  console.log('User ID:', userId);
  console.log('Sequence:', req.body.sequenceNumber);

  const {
    speakerIndex,
    speakerName,
    transcriptionText,
    translationText,
    sourceLanguage,
    targetLanguage,
    latencyMs = 0,
    translationService = "soniox",
    tts = {},
    sequenceNumber = 0,
    isFinal = true,
    confidence = null,
    metadata = {},
  } = req.body;

  // Validation
  SimpleValidator(req.body, {
    speakerIndex: "required|numeric",
    transcriptionText: "required|string",
    sourceLanguage: "required|string",
  });
  console.log('TranslationSessionController: ✅ Validation passed');

  // Find session
  const session = await TranslationSession.findById(sessionId);
  if (!session) {
    throw new AppError("Translation session not found", 404);
  }

  // Verify ownership
  if (session.user.toString() !== userId.toString()) {
    throw new AppError("Unauthorized access to this session", 403);
  }

  // Check if session is active
  if (session.status !== "active" && session.status !== "started") {
    throw new AppError("Session is not active", 400);
  }

  // Calculate character counts
  const transcriptionCharacters = (transcriptionText || "").length;
  const translationCharacters = (translationText || "").length;

  // Create translation history record
  const translation = await TranslationHistory.create({
    translationSession: sessionId,
    user: userId,
    speakerIndex: Number(speakerIndex),
    speakerName: speakerName || `Speaker ${Number(speakerIndex) + 1}`,
    transcriptionText,
    translationText,
    sourceLanguage,
    targetLanguage,
    transcriptionCharacters,
    translationCharacters,
    translationTimestamp: new Date(),
    latencyMs: Number(latencyMs || 0),
    translationService,
    tts: {
      generated: tts.generated || false,
      filePath: tts.filePath || null,
      audioChannel: tts.audioChannel || "mono",
      gender: tts.gender || null,
      played: tts.played || false,
      playedAt: tts.playedAt || null,
    },
    sequenceNumber: Number(sequenceNumber || 0),
    isFinal: isFinal !== false,
    confidence: confidence ? Number(confidence) : null,
    metadata: {
      audioChunkDuration: metadata.audioChunkDuration || 0,
      primaryServiceUsed: metadata.primaryServiceUsed !== false,
      notes: metadata.notes || null,
    },
  });

  // Update session metrics (increment)
  session.totalTranslations = (session.totalTranslations || 0) + 1;

  // Update speaker-specific character counts
  if (Number(speakerIndex) === 0) {
    session.speaker1TranscriptionCharacters =
      (session.speaker1TranscriptionCharacters || 0) + transcriptionCharacters;
    session.speaker1TranslationCharacters =
      (session.speaker1TranslationCharacters || 0) + translationCharacters;
  } else if (Number(speakerIndex) === 1) {
    session.speaker2TranscriptionCharacters =
      (session.speaker2TranscriptionCharacters || 0) + transcriptionCharacters;
    session.speaker2TranslationCharacters =
      (session.speaker2TranslationCharacters || 0) + translationCharacters;
  }

  // Update totals
  session.totalTranscriptionCharacters =
    (session.totalTranscriptionCharacters || 0) + transcriptionCharacters;
  session.totalTranslationCharacters =
    (session.totalTranslationCharacters || 0) + translationCharacters;

  // Mark session as active (in case it was just "started")
  if (session.status === "started") {
    session.status = "active";
  }

  await session.save();

  console.log('TranslationSessionController: ✅ Translation saved:', translation._id);
  console.log('Total translations in session:', session.totalTranslations);
  console.log('─────────────────────────────────────────────────');

  res.status(201).json({
    message: "Translation added successfully",
    data: {
      translationId: translation._id,
      sessionId: session._id,
      totalTranslations: session.totalTranslations,
    },
  });
});

/**
 * Get user's translation sessions
 * GET /api/translation-session/my-sessions
 */
exports.getMySessions = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status } = req.query;

  const matchQuery = {
    user: userId,
  };

  if (status) {
    matchQuery.status = status;
  }

  const aggregateQuery = TranslationSession.aggregate([
    { $match: matchQuery },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userData",
      },
    },
    {
      $unwind: {
        path: "$userData",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        userName: {
          $concat: [
            { $ifNull: ["$userData.firstName", ""] },
            " ",
            { $ifNull: ["$userData.lastName", ""] },
          ],
        },
        userEmail: "$userData.email",
        userPhoto: "$userData.photo",
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 1,
        user: 1,
        status: 1,
        sessionStartTime: 1,
        sessionEndTime: 1,
        totalDuration: 1,
        speaker1Language: 1,
        speaker2Language: 1,
        totalAudioDurationSec: 1,
        totalTranscriptionCharacters: 1,
        totalTranslationCharacters: 1,
        totalTranslations: 1,
        inputCost: 1,
        outputCost: 1,
        totalCost: 1,
        balanceBeforeSession: 1,
        balanceAfterSession: 1,
        twsConnected: 1,
        mode: 1,
        createdAt: 1,
        updatedAt: 1,
        userName: 1,
        userEmail: 1,
        userPhoto: 1,
      },
    },
  ]);

  const options = {
    page: parseInt(page),
    limit: parseInt(limit) === -1 ? 9999999 : parseInt(limit),
  };

  const data = await TranslationSession.aggregatePaginate(
    aggregateQuery,
    options
  );

  res.json({
    message: "Translation sessions fetched successfully",
    data,
  });
});

/**
 * Get translation session details
 * GET /api/translation-session/:sessionId
 */
exports.getSessionDetails = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { sessionId } = req.params;

  const session = await TranslationSession.findById(sessionId).populate(
    "user",
    "firstName lastName email photo"
  );

  if (!session) {
    throw new AppError("Translation session not found", 404);
  }

  // Verify ownership
  if (session.user._id.toString() !== userId.toString()) {
    throw new AppError("Unauthorized access to this session", 403);
  }

  res.json({
    message: "Session details fetched successfully",
    data: session,
  });
});

/**
 * Get translation history for a session
 * GET /api/translation-session/:sessionId/history
 */
exports.getSessionHistory = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { sessionId } = req.params;
  const { page = 1, limit = 50, speakerIndex } = req.query;

  // Verify session ownership
  const session = await TranslationSession.findById(sessionId);
  if (!session) {
    throw new AppError("Translation session not found", 404);
  }

  if (session.user.toString() !== userId.toString()) {
    throw new AppError("Unauthorized access to this session", 403);
  }

  const matchQuery = {
    translationSession: session._id,
  };

  if (speakerIndex !== undefined && speakerIndex !== null) {
    matchQuery.speakerIndex = Number(speakerIndex);
  }

  const aggregateQuery = TranslationHistory.aggregate([
    { $match: matchQuery },
    { $sort: { sequenceNumber: 1, createdAt: 1 } }, // Order by sequence and time
    {
      $project: {
        _id: 1,
        speakerIndex: 1,
        speakerName: 1,
        transcriptionText: 1,
        translationText: 1,
        sourceLanguage: 1,
        targetLanguage: 1,
        transcriptionCharacters: 1,
        translationCharacters: 1,
        translationTimestamp: 1,
        latencyMs: 1,
        translationService: 1,
        tts: 1,
        sequenceNumber: 1,
        isFinal: 1,
        confidence: 1,
        createdAt: 1,
      },
    },
  ]);

  const options = {
    page: parseInt(page),
    limit: parseInt(limit) === -1 ? 9999999 : parseInt(limit),
  };

  const data = await TranslationHistory.aggregatePaginate(
    aggregateQuery,
    options
  );

  res.json({
    message: "Translation history fetched successfully",
    data,
  });
});

/**
 * Update session metrics (for real-time updates during active session)
 * PATCH /api/translation-session/:sessionId/metrics
 */
exports.updateSessionMetrics = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { sessionId } = req.params;

  const {
    totalAudioDurationSec,
    totalInputTokens,
    averageLatencyMs,
  } = req.body;

  // Find session
  const session = await TranslationSession.findById(sessionId);
  if (!session) {
    throw new AppError("Translation session not found", 404);
  }

  // Verify ownership
  if (session.user.toString() !== userId.toString()) {
    throw new AppError("Unauthorized access to this session", 403);
  }

  // Update metrics
  if (totalAudioDurationSec !== undefined) {
    session.totalAudioDurationSec = Number(totalAudioDurationSec);
  }
  if (totalInputTokens !== undefined) {
    session.totalInputTokens = Number(totalInputTokens);
  }
  if (averageLatencyMs !== undefined) {
    session.averageLatencyMs = Number(averageLatencyMs);
  }

  await session.save();

  res.json({
    message: "Session metrics updated successfully",
    data: {
      sessionId: session._id,
      totalAudioDurationSec: session.totalAudioDurationSec,
      totalInputTokens: session.totalInputTokens,
      averageLatencyMs: session.averageLatencyMs,
    },
  });
});

/**
 * Cancel/abort a translation session
 * POST /api/translation-session/:sessionId/cancel
 */
exports.cancelSession = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { sessionId } = req.params;
  const { reason = "User cancelled" } = req.body;

  // Find session
  const session = await TranslationSession.findById(sessionId);
  if (!session) {
    throw new AppError("Translation session not found", 404);
  }

  // Verify ownership
  if (session.user.toString() !== userId.toString()) {
    throw new AppError("Unauthorized access to this session", 403);
  }

  // Update session
  session.status = "cancelled";
  session.sessionEndTime = new Date();
  session.totalDuration = Math.round(
    (session.sessionEndTime - session.sessionStartTime) / 1000
  );
  session.errorMessage = reason;

  // Get final balance (no credit deduction for cancelled sessions)
  const currentUser = await User.findById(userId);
  session.balanceAfterSession =
    Number(currentUser.topUpCreditBalance || 0) +
    Number(currentUser.monthlySubscriptionCreditBalance || 0);

  await session.save();

  res.json({
    message: "Translation session cancelled successfully",
    data: {
      sessionId: session._id,
      status: session.status,
    },
  });
});

/**
 * Get session summary/statistics
 * GET /api/translation-session/:sessionId/summary
 */
exports.getSessionSummary = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { sessionId } = req.params;

  // Find session
  const session = await TranslationSession.findById(sessionId);
  if (!session) {
    throw new AppError("Translation session not found", 404);
  }

  // Verify ownership
  if (session.user.toString() !== userId.toString()) {
    throw new AppError("Unauthorized access to this session", 403);
  }

  // Get translation count by speaker
  const translationCounts = await TranslationHistory.aggregate([
    { $match: { translationSession: session._id } },
    {
      $group: {
        _id: "$speakerIndex",
        count: { $sum: 1 },
        totalTranscriptionChars: { $sum: "$transcriptionCharacters" },
        totalTranslationChars: { $sum: "$translationCharacters" },
        avgLatency: { $avg: "$latencyMs" },
      },
    },
  ]);

  const speaker1Stats = translationCounts.find((s) => s._id === 0) || {
    count: 0,
    totalTranscriptionChars: 0,
    totalTranslationChars: 0,
    avgLatency: 0,
  };
  const speaker2Stats = translationCounts.find((s) => s._id === 1) || {
    count: 0,
    totalTranscriptionChars: 0,
    totalTranslationChars: 0,
    avgLatency: 0,
  };

  res.json({
    message: "Session summary fetched successfully",
    data: {
      session: {
        id: session._id,
        status: session.status,
        startTime: session.sessionStartTime,
        endTime: session.sessionEndTime,
        duration: session.totalDuration,
        mode: session.mode,
      },
      speakers: {
        speaker1: {
          language: session.speaker1Language,
          earpiece: session.speaker1Earpiece,
          gender: session.speaker1Gender,
          translations: speaker1Stats.count,
          transcriptionChars: speaker1Stats.totalTranscriptionChars,
          translationChars: speaker1Stats.totalTranslationChars,
          avgLatency: Math.round(speaker1Stats.avgLatency || 0),
        },
        speaker2: {
          language: session.speaker2Language,
          earpiece: session.speaker2Earpiece,
          gender: session.speaker2Gender,
          translations: speaker2Stats.count,
          transcriptionChars: speaker2Stats.totalTranscriptionChars,
          translationChars: speaker2Stats.totalTranslationChars,
          avgLatency: Math.round(speaker2Stats.avgLatency || 0),
        },
      },
      metrics: {
        totalTranslations: session.totalTranslations,
        totalAudioDuration: session.totalAudioDurationSec,
        totalTranscriptionChars: session.totalTranscriptionCharacters,
        totalTranslationChars: session.totalTranslationCharacters,
        averageLatency: session.averageLatencyMs,
      },
      cost: {
        inputCost: session.inputCost,
        outputCost: session.outputCost,
        totalCost: session.totalCost,
        balanceBefore: session.balanceBeforeSession,
        balanceAfter: session.balanceAfterSession,
        feeRates: session.appliedFeeRates,
      },
      connection: {
        twsConnected: session.twsConnected,
        twsDeviceName: session.twsDeviceName,
      },
    },
  });
});

