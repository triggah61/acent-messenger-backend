/**
 * @fileoverview Pusher Service
 * 
 * This module provides a service for sending real-time notifications
 * using the Pusher platform. It allows the application to trigger
 * events on specific channels, enabling real-time updates for clients.
 * 
 * @module PusherService
 * @requires pusher
 */

const Pusher = require("pusher");

/**
 * Sends a notification through Pusher
 * 
 * This function initializes a Pusher client using environment variables
 * and triggers an event on a specified channel with the provided data.
 *
 * @async
 * @function pushNotification
 * @param {string} channel - The channel to send the notification on
 * @param {string} event - The event name for the notification
 * @param {Object} data - The data to be sent with the notification
 * @returns {Promise<boolean>} Returns true if the notification was sent successfully
 * 
 * @example
 * await pushNotification('user_123', 'new_message', { message: 'Hello!' });
 * 
 * @throws {Error} If there's an issue initializing Pusher or sending the notification
 */
exports.pushNotification = async (channel, event, data) => {
  const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
  });

  pusher.trigger(channel, event, data);
  return true;
};
