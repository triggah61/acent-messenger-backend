const mongoose = require("mongoose");
const AdminSeeder = require("./seed/Admin.seeder");

require("dotenv").config();
const mongoURL = process.env.MONGODB_URL;

/**
 * Seeders List
 * order is important
 * @type {Object}
 */
exports.seedersList = {
  AdminSeeder,
};
/**
 * Connect to mongodb implementation
 * @return {Promise}
 */
exports.connect = async () => {
  await mongoose.connect(mongoURL, {});
};
/**
 * Drop/Clear the database implementation
 * @return {Promise}
 */
exports.dropdb = async () => mongoose.connection.db.dropDatabase();
