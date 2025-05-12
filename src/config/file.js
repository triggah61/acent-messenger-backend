const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const {
  AWS_S3_BUCKET,
  AWS_S3_ACCESS_KEY_ID,
  AWS_S3_SECRET_ACCESS_KEY,
  AWS_S3_REGION,
} = process.env;

// Configure AWS SDK
AWS.config.update({
  accessKeyId: AWS_S3_ACCESS_KEY_ID,
  secretAccessKey: AWS_S3_SECRET_ACCESS_KEY,
  region: AWS_S3_REGION,
});

const s3 = new AWS.S3();

exports.upload = async (file, uploadPath, name = uuidv4()) => {
  // Check the file size
  let size = (file?.size ?? 1) / 1000; // size in KB
  if (size > 10000) {
    throw new AppError("File size exceeded!", 422);
  }
  // Extract the file extension
  let extension = file.mimetype.split("/")[1];
  if (extension.includes("svg")) {
    extension = ".svg";
  }

  // Generate the file name
  let fileName = process.env?.AWS_S3_PARENT_FOLDER
    ? `${process.env?.AWS_S3_PARENT_FOLDER}/${uploadPath}/${name}.${extension}`
    : `${uploadPath}/${name}.${extension}`;

  // Set up S3 upload parameters
  const params = {
    Bucket: AWS_S3_BUCKET,
    Key: fileName,
    Body: file.buffer,
    ACL: "public-read", // This makes the file publicly readable
    ContentType: file.type, // Set the content type to the file's MIME type
  };

  // Upload the file to S3
  return await s3.upload(params).promise();
};
exports.uploadFromBase64 = async (
  base64String,
  uploadPath,
  filename = uuidv4()
) => {
  const headerInfo = base64String.substring(0, base64String.indexOf(";")); // Extract header data
  const fileExtension = headerInfo.substring(headerInfo.indexOf("/") + 1); // Extract file extension
  let byteString = base64String.replace("data:", "").replace(/^.+,/, "");
  const fileContent = Buffer.from(byteString, "base64");

  // Generate the file filename
  let fileName = process.env?.AWS_S3_PARENT_FOLDER
    ? `${process.env?.AWS_S3_PARENT_FOLDER}/${uploadPath}/${filename}.${fileExtension}`
    : `${uploadPath}/${filename}.${fileExtension}`;
  const params = {
    Bucket: AWS_S3_BUCKET,
    Key: fileName,
    Body: fileContent,
    ACL: "public-read",
  };
  return await s3.upload(params).promise();
};

// Function to delete a file from S3 by file path
exports.deleteFileByPath = async (filePath) => {
  const params = {
    Bucket: AWS_S3_BUCKET,
    Key: filePath,
  };

  try {
    await s3.deleteObject(params).promise();
    console.log(`File deleted successfully from S3: ${filePath}`);
    return true
  } catch (error) {
    console.error(`Error deleting file from S3: ${error.message}`);
    return false
  }
};

exports.s3 = s3;
