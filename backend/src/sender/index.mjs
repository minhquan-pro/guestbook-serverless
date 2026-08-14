import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SESClient, SendTemplatedEmailCommand } from "@aws-sdk/client-ses";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const dynamoClient = new DynamoDBClient();
const sesClient = new SESClient();
const snsClient = new SNSClient();
const ssmClient = new SSMClient();

const TABLE_NAME = process.env.TABLE_NAME;
const ADMIN_TOPIC_ARN = process.env.ADMIN_TOPIC_ARN;
const SSM_ADMIN_EMAIL = process.env.SSM_ADMIN_EMAIL;
const SSM_SES_DOMAIN = process.env.SSM_SES_DOMAIN;
const SSM_SES_TEMPLATE_NAME = process.env.SSM_SES_TEMPLATE_NAME;

/**
 * Validate email format: local-part@domain with at least one dot in domain.
 */
function isValidEmail(value) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
}

/**
 * Validate domain format: at least one dot (e.g. example.com).
 */
function isValidDomain(value) {
  const domainRegex = /^[^\s]+\.[^\s]+$/;
  return domainRegex.test(value);
}

/**
 * Read and validate a single SSM parameter.
 * Throws descriptive error if parameter is missing, inaccessible, or invalid.
 */
async function getSSMParameter(parameterPath, parameterName) {
  let value;
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({ Name: parameterPath })
    );
    value = response.Parameter?.Value;
  } catch (error) {
    throw new Error(
      `Failed to retrieve SSM parameter '${parameterName}' at path '${parameterPath}': ${error.message}`
    );
  }

  if (!value || value.trim() === "") {
    throw new Error(
      `SSM parameter '${parameterName}' at path '${parameterPath}' is empty`
    );
  }

  return value.trim();
}

/**
 * Read all SSM config and validate formats.
 */
async function readAndValidateConfig() {
  const adminEmail = await getSSMParameter(SSM_ADMIN_EMAIL, "admin-email");
  const sesDomain = await getSSMParameter(SSM_SES_DOMAIN, "ses-domain");
  const sesTemplateName = await getSSMParameter(SSM_SES_TEMPLATE_NAME, "ses-template-name");

  // Validate admin email format
  if (!isValidEmail(adminEmail)) {
    throw new Error(
      `SSM parameter 'admin-email' has invalid email format: '${adminEmail}'`
    );
  }

  // Validate SES domain format (must contain at least one dot)
  if (!isValidDomain(sesDomain)) {
    throw new Error(
      `SSM parameter 'ses-domain' has invalid domain format: '${sesDomain}'`
    );
  }

  return { adminEmail, sesDomain, sesTemplateName };
}

/**
 * Sender Lambda handler.
 * Triggered by SQS, sends confirmation email (SES) and admin notification (SNS).
 */
export async function handler(event) {
  // Step 1: Read and validate SSM config
  const { adminEmail, sesDomain, sesTemplateName } = await readAndValidateConfig();

  // Step 2: Parse SQS message body
  const record = event.Records[0];
  const { submissionId, name, email, note, submittedAt } = JSON.parse(record.body);

  // Step 3: Idempotency check — GetItem from DynamoDB
  const getItemResponse = await dynamoClient.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { submissionId: { S: submissionId } },
    })
  );

  // If submissionId doesn't exist in DynamoDB, throw error for SQS retry
  if (!getItemResponse.Item) {
    throw new Error(
      `Submission '${submissionId}' not found in DynamoDB. Will retry.`
    );
  }

  // If already notified, skip processing (idempotency)
  if (getItemResponse.Item.status?.S === "NOTIFIED") {
    console.log(`Submission '${submissionId}' already notified. Skipping.`);
    return;
  }

  // Step 4: Send confirmation email via SES
  await sesClient.send(
    new SendTemplatedEmailCommand({
      Source: `noreply@${sesDomain}`,
      Destination: { ToAddresses: [email] },
      Template: sesTemplateName,
      TemplateData: JSON.stringify({ name, email, submittedAt }),
    })
  );

  // Step 5: Publish notification to Admin SNS Topic
  await snsClient.send(
    new PublishCommand({
      TopicArn: ADMIN_TOPIC_ARN,
      Subject: `Đăng ký mới: ${name}`,
      Message: `Có đăng ký mới!\n\nTên: ${name}\nEmail: ${email}\nThời gian: ${submittedAt}\nSubmission ID: ${submissionId}`,
    })
  );

  // Step 6: Update DynamoDB status to "NOTIFIED"
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: { submissionId: { S: submissionId } },
      UpdateExpression: "SET #status = :notified",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":notified": { S: "NOTIFIED" } },
    })
  );

  console.log(`Successfully processed submission '${submissionId}'.`);
}
