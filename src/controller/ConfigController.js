const catchAsync = require("../exception/catchAsync");
/**
 * Require the Setting model from the '../model/Setting' module.
 * This model is used to interact with the database for setting configuration data.
 */
const Setting = require("../model/Setting");
const SimpleValidator = require("../validator/simpleValidator");

exports.getConfig = catchAsync(async (req, res) => {
  let data = {};


  let globalSettings = await Setting.find({}).select("name value -_id").lean();

  for (const setting of globalSettings) {
    data[setting.name] = setting.value;
  }

  res.json({
    message: "Config fetched successfully",
    data,
  });
});

exports.setConfig = catchAsync(async (req, res) => {
  // Extract the records from the request body, default to an empty array if not provided
  const { records = [] } = req.body;

  // Validate that 'records' is provided and is an array
  SimpleValidator(req.body, { records: "required|array" });

  // Filter out records that do not have both 'variable' and 'value'
  const validRecords = records.filter((record) => record.name && record.value);

  // Update or insert each valid record in the database
  await Promise.all(
    validRecords.map(async ({ name, value }) => {
      await Setting.findOneAndUpdate(
        { name: name }, // Match the record by 'name'
        { name: name, value }, // Update 'name' and 'value'
        { upsert: true } // Insert a new record if no match is found
      );
    })
  );

  // Send a success response
  res.json({
    status: "success",
    message: "Setting value updated successfully!",
  });
});
