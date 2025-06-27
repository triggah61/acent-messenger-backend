/**
 * @fileoverview Notification Controller for FCM token management and notification settings
 *
 * This controller handles all notification-related API endpoints including
 * FCM token registration, notification preferences, and notification sending.
 *
 * @module controller/user/NotificationController
 * @requires ../../services/FCMService
 * @requires ../../model/User
 * @requires ../../exception/catchAsync
 * @requires ../../exception/AppError
 * @requires ../../validator/simpleValidator
 */

const FCMService = require('../../services/FCMService');
const User = require('../../model/User');
const catchAsync = require('../../exception/catchAsync');
const AppError = require('../../exception/AppError');
const SimpleValidator = require('../../validator/simpleValidator');

/**
 * Register or update FCM token for the authenticated user
 * @route POST /user/notification/register-token
 * @access Private
 */
exports.registerFCMToken = catchAsync(async (req, res) => {
  const { user } = req;
  const { token, platform, deviceId } = req.body;

  SimpleValidator(req.body, {
    token: 'required|string',
    platform: 'required|string|in:android,ios,web',
  });

  if (!token || !platform) {
    throw new AppError('Token and platform are required', 400);
  }

  const success = await FCMService.addUserToken(user._id, token, platform, deviceId);

  if (!success) {
    throw new AppError('Failed to register FCM token', 500);
  }

  return res.status(200).json({
    message: 'FCM token registered successfully',
    data: {
      userId: user._id,
      platform,
      registered: true,
    },
  });
});

/**
 * Remove FCM token for the authenticated user
 * @route DELETE /user/notification/remove-token
 * @access Private
 */
exports.removeFCMToken = catchAsync(async (req, res) => {
  const { user } = req;
  const { token } = req.body;

  SimpleValidator(req.body, {
    token: 'required|string',
  });

  const success = await FCMService.removeUserToken(user._id, token);

  if (!success) {
    throw new AppError('Failed to remove FCM token', 500);
  }

  return res.status(200).json({
    message: 'FCM token removed successfully',
    data: {
      userId: user._id,
      removed: true,
    },
  });
});

/**
 * Get user's notification settings
 * @route GET /user/notification/settings
 * @access Private
 */
exports.getNotificationSettings = catchAsync(async (req, res) => {
  const { user } = req;

  const userData = await User.findById(user._id).select('notificationSettings fcmTokens');

  if (!userData) {
    throw new AppError('User not found', 404);
  }

  return res.status(200).json({
    message: 'Notification settings retrieved successfully',
    data: {
      settings: userData.notificationSettings,
      activeTokens: userData.fcmTokens.filter(token => token.isActive).length,
      tokens: userData.fcmTokens.map(token => ({
        platform: token.platform,
        deviceId: token.deviceId,
        lastUsed: token.lastUsed,
        isActive: token.isActive,
      })),
    },
  });
});

/**
 * Update user's notification settings
 * @route PUT /user/notification/settings
 * @access Private
 */
exports.updateNotificationSettings = catchAsync(async (req, res) => {
  const { user } = req;
  const settings = req.body;

  // Validate the settings structure
  const validFields = [
    'enabled',
    'messageNotifications',
    'callNotifications',
    'groupNotifications',
    'sound',
    'vibration',
  ];

  const updateData = {};
  validFields.forEach(field => {
    if (typeof settings[field] === 'boolean') {
      updateData[`notificationSettings.${field}`] = settings[field];
    }
  });

  if (Object.keys(updateData).length === 0) {
    throw new AppError('No valid settings provided', 400);
  }

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { $set: updateData },
    { new: true, select: 'notificationSettings' }
  );

  if (!updatedUser) {
    throw new AppError('User not found', 404);
  }

  return res.status(200).json({
    message: 'Notification settings updated successfully',
    data: {
      settings: updatedUser.notificationSettings,
    },
  });
});

/**
 * Send test notification to user (for testing purposes)
 * @route POST /user/notification/test
 * @access Private
 */
exports.sendTestNotification = catchAsync(async (req, res) => {
  const { user } = req;
  const { title, body, data } = req.body;

  try {
    const result = await FCMService.sendGeneralNotification(
      user._id,
      title || 'Test Notification',
      body || 'This is a test notification',
      data || {},
      { sound: true, vibration: true }
    );

    return res.status(200).json({
      message: 'Test notification sent',
      data: result,
      debug: {
        userId: user._id,
        fcmStatus: FCMService.getStatus(),
      },
    });
  } catch (error) {
    console.error('NotificationController: Error sending test notification:', error);
    return res.status(500).json({
      message: 'Failed to send test notification',
      error: error.message,
      debug: {
        userId: user._id,
        fcmStatus: FCMService.getStatus(),
      },
    });
  }
});

/**
 * Get FCM service status (for debugging)
 * @route GET /user/notification/status
 * @access Private
 */
exports.getFCMStatus = catchAsync(async (req, res) => {
  const { user } = req;
  const status = FCMService.getStatus();
  
  // Get user's token information
  const userData = await User.findById(user._id).select('fcmTokens notificationSettings');
  
  return res.status(200).json({
    message: 'FCM service status',
    data: {
      ...status,
      user: {
        id: user._id,
        hasTokens: userData?.fcmTokens?.length > 0,
        tokenCount: userData?.fcmTokens?.length || 0,
        activeTokens: userData?.fcmTokens?.filter(token => token.isActive)?.length || 0,
        notificationsEnabled: userData?.notificationSettings?.enabled || false,
      },
    },
  });
});

/**
 * Send notification to specific user (admin function)
 * @route POST /user/notification/send
 * @access Private (admin only)
 */
exports.sendNotificationToUser = catchAsync(async (req, res) => {
  const { recipientUserId, title, body, data, type } = req.body;
  console.log("NotificationController: Send notification request", {
    recipientUserId,
    title,
    body,
    data,
    type,
  });

  // Validate required fields
  SimpleValidator(req.body, {
    recipientUserId: 'required|string',
    title: 'required|string',
    body: 'required|string',
  });

  // Check if recipient user exists
  const recipientUser = await User.findById(recipientUserId).select('fcmTokens notificationSettings firstName lastName');
  if (!recipientUser) {
    throw new AppError('Recipient user not found', 404);
  }

  // Check if user has any FCM tokens
  const activeTokens = recipientUser.fcmTokens?.filter(token => token.isActive) || [];
  if (activeTokens.length === 0) {
    console.warn(`NotificationController: User ${recipientUserId} has no active FCM tokens`);
  }

  // Check notification settings
  if (!recipientUser.notificationSettings?.enabled) {
    console.warn(`NotificationController: User ${recipientUserId} has notifications disabled`);
  }

  let result;
  try {
    switch (type) {
      case 'message':
        result = await FCMService.sendNewMessageNotification(
          recipientUserId,
          { content: body, chatSession: data?.chatSessionId },
          { firstName: 'System', lastName: 'Notification', _id: 'system' }
        );
        break;
      case 'call':
        result = await FCMService.sendIncomingCallNotification(
          recipientUserId,
          { id: data?.callId, type: data?.callType || 'voice' },
          { firstName: 'System', lastName: 'Caller', _id: 'system' }
        );
        break;
      default:
        result = await FCMService.sendGeneralNotification(
          recipientUserId,
          title,
          body,
          data || {},
          { sound: true, vibration: true }
        );
    }

    console.log("NotificationController: Notification send result", result);

    return res.status(200).json({
      message: 'Notification sent successfully',
      data: result,
      debug: {
        recipientUserId,
        recipientName: `${recipientUser.firstName} ${recipientUser.lastName}`,
        activeTokenCount: activeTokens.length,
        notificationsEnabled: recipientUser.notificationSettings?.enabled,
        fcmStatus: FCMService.getStatus(),
      },
    });
  } catch (error) {
    console.error('NotificationController: Error sending notification:', error);
    return res.status(500).json({
      message: 'Failed to send notification',
      error: error.message,
      debug: {
        recipientUserId,
        activeTokenCount: activeTokens.length,
        notificationsEnabled: recipientUser.notificationSettings?.enabled,
        fcmStatus: FCMService.getStatus(),
      },
    });
  }
});

/**
 * Get user's FCM tokens (for debugging)
 * @route GET /user/notification/tokens
 * @access Private
 */
exports.getUserTokens = catchAsync(async (req, res) => {
  const { user } = req;

  const tokens = await FCMService.getUserTokens(user._id);

  return res.status(200).json({
    message: 'User tokens retrieved successfully',
    data: {
      activeTokens: tokens.length,
      tokens: tokens,
    },
  });
});

/**
 * Deactivate FCM token
 * @route POST /user/notification/deactivate-token
 * @access Private
 */
exports.deactivateFCMToken = catchAsync(async (req, res) => {
  const { user } = req;
  const { token } = req.body;

  SimpleValidator(req.body, {
    token: 'required|string',
  });

  const success = await FCMService.deactivateUserToken(user._id, token);

  if (!success) {
    throw new AppError('Failed to deactivate FCM token', 500);
  }

  return res.status(200).json({
    message: 'FCM token deactivated successfully',
    data: {
      userId: user._id,
      deactivated: true,
    },
  });
}); 