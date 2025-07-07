/**
 * @fileoverview Call model definition
 *
 * This module defines the schema for storing call sessions between users,
 * including call details, participants, and call history.
 *
 * @module models/Call
 * @requires mongoose
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;
var aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const callSchema = new Schema(
  {
    // Call session identifier (Agora channel name)
    channelName: {
      type: String,
      required: true,
      // unique: true,
      index: true,
      default: null,
    },
    
    // Call type: voice or video
    type: {
      type: String,
      enum: ["voice", "video"],
      required: true,
    },
    
    // Call mode: individual or group
    mode: {
      type: String,
      enum: ["individual", "group"],
      default: "individual",
    },
    
    // Call initiator
    initiator: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    
    // Call participants
    participants: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        role: {
          type: String,
          enum: ["caller", "callee"],
          required: true,
        },
        status: {
          type: String,
          enum: ["invited", "ringing", "accepted", "declined", "missed", "ended"],
          default: "invited",
        },
        joinedAt: {
          type: Date,
          default: null,
        },
        leftAt: {
          type: Date,
          default: null,
        },
        duration: {
          type: Number, // Duration in seconds
          default: 0,
        },
      },
    ],
    
    // Call status
    status: {
      type: String,
      enum: ["initiated", "ringing", "active", "ended", "missed", "declined"],
      default: "initiated",
    },
    
    // Call start and end times
    startedAt: {
      type: Date,
      default: null,
    },
    
    endedAt: {
      type: Date,
      default: null,
    },
    
    // Total call duration in seconds
    duration: {
      type: Number,
      default: 0,
    },
    
    // End reason
    endReason: {
      type: String,
      enum: ["normal", "busy", "declined", "missed", "network_error", "timeout"],
      default: null,
    },
    
    // Associated chat session (if called from chat)
    chatSession: {
      type: Schema.Types.ObjectId,
      ref: "ChatSession",
      default: null,
    },
    
    // Call quality metrics
    quality: {
      averageRating: {
        type: Number,
        min: 1,
        max: 5,
        default: null,
      },
      networkQuality: {
        type: String,
        enum: ["excellent", "good", "average", "poor", "very_poor"],
        default: null,
      },
      issues: [{
        type: String,
        enum: ["audio_quality", "video_quality", "network_lag", "call_drop", "echo", "noise"],
      }],
    },
    
    // Recording information (if applicable)
    recording: {
      enabled: {
        type: Boolean,
        default: false,
      },
      url: {
        type: String,
        default: null,
      },
      duration: {
        type: Number,
        default: 0,
      },
    },
    
    // Metadata
    metadata: {
      clientPlatform: {
        type: String,
        // enum: ["android", "ios", "web"],
        default: null,
      },
      appVersion: {
        type: String,
        default: null,
      },
      deviceModel: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
callSchema.index({ initiator: 1, createdAt: -1 });
callSchema.index({ "participants.user": 1, createdAt: -1 });
callSchema.index({ channelName: 1 });
callSchema.index({ status: 1 });
callSchema.index({ createdAt: -1 });

// Virtual for call participant count
callSchema.virtual("participantCount").get(function() {
  return this.participants.length;
});

// Virtual for active participants
callSchema.virtual("activeParticipants").get(function() {
  return this.participants.filter(p => p.status === "accepted" || p.status === "active");
});

// Method to add participant
callSchema.methods.addParticipant = function(userId, role = "callee") {
  const existingParticipant = this.participants.find(p => p.user.toString() === userId.toString());
  
  if (!existingParticipant) {
    this.participants.push({
      user: userId,
      role: role,
      status: "invited",
    });
  }
  
  return this;
};

// Method to update participant status
callSchema.methods.updateParticipantStatus = function(userId, status, joinedAt = null) {
  const participant = this.participants.find(p => p.user.toString() === userId.toString());
  
  if (participant) {
    participant.status = status;
    if (joinedAt) participant.joinedAt = joinedAt;
    if (status === "ended" && participant.joinedAt) {
      participant.leftAt = new Date();
      participant.duration = Math.floor((participant.leftAt - participant.joinedAt) / 1000);
    }
  }
  
  return this;
};

// Method to end call
callSchema.methods.endCall = function(reason = "normal") {
  this.status = "ended";
  this.endedAt = new Date();
  this.endReason = reason;
  
  if (this.startedAt) {
    this.duration = Math.floor((this.endedAt - this.startedAt) / 1000);
  }
  
  // Update all active participants
  this.participants.forEach(participant => {
    if (participant.status === "accepted" || participant.status === "ringing") {
      participant.status = "ended";
      participant.leftAt = this.endedAt;
      if (participant.joinedAt) {
        participant.duration = Math.floor((participant.leftAt - participant.joinedAt) / 1000);
      }
    }
  });
  
  return this;
};

// Method to start call
callSchema.methods.startCall = function() {
  this.status = "active";
  this.startedAt = new Date();
  return this;
};

// Static method to find active calls for user
callSchema.statics.findActiveCallsForUser = function(userId) {
  return this.find({
    $or: [
      { initiator: userId },
      { "participants.user": userId }
    ],
    status: { $in: ["initiated", "ringing", "active"] }
  }).populate("initiator", "firstName lastName photo dialCode phone")
    .populate("participants.user", "firstName lastName photo dialCode phone");
};

// Static method to find call by channel name
callSchema.statics.findByChannelName = function(channelName) {
  return this.findOne({ channelName })
    .populate("initiator", "firstName lastName photo dialCode phone")
    .populate("participants.user", "firstName lastName photo dialCode phone")
    .populate("chatSession");
};

// Pre-save middleware to update timestamps
callSchema.pre("save", function(next) {
  if (this.isModified("status")) {
    if (this.status === "active" && !this.startedAt) {
      this.startedAt = new Date();
    } else if (this.status === "ended" && !this.endedAt) {
      this.endedAt = new Date();
      if (this.startedAt) {
        this.duration = Math.floor((this.endedAt - this.startedAt) / 1000);
      }
    }
  }
  next();
});

callSchema.plugin(aggregatePaginate);

module.exports = mongoose.model("Call", callSchema); 