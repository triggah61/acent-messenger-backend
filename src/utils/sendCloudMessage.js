/**
 * @fileoverview Cloud Message Utility
 *
 * This utility provides a simple interface for sending FCM push notifications
 * from anywhere in the backend. It's a wrapper around the FCM service with
 * predefined message templates and easy-to-use functions.
 *
 * @module utils/sendCloudMessage
 * @requires ../services/FCMService
 */

const FCMService = require('../services/FCMService');

/**
 * Send a cloud message to specific user(s)
 * @param {Object} options - Message options
 * @param {string|Array<string>} options.userIds - User ID(s) to send to
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body
 * @param {Object} [options.data={}] - Additional data payload
 * @param {string} [options.type='general'] - Message type (general, message, call, group)
 * @param {Object} [options.extra={}] - Extra options (sound, vibration, badge, etc.)
 * @returns {Promise<Object>} Send result
 * 
 * @example
 * // Send a simple notification
 * sendCloudMessage({
 *   userIds: 'user123',
 *   title: 'Hello!',
 *   body: 'You have a new message'
 * });
 * 
 * @example
 * // Send notification to multiple users
 * sendCloudMessage({
 *   userIds: ['user1', 'user2', 'user3'],
 *   title: 'Group Update',
 *   body: 'Someone posted in your group',
 *   type: 'group',
 *   data: { groupId: 'group123' }
 * });
 */
async function sendCloudMessage(options) {
  try {
    const {
      userIds,
      title,
      body,
      data = {},
      type = 'general',
      extra = {}
    } = options;

    if (!userIds || !title || !body) {
      throw new Error('userIds, title, and body are required');
    }

    console.log(`sendCloudMessage: Sending ${type} notification to ${Array.isArray(userIds) ? userIds.length : 1} user(s)`);

    const result = await FCMService.sendGeneralNotification(
      userIds,
      title,
      body,
      { type, ...data },
      { sound: true, vibration: true, badge: 1, ...extra }
    );

    console.log(`sendCloudMessage: Result -`, result);
    return result;
  } catch (error) {
    console.error('sendCloudMessage: Error -', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send a new message notification
 * @param {string} recipientUserId - Recipient user ID
 * @param {Object} messageData - Message data
 * @param {Object} senderData - Sender data
 * @returns {Promise<Object>} Send result
 * 
 * @example
 * sendNewMessageNotification('user123', {
 *   content: 'Hello there!',
 *   chatSession: 'session456'
 * }, {
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   _id: 'sender789'
 * });
 */
async function sendNewMessageNotification(recipientUserId, messageData, senderData) {
  try {
    console.log(`sendNewMessageNotification: Sending to ${recipientUserId}`);
    const result = await FCMService.sendNewMessageNotification(recipientUserId, messageData, senderData);
    console.log(`sendNewMessageNotification: Result -`, result);
    return result;
  } catch (error) {
    console.error('sendNewMessageNotification: Error -', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send a group message notification
 * @param {Array<string>} recipientUserIds - Array of recipient user IDs
 * @param {Object} messageData - Message data
 * @param {Object} senderData - Sender data
 * @param {Object} groupData - Group data
 * @returns {Promise<Object>} Send result
 * 
 * @example
 * sendGroupMessageNotification(['user1', 'user2'], {
 *   content: 'Hello everyone!',
 *   chatSession: 'group123'
 * }, {
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   _id: 'sender789'
 * }, {
 *   title: 'My Group',
 *   _id: 'group123'
 * });
 */
async function sendGroupMessageNotification(recipientUserIds, messageData, senderData, groupData) {
  try {
    console.log(`sendGroupMessageNotification: Sending to ${recipientUserIds.length} users`);
    const result = await FCMService.sendGroupMessageNotification(recipientUserIds, messageData, senderData, groupData);
    console.log(`sendGroupMessageNotification: Result -`, result);
    return result;
  } catch (error) {
    console.error('sendGroupMessageNotification: Error -', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send an incoming call notification
 * @param {string} recipientUserId - Recipient user ID
 * @param {Object} callData - Call data
 * @param {Object} callerData - Caller data
 * @returns {Promise<Object>} Send result
 * 
 * @example
 * sendIncomingCallNotification('user123', {
 *   id: 'call456',
 *   type: 'video'
 * }, {
 *   firstName: 'Jane',
 *   lastName: 'Smith',
 *   _id: 'caller789'
 * });
 */
async function sendIncomingCallNotification(recipientUserId, callData, callerData) {
  try {
    console.log(`sendIncomingCallNotification: Sending to ${recipientUserId}`);
    const result = await FCMService.sendIncomingCallNotification(recipientUserId, callData, callerData);
    console.log(`sendIncomingCallNotification: Result -`, result);
    return result;
  } catch (error) {
    console.error('sendIncomingCallNotification: Error -', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send a custom notification with predefined templates
 * @param {string} template - Template name
 * @param {string|Array<string>} userIds - User ID(s)
 * @param {Object} templateData - Data for template
 * @returns {Promise<Object>} Send result
 * 
 * @example
 * sendTemplateNotification('friend_request', 'user123', {
 *   senderName: 'John Doe'
 * });
 */
async function sendTemplateNotification(template, userIds, templateData = {}) {
  try {
    const templates = {
      friend_request: {
        title: 'New Friend Request',
        body: `${templateData.senderName || 'Someone'} sent you a friend request`,
        data: { type: 'friend_request', senderId: templateData.senderId }
      },
      group_invite: {
        title: 'Group Invitation',
        body: `You've been invited to join ${templateData.groupName || 'a group'}`,
        data: { type: 'group_invite', groupId: templateData.groupId }
      },
      mention: {
        title: 'You were mentioned',
        body: `${templateData.senderName || 'Someone'} mentioned you in ${templateData.location || 'a message'}`,
        data: { type: 'mention', messageId: templateData.messageId }
      },
      system: {
        title: templateData.title || 'System Notification',
        body: templateData.body || 'You have a system notification',
        data: { type: 'system', ...templateData }
      }
    };

    const selectedTemplate = templates[template];
    if (!selectedTemplate) {
      throw new Error(`Template '${template}' not found`);
    }

    return await sendCloudMessage({
      userIds,
      title: selectedTemplate.title,
      body: selectedTemplate.body,
      data: selectedTemplate.data,
      type: template
    });
  } catch (error) {
    console.error('sendTemplateNotification: Error -', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if FCM service is ready
 * @returns {boolean} True if FCM is ready
 */
function isFCMReady() {
  return FCMService.getStatus().ready;
}

/**
 * Get FCM service status
 * @returns {Object} FCM service status
 */
function getFCMStatus() {
  return FCMService.getStatus();
}

module.exports = {
  sendCloudMessage,
  sendNewMessageNotification,
  sendGroupMessageNotification,
  sendIncomingCallNotification,
  sendTemplateNotification,
  isFCMReady,
  getFCMStatus,
  
  // Export FCMService for direct access if needed
  FCMService
}; 