require("dotenv").config();
const process = require("process");
const app = require("./app");

const logger = require("./src/config/logger");
const { initSocketServer } = require("./src/config/socket");
const port = process.env.PORT || 6000;

let server = app.listen(port, "0.0.0.0", () => {
  logger.info(` ${process.env.APP_NAME} Server is on 🔥 on port ${port}`);
});

initSocketServer(server);
