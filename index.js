const formData = require("form-data");
require("dotenv").config();
const Mailgun = require("mailgun.js");
const fetch = require("node-fetch");
const AWS = require("aws-sdk");
const { Storage } = require("@google-cloud/storage");
const bucketName = process.env.GOOGLE_BUCKET_NAME;
const tableName = process.env.TABLE_NAME;
//const gKey = process.env.GCP_KEY;
//const decodedKey = Buffer.from(gKey, "base64").toString("utf-8");
const projectID = process.env.PROJECT_ID;
const mailgunDomain = process.env.MAIL_DOMAIN;
const folderPath = process.env.FOLDER_PATH;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context) => {
  //console.log("tablename: ", tableName);
  const mailgun = new Mailgun(formData);
  const mg = mailgun.client({
    username: "api",
    key: process.env.EMAIL_API,
    domain: mailgunDomain,
  });
  const requestBody = JSON.parse(event.Records[0].Sns.Message);
  const result = requestBody;
  const { User_Email, URL, Attempts } = result;
  const submissionURL = URL;
  //const decodedEmail = Buffer.from(User_Email, "base64").toString("utf-8");
  try {
    //console.log("Hello from Lambda!");
    //console.log(JSON.stringify(event));
    //console.log(result);
    const secretArn = process.env.SECRET_ARN;
    const secretsManager = new AWS.SecretsManager();
    const secretValue = await secretsManager
      .getSecretValue({ SecretId: secretArn })
      .promise();
    const encodedKey = secretValue.SecretString;
    const decodedKey = Buffer.from(encodedKey, "base64").toString("utf-8");
    //console.log("Decoded Key:", decodedKey);
    const storage = new Storage({ credentials: JSON.parse(decodedKey) });
    const bucket = storage.bucket(bucketName);
    const downloadResponse = await fetch(submissionURL);
    if (!downloadResponse.ok) {
      throw new Error(
        `Error fetching the file ${
          downloadResponse.statusText
        } ${await downloadResponse.text()}`
      );
    }
    const fileBuffer = await downloadResponse.buffer();
    const modifiedFolderPath = `${folderPath}${User_Email}`;
    const fileName = `${modifiedFolderPath}_v1.0.0.${Attempts}zip`;
    const file = bucket.file(fileName);
    //console.log("Saving file to bucket");
    await file.save(fileBuffer);
    const now = new Date();
    const uploadTimestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()} UTC`;
    console.log(
      `File uploaded to ${fileName} in bucket ${bucketName} at ${uploadTimestamp}`
    );

    try {
      //console.log("Sending email notification");
      const msg = await mg.messages.create(mailgunDomain, {
        from: `Husky Org <no-reply@${mailgunDomain}>`,
        to: [User_Email],
        subject: "Your Assignment submission confirmation",
        text: `Hello, \n\nYour assignment file ${fileName} has been successfully uploaded at ${uploadTimestamp}. \n\nBest Regards, \nHusky Org`,
        html: `<html><body><h1>Assignment Submission Confirmation</h1><p>Hello,</p><p>Your assignment file <strong>${fileName}</strong> has been successfully uploaded at <strong>${uploadTimestamp}</strong>.</p><p>Best Regards,<br>Husky Org</p><p>If you wish to unsubscribe from these notifications, please click <a href="link">here</a>.</p><p>Husky Org<br>Washington St., Jamaica Plain, MA 02130</p></body></html>`,
      });
      console.log("Email sent: ", msg);
      await logEmailSending(User_Email, URL, "Success");
    } catch (mailgunError) {
      console.error("Mailgun error: ", mailgunError);
      await logEmailSending(User_Email, URL, "Error");
    }
  } catch (error) {
    console.error("Lambda function error: ", error);
    try {
      await mg.messages.create(mailgunDomain, {
        from: `Husky Org <no-reply@${mailgunDomain}>`,
        to: [User_Email],
        subject: "Invalid Assignment Submission URL",
        text: `Hello, \n\nThe URL provided for your assignment submission is not valid. Please check the URL and submit again. \n\nBest Regards, \nHusky Org`,
        html: `<html><body><h1>Invalid Assignment Submission URL</h1><p>Hello,</p><p>The URL (${submissionURL}) provided for your assignment submission is not valid. Please check the URL and try again.</p><p>Best Regards,<br>Husky Org</p><p>If you wish to unsubscribe from these notifications, please click <a href="link">here</a>.</p><p>Husky Org<br>Washington St., Jamaica Plain, MA 02130</p></body></html>`,
      });
      console.log("Email sent about invalid URL.");
      await logEmailSending(User_Email, URL, "Error");
    } catch (mailgunError) {
      console.error("Mailgun error: ", mailgunError);
      await logEmailSending(User_Email, URL, "Error");
    }
  }
};

async function logEmailSending(recipientEmail, fileName, status) {
  const params = {
    TableName: tableName,
    Item: {
      ID: generateUniqueId(),
      recipientEmail: recipientEmail,
      filePath: fileName,
      status: status,
      timestamp: new Date().toISOString(),
    },
  };

  try {
    await dynamoDb.put(params).promise();
    console.log("Email log saved");
  } catch (dbError) {
    console.error("Error saving email log to DynamoDB:", dbError);
  }
}

function generateUniqueId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
