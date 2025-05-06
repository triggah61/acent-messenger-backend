const mongoose = require("mongoose");

var aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "A category must have a name"],
      unique: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
  }
);

categorySchema.plugin(aggregatePaginate);
const Category = mongoose.model("Category", categorySchema);
module.exports = Category;
