/**
 * @fileoverview Firebase Cloud Messaging (FCM) configuration
 *
 * This module configures Firebase Admin SDK for sending push notifications
 * to mobile devices. It handles authentication and provides the messaging
 * instance for sending notifications.
 *
 * @module config/fcm
 * @requires firebase-admin
 */

const admin = require('firebase-admin');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBwMNKPGiv78RK_OAROzaaF-mBe4hL1kdI",
  authDomain: "acent-messenger.firebaseapp.com",
  projectId: "acent-messenger",
  storageBucket: "acent-messenger.firebasestorage.app",
  messagingSenderId: "988277005062",
  appId: "1:988277005062:web:ce9ee77a66195228f7dc87",
  measurementId: "G-DQ05GY4NZ6",
};

let app = null;
let messaging = null;
let initializationError = null;

/**
 * Initialize Firebase Admin SDK
 * @returns {Object|null} Firebase app instance
 */
const initializeFirebase = () => {
  try {
    if (app) {
      return app; // Already initialized
    }

    console.log('FCM: Initializing Firebase Admin SDK...');

    // Check if we have service account credentials
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // Load from environment variable (recommended for production)
      try {
        const serviceAccountFromEnv = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccountFromEnv),
          projectId: firebaseConfig.projectId,
        });
        console.log('FCM: Initialized with service account from environment variable');
      } catch (parseError) {
        console.error('FCM: Error parsing FIREBASE_SERVICE_ACCOUNT:', parseError.message);
        initializationError = parseError;
        return null;
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Load from service account file (alternative method)
      try {
        app = admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId: firebaseConfig.projectId,
        });
        console.log('FCM: Initialized with application default credentials');
      } catch (credError) {
        console.error('FCM: Error with application default credentials:', credError.message);
        initializationError = credError;
        return null;
      }
    } else {
      // Development mode - create a mock implementation
      console.warn('FCM: No service account credentials found.');
      console.warn('FCM: Please set FIREBASE_SERVICE_ACCOUNT environment variable with your service account JSON');
      console.warn('FCM: or set GOOGLE_APPLICATION_CREDENTIALS to point to your service account file');
      console.warn('FCM: Running in mock mode - notifications will be logged instead of sent');
      
      initializationError = new Error('No Firebase credentials configured');
      return null;
    }

    if (app) {
      messaging = admin.messaging();
      console.log('FCM: Firebase Admin SDK initialized successfully');
      initializationError = null;
    }

    return app;
  } catch (error) {
    console.error('FCM: Error initializing Firebase Admin SDK:', error);
    initializationError = error;
    return null;
  }
};

/**
 * Get Firebase Messaging instance
 * @returns {Object|null} Firebase messaging instance
 */
const getMessaging = () => {
  if (!messaging && !initializationError) {
    initializeFirebase();
  }
  return messaging;
};

/**
 * Check if FCM is properly configured
 * @returns {boolean} True if FCM is ready to use
 */
const isFCMReady = () => {
  return !!messaging && !!app && !initializationError;
};

/**
 * Get FCM initialization error if any
 * @returns {Error|null} Initialization error
 */
const getFCMError = () => {
  return initializationError;
};

/**
 * Get FCM status for debugging
 * @returns {Object} FCM status information
 */
const getFCMStatus = () => {
  return {
    isReady: isFCMReady(),
    hasApp: !!app,
    hasMessaging: !!messaging,
    hasError: !!initializationError,
    error: initializationError?.message || null,
    projectId: firebaseConfig.projectId,
    hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
    hasCredentialsFile: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
};

// Initialize on module load
initializeFirebase();

module.exports = {
  initializeFirebase,
  getMessaging,
  isFCMReady,
  getFCMError,
  getFCMStatus,
  firebaseConfig,
};
