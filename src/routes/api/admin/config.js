const {
  getConfig,
  setConfig,
} = require("../../../controller/ConfigController");

const configRouter = require("express").Router();
require("express-group-routes");
configRouter.group("/config", (config) => {
  config.get("/get", getConfig);
  config.post("/update", setConfig);
});

module.exports = configRouter;
