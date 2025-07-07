/**
 * @fileoverview Agora configuration and token generation
 *
 * This module provides configuration for Agora SDK and utilities for
 * generating access tokens for voice and video calls.
 *
 * @module config/agora
 * @requires agora-access-token
 */

const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

/**
 * Agora configuration object
 */
const AGORA_CONFIG = {
  appId: process.env.AGORA_APP_ID,
  appCertificate: process.env.AGORA_APP_CERTIFICATE,
  tokenExpirationInSeconds: 3600, // 1 hour
  privilegeExpiredTs: 0, // 0 means no expiration for privileges
};

/**
 * Validate Agora configuration
 * @returns {Object} Validation result
 */
function validateAgoraConfig() {
  const errors = [];
  
  if (!AGORA_CONFIG.appId) {
    errors.push('AGORA_APP_ID is not configured');
  }
  
  if (!AGORA_CONFIG.appCertificate) {
    errors.push('AGORA_APP_CERTIFICATE is not configured');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    config: AGORA_CONFIG
  };
}

/**
 * Convert string user ID to integer UID using the same logic as frontend
 * This ensures consistent UID generation between frontend and backend
 * @param {string} userId - User ID string
 * @returns {number} Integer UID
 */
function generateIntegerUid(userId) {
  // Create a simple hash from the string (similar to JavaScript's hashCode)
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Take absolute value and limit to 5 digits (same as frontend)
  let uid = Math.abs(hash) % 100000;
  
  // Ensure UID is not 0 (which is reserved)
  if (uid === 0) uid = 1;
  
  console.log(`Generated UID ${uid} from user ID: ${userId}`);
  return uid;
}

/**
 * Generate Agora RTC token for voice/video calling
 * @param {string} channelName - Channel name for the call
 * @param {string} userId - User ID (should be unique)
 * @param {string} role - User role ('publisher' or 'subscriber')
 * @param {number} expireTime - Token expiration time in seconds (optional)
 * @returns {Object} Token generation result
 */
function generateRtcToken(channelName, userId, role = 'publisher', expireTime = null) {
  try {
    // Validate configuration
    const validation = validateAgoraConfig();
    if (!validation.isValid) {
      throw new Error(`Agora configuration invalid: ${validation.errors.join(', ')}`);
    }
    
    // Validate input parameters
    if (!channelName || typeof channelName !== 'string') {
      throw new Error('Channel name is required and must be a string');
    }
    
    if (!userId || typeof userId !== 'string') {
      throw new Error('User ID is required and must be a string');
    }
    
    // Set expiration time
    const tokenExpirationInSeconds = expireTime || AGORA_CONFIG.tokenExpirationInSeconds;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + tokenExpirationInSeconds;
    
    // Determine role
    const rtcRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    
    // Convert string user ID to integer UID using consistent logic
    const integerUid = generateIntegerUid(userId);
    
    // Generate token
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_CONFIG.appId,
      AGORA_CONFIG.appCertificate,
      channelName,
      integerUid, // Use consistent integer UID
      rtcRole,
      privilegeExpiredTs
    );
    
    console.log(`Agora token generated for channel: ${channelName}, user: ${userId} (UID: ${integerUid}), role: ${role}`);
    
    return {
      success: true,
      token,
      channelName,
      userId,
      integerUid, // Include the generated UID for debugging
      role,
      appId: AGORA_CONFIG.appId,
      expiresAt: privilegeExpiredTs,
      expiresIn: tokenExpirationInSeconds,
    };
    
  } catch (error) {
    console.error('Error generating Agora RTC token:', error);
    return {
      success: false,
      error: error.message,
      channelName,
      userId,
      role,
    };
  }
}

/**
 * Generate Agora RTC token with string UID (for cases where string UID is preferred)
 * @param {string} channelName - Channel name for the call
 * @param {string} userId - User ID (string)
 * @param {string} role - User role ('publisher' or 'subscriber')
 * @param {number} expireTime - Token expiration time in seconds (optional)
 * @returns {Object} Token generation result
 */
function generateRtcTokenWithStringUid(channelName, userId, role = 'publisher', expireTime = null) {
  try {
    // Validate configuration
    const validation = validateAgoraConfig();
    if (!validation.isValid) {
      throw new Error(`Agora configuration invalid: ${validation.errors.join(', ')}`);
    }
    
    // Validate input parameters
    if (!channelName || typeof channelName !== 'string') {
      throw new Error('Channel name is required and must be a string');
    }
    
    if (!userId || typeof userId !== 'string') {
      throw new Error('User ID is required and must be a string');
    }
    
    // Set expiration time
    const tokenExpirationInSeconds = expireTime || AGORA_CONFIG.tokenExpirationInSeconds;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + tokenExpirationInSeconds;
    
    // Determine role
    const rtcRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    
    // Generate token with string UID
    const token = RtcTokenBuilder.buildTokenWithAccount(
      AGORA_CONFIG.appId,
      AGORA_CONFIG.appCertificate,
      channelName,
      userId, // String UID
      rtcRole,
      privilegeExpiredTs
    );
    
    console.log(`Agora token generated (string UID) for channel: ${channelName}, user: ${userId}, role: ${role}`);
    
    return {
      success: true,
      token,
      channelName,
      userId,
      role,
      appId: AGORA_CONFIG.appId,
      expiresAt: privilegeExpiredTs,
      expiresIn: tokenExpirationInSeconds,
    };
    
  } catch (error) {
    console.error('Error generating Agora RTC token (string UID):', error);
    return {
      success: false,
      error: error.message,
      channelName,
      userId,
      role,
    };
  }
}

/**
 * Generate unique channel name for a call
 * @param {Array} participantIds - Array of participant user IDs
 * @param {string} callType - Type of call ('voice' or 'video')
 * @returns {string} Unique channel name
 */
function generateChannelName(participantIds, callType = 'voice') {
  // Sort participant IDs to ensure consistent channel names
  const sortedIds = [...participantIds].sort();
  
  // Create base channel name
  const timestamp = Date.now();
  const participantHash = sortedIds.join('_');
  
  return `${callType}_${participantHash}_${timestamp}`;
}

/**
 * Check if Agora is properly configured
 * @returns {boolean} Configuration status
 */
function isAgoraConfigured() {
  return validateAgoraConfig().isValid;
}

/**
 * Get Agora configuration status
 * @returns {Object} Configuration status and details
 */
function getAgoraStatus() {
  const validation = validateAgoraConfig();
  
  return {
    isConfigured: validation.isValid,
    appId: AGORA_CONFIG.appId ? 'configured' : 'missing',
    appCertificate: AGORA_CONFIG.appCertificate ? 'configured' : 'missing',
    tokenExpirationInSeconds: AGORA_CONFIG.tokenExpirationInSeconds,
    errors: validation.errors,
  };
}

module.exports = {
  AGORA_CONFIG,
  generateRtcToken,
  generateRtcTokenWithStringUid,
  generateChannelName,
  generateIntegerUid,
  validateAgoraConfig,
  isAgoraConfigured,
  getAgoraStatus,
}; 