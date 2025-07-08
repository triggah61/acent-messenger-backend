require("dotenv").config();
const process = require("process");

// Fix EventEmitter memory leak warning by increasing max listeners
const EventEmitter = require('events');
EventEmitter.defaultMaxListeners = 20; // Increase from default 10 to 20

// Configure HTTP agent for connection pooling to prevent TLS socket leaks
const http = require('http');
const https = require('https');

// Create HTTP agents with connection pooling
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveMsecs: 30000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveMsecs: 30000
});

// Configure axios globally to use connection pooling
const axios = require('axios');
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 30000; // 30 second timeout

console.log('HTTP connection pooling configured');

const app = require("./app");

const logger = require("./src/config/logger");
const { initPusherServer } = require("./src/config/pusher");
const port = process.env.PORT || 6000;

let server = app.listen(port, "0.0.0.0", () => {
  logger.info(` ${process.env.APP_NAME} Server is on 🔥 on port ${port}`);
});

// Configure server timeouts
server.timeout = 60000; // 60 seconds
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000; // 66 seconds

// Initialize Pusher server (replaces socket.io)
initPusherServer();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});
