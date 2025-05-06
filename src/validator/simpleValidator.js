const Validator = require("Validator");
const { first } = require("underscore");
const AppError = require("../exception/AppError");

function validateMongoId(name, value) {
  let hexadecimal = /^[0-9A-F]+$/i;
  return value && hexadecimal.test(value) && value.length === 24;
}
function greaterThan(name, value, params) {
  // console.log(name, value, params);
  let requirement = params[0];
  return Number(value) > Number(requirement);
}
function maxLength(name, value, params) {
  // console.log(name, value, params);
  let requirement = params[0];
  return Number(value.length) <= Number(requirement);
}

function arrayType(name, value, params) {
  return Array.isArray(value);
}

function SimpleValidator(data, rules) {
  const v = Validator.make(data, rules, {
    in: "The selected :attr is invalid. Supported values are: :values",
  });
  v.extend("mongoid", validateMongoId, ":attr is not a valid object id");
  v.extend("array", arrayType, ":attr is not a valid array");
  v.extend("gt", greaterThan, ":attr should be greater than the current value");
  v.extend(
    "maxlength",
    maxLength,
    ":attr length should be less than the current"
  );
  // console.log(v);

  if (v.fails()) {
    let errors = v.getErrors();
    let firstKey = Object.keys(errors)[0];
    let firstError = first(errors[firstKey]);
    throw new AppError(firstError, 422, errors);
  }
  return true;
}
module.exports = SimpleValidator;
