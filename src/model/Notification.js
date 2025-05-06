/**
 * Mongoose schema for a notification.
 *
 * @property {mongoose.Schema.Types.ObjectId} user - The ID of the user who received the notification.
 * @property {mongoose.Schema.Types.ObjectId} workspace - The ID of the workspace the notification is related to.
 * @property {mongoose.Schema.Types.ObjectId} [notifiableId] - The ID of the object the notification is about (e.g. a task, a message).
 * @property {string} message - The message content of the notification.
 * @property {string} [type="common"] - The type of the notification (e.g. "info", "warning", "error").
 * @property {boolean} [read=false] - Whether the notification has been read by the user.
 * @property {Date} createdAt - The timestamp when the notification was created.
 * @property {Date} updatedAt - The timestamp when the notification was last updated.
 */
const mongoose = require("mongoose");
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // workspace: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "Workspace",
    //   required: true,
    // },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    title: { type: String, required: true },
    description: { type: String, default: null },
    type: {
      type: String,
      enum: [
        "event_rescheduled",
        "tagged_in_calendar",
        "new_event",
        "password_change",
        "2fa_activation",
        "2fa_deactivation",
        // Add more types as needed
      ],
      default: "common",
    }, // e.g., "info", "warning", "error"
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.plugin(aggregatePaginate);
module.exports = mongoose.model("Notification", notificationSchema);
