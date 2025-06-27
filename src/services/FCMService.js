/**
 * @fileoverview Firebase Cloud Messaging (FCM) Service
 *
 * This service handles all FCM operations including sending push notifications,
 * managing device tokens, and handling notification templates for different
 * message types.
 *
 * @module services/FCMService
 * @requires ../config/fcm
 * @requires ../model/User
 */

const { getMessaging, isFCMReady, getFCMError, getFCMStatus } = require('../config/fcm');
const User = require('../model/User');

class FCMService {
  constructor() {
    this.messaging = null;
    this.isInitialized = false;
    this.initializationError = null;
    this.init();
  }

  /**
   * Initialize FCM service
   */
  async init() {
    try {
      console.log('FCMService: Initializing...');
      this.messaging = getMessaging();
      this.isInitialized = isFCMReady();
      this.initializationError = getFCMError();
      
      if (this.isInitialized && this.messaging) {
        console.log('FCMService: Initialized successfully');
        // Test if messaging object has required methods
        const hasMulticast = typeof this.messaging.sendMulticast === 'function';
        const hasSend = typeof this.messaging.send === 'function';
        console.log(`FCMService: Available methods - sendMulticast: ${hasMulticast}, send: ${hasSend}`);
        
        if (!hasMulticast && !hasSend) {
          console.error('FCMService: Messaging object lacks required methods');
          this.isInitialized = false;
          this.initializationError = new Error('Firebase messaging methods not available');
        }
      } else {
        console.warn('FCMService: Failed to initialize - FCM not configured properly');
        if (this.initializationError) {
          console.warn('FCMService: Initialization error:', this.initializationError.message);
        }
      }
    } catch (error) {
      console.error('FCMService: Initialization error:', error);
      this.isInitialized = false;
      this.initializationError = error;
    }
  }

  /**
   * Check if FCM is available and handle mock mode
   */
  _checkFCMAvailability() {
    if (!this.isInitialized || !this.messaging) {
      console.warn('FCMService: FCM not initialized - notification will be mocked');
      return false;
    }
    
    // Check if at least one send method is available
    const hasMulticast = typeof this.messaging.sendMulticast === 'function';
    const hasSend = typeof this.messaging.send === 'function';
    
    if (!hasMulticast && !hasSend) {
      console.warn('FCMService: No sending methods available - notification will be mocked');
      return false;
    }
    
    return true;
  }

  /**
   * Mock notification sending for development
   */
  _mockNotificationSend(tokens, notification, data) {
    console.log('📱 MOCK FCM NOTIFICATION:');
    console.log('  Tokens:', Array.isArray(tokens) ? tokens.length : 1, 'token(s)');
    console.log('  Title:', notification.title);
    console.log('  Body:', notification.body);
    console.log('  Data:', JSON.stringify(data, null, 2));
    
    return {
      success: true,
      successCount: Array.isArray(tokens) ? tokens.length : 1,
      failureCount: 0,
      responses: [],
      mock: true,
    };
  }

  /**
   * Add or update FCM token for a user
   * @param {string} userId - User ID
   * @param {string} token - FCM token
   * @param {string} platform - Platform (android, ios, web)
   * @param {string} deviceId - Device identifier (optional)
   * @returns {Promise<boolean>} Success status
   */
  async addUserToken(userId, token, platform, deviceId = null) {
    try {
      if (!token || !platform || !userId) {
        throw new Error('Missing required parameters: userId, token, or platform');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Initialize fcmTokens array if it doesn't exist
      if (!user.fcmTokens) {
        user.fcmTokens = [];
      }

      // Check if token already exists
      const existingTokenIndex = user.fcmTokens.findIndex(
        (fcmToken) => fcmToken.token === token
      );

      if (existingTokenIndex >= 0) {
        // Update existing token
        user.fcmTokens[existingTokenIndex].lastUsed = new Date();
        user.fcmTokens[existingTokenIndex].isActive = true;
        user.fcmTokens[existingTokenIndex].platform = platform;
        if (deviceId) {
          user.fcmTokens[existingTokenIndex].deviceId = deviceId;
        }
      } else {
        // Add new token
        user.fcmTokens.push({
          token,
          platform,
          deviceId,
          isActive: true,
          lastUsed: new Date(),
        });
      }

      // Clean up old tokens (keep only last 5 per user)
      if (user.fcmTokens.length > 5) {
        user.fcmTokens.sort((a, b) => b.lastUsed - a.lastUsed);
        user.fcmTokens = user.fcmTokens.slice(0, 5);
      }

      await user.save();
      console.log(`FCMService: Token added/updated for user ${userId}, platform: ${platform}`);
      return true;
    } catch (error) {
      console.error('FCMService: Error adding user token:', error);
      return false;
    }
  }

  /**
   * Remove FCM token for a user
   * @param {string} userId - User ID
   * @param {string} token - FCM token to remove
   * @returns {Promise<boolean>} Success status
   */
  async removeUserToken(userId, token) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      user.fcmTokens = user.fcmTokens.filter((fcmToken) => fcmToken.token !== token);
      await user.save();
      
      console.log(`FCMService: Token removed for user ${userId}`);
      return true;
    } catch (error) {
      console.error('FCMService: Error removing user token:', error);
      return false;
    }
  }

  /**
   * Deactivate FCM token (mark as inactive instead of removing)
   * @param {string} userId - User ID
   * @param {string} token - FCM token to deactivate
   * @returns {Promise<boolean>} Success status
   */
  async deactivateUserToken(userId, token) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const tokenIndex = user.fcmTokens.findIndex((fcmToken) => fcmToken.token === token);
      if (tokenIndex >= 0) {
        user.fcmTokens[tokenIndex].isActive = false;
        await user.save();
        console.log(`FCMService: Token deactivated for user ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('FCMService: Error deactivating user token:', error);
      return false;
    }
  }

  /**
   * Get active FCM tokens for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of active tokens
   */
  async getUserTokens(userId) {
    try {
      const user = await User.findById(userId).select('fcmTokens notificationSettings');
      if (!user || !user.notificationSettings.enabled) {
        return [];
      }

      return user.fcmTokens
        .filter((fcmToken) => fcmToken.isActive)
        .map((fcmToken) => fcmToken.token);
    } catch (error) {
      console.error('FCMService: Error getting user tokens:', error);
      return [];
    }
  }

  /**
   * Send push notification to specific user(s)
   * @param {string|Array} userIds - Single user ID or array of user IDs
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Send result
   */
  async sendToUsers(userIds, notification, data = {}, options = {}) {
    try {
      if (!this.isInitialized) {
        console.warn('FCMService: Cannot send notification - FCM not initialized');
        return { success: false, error: 'FCM not initialized' };
      }

      const users = Array.isArray(userIds) ? userIds : [userIds];
      const results = [];

      for (const userId of users) {
        try {
          const tokens = await this.getUserTokens(userId);
          if (tokens.length === 0) {
            console.log(`FCMService: No active tokens for user ${userId}`);
            continue;
          }

          const result = await this.sendToTokens(tokens, notification, data, options);
          results.push({ userId, ...result });
        } catch (error) {
          console.error(`FCMService: Error sending to user ${userId}:`, error);
          results.push({ userId, success: false, error: error.message });
        }
      }

      return { success: true, results };
    } catch (error) {
      console.error('FCMService: Error in sendToUsers:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send push notification to specific tokens
   * @param {string|Array} tokens - Single token or array of tokens
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Send result
   */
  async sendToTokens(tokens, notification, data = {}, options = {}) {
    try {
      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
      
      if (tokenArray.length === 0) {
        return { success: false, error: 'No tokens provided' };
      }

      // Check if FCM is available
      if (!this._checkFCMAvailability()) {
        return this._mockNotificationSend(tokenArray, notification, data);
      }

      // Double-check messaging object and methods
      if (!this.messaging) {
        console.error('FCMService: Messaging object is null');
        return this._mockNotificationSend(tokenArray, notification, data);
      }

      // Check if sendMulticast method exists (Firebase Admin SDK v9.0.0+)
      if (typeof this.messaging.sendMulticast !== 'function') {
        console.warn('FCMService: sendMulticast not available, falling back to individual sends');
        return await this._sendIndividualNotifications(tokenArray, notification, data, options);
      }

      // Prepare the message
      const message = {
        notification: {
          title: notification.title || 'New Message',
          body: notification.body || 'You have a new message',
          ...notification,
        },
        data: {
          ...data,
          // Ensure all data values are strings (FCM requirement)
          timestamp: new Date().toISOString(),
        },
        android: {
          notification: {
            channel_id: 'default',
            priority: 'high',
            sound: options.sound !== false ? 'default' : undefined,
          },
          priority: 'high',
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notification.title || 'New Message',
                body: notification.body || 'You have a new message',
              },
              sound: options.sound !== false ? 'default' : undefined,
              badge: options.badge || 1,
            },
          },
        },
        webpush: {
          notification: {
            title: notification.title || 'New Message',
            body: notification.body || 'You have a new message',
            icon: options.icon || '/icon-192x192.png',
            badge: options.badge || '/badge-72x72.png',
          },
        },
        tokens: tokenArray,
      };

      // Convert data values to strings
      Object.keys(message.data).forEach(key => {
        if (typeof message.data[key] !== 'string') {
          message.data[key] = JSON.stringify(message.data[key]);
        }
      });

      console.log('FCMService: Sending multicast message to', tokenArray.length, 'tokens');
      const response = await this.messaging.sendMulticast(message);

      // Handle invalid tokens
      if (response.failureCount > 0) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            console.warn(`FCMService: Token ${idx} failed:`, resp.error?.message);
            if (errorCode === 'messaging/invalid-registration-token' || 
                errorCode === 'messaging/registration-token-not-registered') {
              invalidTokens.push(tokenArray[idx]);
            }
          }
        });

        // Remove invalid tokens
        if (invalidTokens.length > 0) {
          console.log(`FCMService: Removing ${invalidTokens.length} invalid tokens`);
          await this.removeInvalidTokens(invalidTokens);
        }
      }

      console.log(`FCMService: Sent notification to ${tokenArray.length} tokens, success: ${response.successCount}, failure: ${response.failureCount}`);
      
      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses,
      };
    } catch (error) {
      console.error('FCMService: Error sending to tokens:', error);
      
      // If it's a method not available error, fall back to individual sends
      if (error.message && error.message.includes('sendMulticast is not a function')) {
        console.warn('FCMService: Falling back to individual notification sends');
        return await this._sendIndividualNotifications(
          Array.isArray(tokens) ? tokens : [tokens], 
          notification, 
          data, 
          options
        );
      }
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Fallback method for older Firebase SDK versions or when sendMulticast is not available
   * @param {Array} tokens - Array of tokens
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Send result
   */
  async _sendIndividualNotifications(tokens, notification, data = {}, options = {}) {
    try {
      if (!this.messaging || typeof this.messaging.send !== 'function') {
        console.error('FCMService: Neither sendMulticast nor send methods are available');
        return this._mockNotificationSend(tokens, notification, data);
      }

      const results = [];
      let successCount = 0;
      let failureCount = 0;

      // Prepare base message
      const baseMessage = {
        notification: {
          title: notification.title || 'New Message',
          body: notification.body || 'You have a new message',
          ...notification,
        },
        data: {
          ...data,
          timestamp: new Date().toISOString(),
        },
        android: {
          notification: {
            channel_id: 'default',
            priority: 'high',
            sound: options.sound !== false ? 'default' : undefined,
          },
          priority: 'high',
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notification.title || 'New Message',
                body: notification.body || 'You have a new message',
              },
              sound: options.sound !== false ? 'default' : undefined,
              badge: options.badge || 1,
            },
          },
        },
        webpush: {
          notification: {
            title: notification.title || 'New Message',
            body: notification.body || 'You have a new message',
            icon: options.icon || '/icon-192x192.png',
            badge: options.badge || '/badge-72x72.png',
          },
        },
      };

      // Convert data values to strings
      Object.keys(baseMessage.data).forEach(key => {
        if (typeof baseMessage.data[key] !== 'string') {
          baseMessage.data[key] = JSON.stringify(baseMessage.data[key]);
        }
      });

      // Send to each token individually
      for (const token of tokens) {
        try {
          const message = {
            ...baseMessage,
            token: token,
          };

          await this.messaging.send(message);
          results.push({ success: true });
          successCount++;
        } catch (error) {
          console.warn(`FCMService: Failed to send to token: ${error.message}`);
          results.push({ success: false, error: error });
          failureCount++;

          // Handle invalid tokens
          const errorCode = error.code;
          if (errorCode === 'messaging/invalid-registration-token' || 
              errorCode === 'messaging/registration-token-not-registered') {
            await this.removeInvalidTokens([token]);
          }
        }
      }

      console.log(`FCMService: Individual sends completed - success: ${successCount}, failure: ${failureCount}`);
      
      return {
        success: successCount > 0,
        successCount,
        failureCount,
        responses: results,
        method: 'individual',
      };
    } catch (error) {
      console.error('FCMService: Error in individual notification sends:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove invalid tokens from users
   * @param {Array} invalidTokens - Array of invalid tokens
   */
  async removeInvalidTokens(invalidTokens) {
    try {
      await User.updateMany(
        { 'fcmTokens.token': { $in: invalidTokens } },
        { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
      );
      console.log(`FCMService: Removed ${invalidTokens.length} invalid tokens from database`);
    } catch (error) {
      console.error('FCMService: Error removing invalid tokens:', error);
    }
  }

  /**
   * Send new message notification
   * @param {string} recipientUserId - Recipient user ID
   * @param {Object} messageData - Message data
   * @param {Object} senderData - Sender data
   * @returns {Promise<Object>} Send result
   */
  async sendNewMessageNotification(recipientUserId, messageData, senderData) {
    try {
      const user = await User.findById(recipientUserId).select('notificationSettings');
      if (!user || !user.notificationSettings.enabled || !user.notificationSettings.messageNotifications) {
        return { success: false, error: 'Message notifications disabled for user' };
      }

      const notification = {
        title: `${senderData.firstName} ${senderData.lastName}`,
        body: messageData.content || 'Sent you a message',
      };

      const data = {
        type: 'new_message',
        messageId: messageData._id?.toString() || messageData.id,
        chatSessionId: messageData.chatSession,
        senderId: senderData._id?.toString() || senderData.id,
        senderName: `${senderData.firstName} ${senderData.lastName}`,
        content: messageData.content || '',
      };

      const options = {
        sound: user.notificationSettings.sound,
        vibration: user.notificationSettings.vibration,
        badge: 1,
      };

      return await this.sendToUsers(recipientUserId, notification, data, options);
    } catch (error) {
      console.error('FCMService: Error sending new message notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send incoming call notification
   * @param {string} recipientUserId - Recipient user ID
   * @param {Object} callData - Call data
   * @param {Object} callerData - Caller data
   * @returns {Promise<Object>} Send result
   */
  async sendIncomingCallNotification(recipientUserId, callData, callerData) {
    try {
      const user = await User.findById(recipientUserId).select('notificationSettings');
      if (!user || !user.notificationSettings.enabled || !user.notificationSettings.callNotifications) {
        return { success: false, error: 'Call notifications disabled for user' };
      }

      const notification = {
        title: 'Incoming Call',
        body: `${callerData.firstName} ${callerData.lastName} is calling you`,
      };

      const data = {
        type: 'incoming_call',
        callId: callData.id,
        callerId: callerData._id?.toString() || callerData.id,
        callerName: `${callerData.firstName} ${callerData.lastName}`,
        callType: callData.type || 'voice', // voice or video
      };

      const options = {
        sound: user.notificationSettings.sound,
        vibration: user.notificationSettings.vibration,
        badge: 1,
      };

      return await this.sendToUsers(recipientUserId, notification, data, options);
    } catch (error) {
      console.error('FCMService: Error sending incoming call notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send group message notification
   * @param {Array} recipientUserIds - Array of recipient user IDs
   * @param {Object} messageData - Message data
   * @param {Object} senderData - Sender data
   * @param {Object} groupData - Group data
   * @returns {Promise<Object>} Send result
   */
  async sendGroupMessageNotification(recipientUserIds, messageData, senderData, groupData) {
    try {
      const notification = {
        title: groupData.title || 'Group Message',
        body: `${senderData.firstName}: ${messageData.content || 'Sent a message'}`,
      };

      const data = {
        type: 'group_message',
        messageId: messageData._id?.toString() || messageData.id,
        chatSessionId: messageData.chatSession,
        senderId: senderData._id?.toString() || senderData.id,
        senderName: `${senderData.firstName} ${senderData.lastName}`,
        groupId: groupData._id?.toString() || groupData.id,
        groupName: groupData.title || 'Group',
        content: messageData.content || '',
      };

      const options = {
        sound: true,
        vibration: true,
        badge: 1,
      };

      // Filter recipients who have group notifications enabled
      const usersWithGroupNotifications = await User.find({
        _id: { $in: recipientUserIds },
        'notificationSettings.enabled': true,
        'notificationSettings.groupNotifications': true,
      }).select('_id');

      const enabledUserIds = usersWithGroupNotifications.map(user => user._id.toString());

      if (enabledUserIds.length === 0) {
        return { success: false, error: 'No users have group notifications enabled' };
      }

      return await this.sendToUsers(enabledUserIds, notification, data, options);
    } catch (error) {
      console.error('FCMService: Error sending group message notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send general notification
   * @param {string|Array} userIds - User ID(s)
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {Object} data - Additional data
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Send result
   */
  async sendGeneralNotification(userIds, title, body, data = {}, options = {}) {
    try {
      const notification = { title, body };
      const notificationData = {
        type: 'general',
        ...data,
      };

      return await this.sendToUsers(userIds, notification, notificationData, options);
    } catch (error) {
      console.error('FCMService: Error sending general notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get FCM service status
   * @returns {Object} Service status
   */
  getStatus() {
    const fcmStatus = getFCMStatus();
    return {
      service: {
        isInitialized: this.isInitialized,
        hasMessaging: !!this.messaging,
        initializationError: this.initializationError?.message || null,
      },
      fcm: fcmStatus,
      ready: this.isInitialized && fcmStatus.isReady,
    };
  }
}

// Export singleton instance
module.exports = new FCMService(); 