const mongoose = require("mongoose");

var aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const productSchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    name: {
      type: String,
      required: [true, "A product must have a name"],
      trim: true,
    },
    series: {
      type: String,
      default: null,
    },
    photo: {
      type: String,
      default: null,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "expired"],
      default: "active",
    },
    code: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

productSchema.plugin(aggregatePaginate);

const Product = mongoose.model("Product", productSchema);
module.exports = Product;
