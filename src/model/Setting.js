const mongoose = require("mongoose");
const { Schema } = mongoose; // Destructure Schema from mongoose for brevity

// Define the schema for the Setting model
const settingSchema = new Schema(
  {
    // The 'field' property must be unique
    name: {
      type: String,
      unique: true,
      required: true, // Ensure 'field' is always provided
    },
    // The 'value' property can hold any data type
    value: {
      type: Schema.Types.Mixed, // Allows any data type (string, number, object, etc.)
      default: null, // Default to null if not provided
    },
  },
  {
    timestamps: true, // Automatically adds 'createdAt' and 'updatedAt' fields
  }
);

// Export the Setting model
module.exports = mongoose.model("Setting", settingSchema);
