class AppError extends Error {
  constructor(message, statusCode, errors) {
    super(message);
    console.log(message);

    let status = "unknown_error";
    if (statusCode == 422) status = "validation_error";
    else if (statusCode == 404) {
      status = "not_found";
    } else if (statusCode == 409) {
      status = "invalid_otp";
    } else if (statusCode == 400) {
      status = "otp_required";
    } else if (statusCode == 401) {
      status = "unauthenticated";
    } else if (statusCode == 403) {
      status = "unauthorized";
    } else if (statusCode == 500) {
      status = "internal_server_error";
    }
    this.statusCode = statusCode;
    this.status = status;
    this.errors = errors ? errors : null;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
module.exports = AppError;
