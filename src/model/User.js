const mongoose = require("mongoose"),
  bcrypt = require("bcryptjs");
const { Schema } = mongoose;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");
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
    socketId: {
      type: String,
      default: null,
    },

    contacts: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        date: {
          type: Date,
          default: Date.now(),
        },
        status: {
          type: String,
          enum: ["sent", "received", "active", "rejected", "blocked"],
          default: "sent",
        },
      },
    ],
    status: {
      type: String,
      enum: ["pending", "activated", "blocked", "deleted"],
      default: "pending",
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
// password check
schema.methods.correctPassword = async function (
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

module.exports = mongoose.model("User", schema);
