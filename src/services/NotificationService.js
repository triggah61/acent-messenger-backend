const Notification = require("../model/Notification");
const SimpleValidator = require("../validator/simpleValidator");
const moment = require("moment");
const { pushNotification } = require("./PusherService");

// Function to create a notification for a user
exports.createNotification = async (user, type, data = {}) => {
  console.log({ user });
  // Validate the input
  await SimpleValidator(
    { user, type, data },
    {
      user: "required",
      type: "required",
    }
  );

  // Generate title and description
  const { title, description } = this.generateTitleAndDescription(type, data);

  // Store the notification
  let notification = await Notification.create({
    user,
    title,
    description,
    type,
    data,
  });
  pushNotification(`notification_${user}`, "new_notification", notification);
  return notification;
};

exports.generateTitleAndDescription = (type, data) => {
  let title = "";
  let description = "";

  switch (type) {
    case "event_rescheduled":
      title = `Event Rescheduled: ${data.eventTitle}`;
      description = `The event "${
        data.eventTitle
      }" has been rescheduled to ${moment(data.newStartDate).toDate()}.`;
      break;

    case "tagged_in_calendar":
      title = `You're Tagged in a Calendar: ${data.title}`;
      description = `You have been tagged in the calendar "${
        data.title
      }" created by ${data.owner.firstName} ${data.owner.lastName}.`;
      break;

    case "new_event":
      title = `New Event: ${data.eventTitle}`;
      description = `A new event "${
        data.eventTitle
      }" has been added, scheduled on ${moment(data.startDate).toDate()}.`;
      break;

    case "new_event":
      title = `New Event in Shared Calendar: ${data.eventTitle}`;
      description = `A new event "${
        data.eventTitle
      }" has been added to a calendar you have access to, scheduled on ${moment(
        data.startDate
      ).toDate()}.`;
      break;

    case "password_change":
      title = `Password Changed`;
      description = `Your account password has been changed successfully. If this wasn't you, please contact support immediately.`;
      break;

    case "2fa_activation":
      title = `Two-Factor Authentication Activated`;
      description = `You have successfully activated two-factor authentication for your account.`;
      break;

    case "2fa_deactivation":
      title = `Two-Factor Authentication Deactivated`;
      description = `You have deactivated two-factor authentication for your account. If this wasn't you, please secure your account immediately.`;
      break;

    // Add more cases for additional notification types
    default:
      title = `Notification`;
      description = `You have a new notification.`;
      break;
  }

  return { title, description };
};
