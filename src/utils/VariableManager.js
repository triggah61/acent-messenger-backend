const fs = require("fs");
const path = require("path");

// Path to the config.json file
const configFilePath = path.resolve(__dirname, "../../.variables.json");

// Helper function to create config.json if it doesn't exist
function ensureConfigFileExists() {
  if (!fs.existsSync(configFilePath)) {
    console.log("Config file does not exist. Creating config.json...");

    // Initialize with an empty object or default values
    const defaultConfig = {};
    fs.writeFileSync(
      configFilePath,
      JSON.stringify(defaultConfig, null, 2),
      "utf-8"
    );
  }
}

// Function to read configuration values from the JSON file
function getConfigValue(key) {
  ensureConfigFileExists(); // Ensure the file exists before reading
  try {
    const config = JSON.parse(fs.readFileSync(configFilePath, "utf-8"));
    return config[key];
  } catch (error) {
    console.error("Error reading config file:", error);
    return null;
  }
}

// Function to write or update configuration values in the JSON file
function setConfigValue(key, value) {
  ensureConfigFileExists(); // Ensure the file exists before writing
  try {
    const config = JSON.parse(fs.readFileSync(configFilePath, "utf-8"));
    config[key] = value;
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), "utf-8");
    // console.log(`Config key ${key} set to ${value}`);
    return true;
  } catch (error) {
    console.error("Error writing to config file:", error);
    return false;
  }
}

module.exports = { getConfigValue, setConfigValue };
