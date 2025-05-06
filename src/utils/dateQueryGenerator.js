const moment = require("moment");
module.exports = (from, to, field1 = "createdAt", field2 = null) => {
  let start = moment.utc(new Date(from)).startOf("day").toDate();
  let end = moment.utc(new Date(to)).endOf("day").toDate();
  let query = [];

  if (from) {
    query.push({
      ...(from && { [field1]: { $gte: start } }),
    });
  }
  if (to) {
    query.push({
      ...(to && field2 && { [field2]: { $lte: end } }),
      ...(to && !field2 && { [field1]: { $lte: end } }),
    });
  }
  if (query.length) {
    return {
      $and: query,
    };
  }
  return {};
};
