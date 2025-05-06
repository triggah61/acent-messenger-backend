const pug = require("pug");
require("dotenv").config();
const fs = require("fs");
const nodemailer = require("nodemailer");
const AppError = require("../exception/AppError");
class Email {
  mailDirectory = null;
  mailSubject = "Confirmation";
  mailData = {};
  constructor(to) {
    if (!to) {
      throw new AppError(422, "Destination email is required");
    }
    this.to = to;
  }
  file(file) {
    if (!file) {
      throw new AppError(422, "File name is required");
    }
    let directory = `${__dirname}/../view/email/${file}.pug`;
    if (!fs.existsSync(directory)) {
      throw new AppError(422, "Invalid file path provided");
    }
    this.mailDirectory = directory;
    return this;
  }
  subject(subject) {
    this.subjectTitle = subject;
    return this;
  }
  data(data) {
    this.mailData = data;
    return this;
  }

  send() {
    const client = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_PORT == 465 ? true : false, // upgrade later with STARTTLS
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASS,
      },
    });
    // console.log(client);
    let to = this.to;
    let data = this.mailData;
    let template = pug.renderFile(this.mailDirectory, data);

    var mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to,
      subject: this.subjectTitle,
      html: template,
    };
    client.sendMail(mailOptions, function (error) {
      if (error) {
        console.log(error.message);
        //   throw new AppError('Unable to send email', 500);
      } else {
        console.log("Email sent to: " + to);
      }
    });
    return this;
  }
}

module.exports = Email;
