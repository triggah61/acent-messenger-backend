/**
 * @fileoverview Call routes
 *
 * This module defines API routes for call-related operations including
 * call initiation, management, and token generation.
 *
 * @module routes/api/user/call
 * @requires express
 * @requires ../../../controller/user/CallController
 * @requires ../../../middleware/Authenticated
 */

const {
  initiateCall,
  acceptCall,
  declineCall,
  endCall,
  generateToken,
  getCallById,
  getCallHistory,
  getActiveCalls,
  updateCallQuality,
} = require("../../../controller/user/CallController");
const Authenticated = require("../../../middleware/Authenticated");
const callRouter = require("express").Router();

require("express-group-routes");

callRouter.group("/call", (call) => {
  // Apply authentication to all call routes
  call.use(Authenticated);

  // Call management routes
  call.post("/initiate", initiateCall);
  call.post("/accept/:callId", acceptCall);
  call.post("/decline/:callId", declineCall);
  call.post("/end/:callId", endCall);

  // Token generation
  call.get("/token/:callId", generateToken);

  // Get specific call by ID
  call.get("/:callId", getCallById);

  // Call history and status
  call.get("/history", getCallHistory);
  call.get("/active", getActiveCalls);

  // Call quality
  call.post("/quality/:callId", updateCallQuality);
});

module.exports = callRouter; 