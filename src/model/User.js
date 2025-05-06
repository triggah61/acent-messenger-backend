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
    balance: {
      type: Number,
      default: 0,
    },
    email: {
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

    verificationOTP: {
      type: String,
      default: null,
    },
    verificationOTPExpires: {
      type: Date,
      default: null,
    },
    googleAuthenticator: {
      type: String,
      enum: ["unset", "on", "off"],
      default: "unset",
    },

    googleAuthSeed: {
      type: String,
      default: null,
    },
    roleType: {
      type: String,
      enum: ["superAdmin", `admin`, "user"],
      default: "user",
    },

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
