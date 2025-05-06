const mongoose = require("mongoose");

var aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const multiPlayerSchema = new mongoose.Schema(
  {
    players: {
      type: Array,
      default: [],
    },
    placedFurniture: {
      type: Array,
      default: [],
    },
    ownLand: {
      type: Array,
      default: [],
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
  }
);

multiPlayerSchema.plugin(aggregatePaginate);
const Multiplayer = mongoose.model("Multiplayer", multiPlayerSchema);
module.exports = Multiplayer;
