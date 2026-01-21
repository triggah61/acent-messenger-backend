const mongoose = require("mongoose"),
  bcrypt = require("bcryptjs");
const { Schema } = mongoose;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const UserCacheService = require("../services/UserCacheService");

const schema = new Schema(
  {
    firstName: {
      type: String,
      default: null,
    },
    lastName: {
      type: String,
      default: null,
    },
    username: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: null,
    },
    dialCode: {
      type: String,
      default: null,
    },
    phone: {
      type: String,
      default: null,
    },
    photo: {
      type: String,
      default: null,
    },
    password: {
      type: String,
      default: null,
    },

    gender: {
      type: String,
      default: null,
    },
    dob: {
      type: Date,
      default: null,
    },
    language: {
      type: String,
      default: 'en', // Default to English
    },
    socketId: {
      type: String,
      default: null,
    },

    // FCM (Firebase Cloud Messaging) tokens for push notifications
    fcmTokens: [
      {
        token: {
          type: String,
          required: true,
        },
        platform: {
          type: String,
          enum: ["android", "ios", "web"],
          required: true,
        },
        deviceId: {
          type: String,
          default: null,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        lastUsed: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Notification preferences
    notificationSettings: {
      enabled: {
        type: Boolean,
        default: true,
      },
      messageNotifications: {
        type: Boolean,
        default: true,
      },
      callNotifications: {
        type: Boolean,
        default: true,
      },
      groupNotifications: {
        type: Boolean,
        default: true,
      },
      sound: {
        type: Boolean,
        default: true,
      },
      vibration: {
        type: Boolean,
        default: true,
      },
    },
    contacts: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    status: {
      type: String,
      enum: ["pending", "activated", "blocked", "deleted"],
      default: "pending",
    },
    // Credit balance fields
    topUpCreditBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    monthlySubscriptionCreditBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Subscription fields
    subscriptionPlan: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      default: null,
    },
    subscriptionStatus: {
      type: String,
      enum: ["none", "active", "expired", "cancelled"],
      default: "none",
    },
    subscriptionExpiresAt: {
      type: Date,
      default: null,
    },
    role: {
      type: String,
      enum: ["admin", "user", "superAdmin"],
      default: "user",
    },
    // Facebook Attribution Data
    facebookAttribution: {
      fbclid: {
        type: String,
        default: null,
      },
      fbc: {  // Facebook Click cookie
        type: String,
        default: null,
      },
      fbp: {  // Facebook Browser cookie
        type: String,
        default: null,
      },
      utmSource: {
        type: String,
        default: null,
      },
      utmMedium: {
        type: String,
        default: null,
      },
      utmCampaign: {
        type: String,
        default: null,
      },
      attributionCapturedAt: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);
schema.plugin(aggregatePaginate);

schema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Cache user data after save
schema.post("save", async function (doc) {
  try {
    // Prepare user data for caching (exclude password)
    const userData = {
      _id: doc._id,
      firstName: doc.firstName,
      lastName: doc.lastName,
      username: doc.username,
      email: doc.email,
      phone: doc.phone,
      dialCode: doc.dialCode,
      photo: doc.photo,
      status: doc.status,
      gender: doc.gender,
      dob: doc.dob,
      language: doc.language,
      updatedAt: doc.updatedAt
    };
    
    await UserCacheService.cacheUser(doc._id.toString(), userData);
  } catch (error) {
    console.error('Error caching user after save:', error);
  }
});

// Invalidate cache when user is updated via findOneAndUpdate, updateOne, etc.
schema.post("findOneAndUpdate", async function (doc) {
  try {
    if (doc) {
      await UserCacheService.deleteCachedUser(doc._id.toString());
    }
  } catch (error) {
    console.error('Error invalidating user cache after update:', error);
  }
});

// Invalidate cache when user is deleted
schema.post("findOneAndDelete", async function (doc) {
  try {
    if (doc) {
      await UserCacheService.deleteCachedUser(doc._id.toString());
    }
  } catch (error) {
    console.error('Error invalidating user cache after delete:', error);
  }
});

// password check
schema.methods.correctPassword = async function (
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

module.exports = mongoose.model("User", schema);
