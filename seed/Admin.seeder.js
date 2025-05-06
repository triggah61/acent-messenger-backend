const { Seeder } = require("mongoose-data-seed");
const _ = require("underscore");
const User = require("../src/model/User");

class AdminSeeder extends Seeder {
  async shouldRun() {
    return User.countDocuments()
      .exec()
      .then((count) => count === 0);
  }

  async run() {
    return await User.create({
      firstName: "Super ",
      lastName: "Admin",

      email: "admin@momoverse.com",
      password: "12345678",
      roleType: "superAdmin",

      status: "activated",
    });
  }
}

module.exports = AdminSeeder;
