/**
 * @fileoverview TranslationSession routes
 *
 * This module defines API routes for translation session operations including
 * starting sessions, stopping sessions, adding translations, and fetching history.
 *
 * @module routes/api/user/translation-session
 * @requires express
 * @requires ../../../controller/TranslationSessionController
 * @requires ../../../middleware/Authenticated
 */

const {
  startSession,
  stopSession,
  addTranslation,
  getMySessions,
  getSessionDetails,
  getSessionHistory,
  updateSessionMetrics,
  cancelSession,
  getSessionSummary,
} = require("../../../controller/TranslationSessionController");
const Authenticated = require("../../../middleware/Authenticated");
const translationSessionRouter = require("express").Router();

require("express-group-routes");

translationSessionRouter.group("/translation-session", (session) => {
  // Apply authentication to all translation session routes
  session.use(Authenticated);

  // Start a new translation session
  session.post("/start", startSession);

  // Get user's translation sessions
  session.get("/my-sessions", getMySessions);

  // Stop translation session
  session.post("/stop/:sessionId", stopSession);

  // Cancel/abort translation session
  session.post("/:sessionId/cancel", cancelSession);

  // Add translation to session
  session.post("/:sessionId/add-translation", addTranslation);

  // Update session metrics (real-time updates)
  session.patch("/:sessionId/metrics", updateSessionMetrics);

  // Get session details
  session.get("/:sessionId", getSessionDetails);

  // Get translation history for a session
  session.get("/:sessionId/history", getSessionHistory);

  // Get session summary/statistics
  session.get("/:sessionId/summary", getSessionSummary);
});

module.exports = translationSessionRouter;

