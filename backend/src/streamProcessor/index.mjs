import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

// Initialize SQS client
const sqsClient = new SQSClient({});
const NOTIFICATION_QUEUE_URL = process.env.NOTIFICATION_QUEUE_URL;

/**
 * Extract plain string value from a DynamoDB typed attribute.
 * Expects format { S: "value" }. Returns undefined if format is unexpected.
 */
function extractStringAttribute(attr) {
  if (attr && typeof attr === "object" && typeof attr.S === "string") {
    return attr.S;
  }
  return undefined;
}

/**
 * Lambda handler for DynamoDB Stream events.
 * Filters INSERT events, extracts submission data, and sends to SQS NotificationQueue.
 */
export async function handler(event) {
  const records = event.Records || [];

  for (const record of records) {
    // Filter: only process INSERT events, skip MODIFY/REMOVE
    if (record.eventName !== "INSERT") {
      continue;
    }

    const newImage = record.dynamodb?.NewImage;

    // Guard against unexpected record format
    if (!newImage) {
      console.warn(
        "Skipping record with missing NewImage:",
        JSON.stringify(record)
      );
      continue;
    }

    // Extract required fields from NewImage
    const submissionId = extractStringAttribute(newImage.submissionId);
    const name = extractStringAttribute(newImage.name);
    const email = extractStringAttribute(newImage.email);
    const note = extractStringAttribute(newImage.note);
    const submittedAt = extractStringAttribute(newImage.submittedAt);

    // Validate all required fields are present and properly formatted
    if (!submissionId || !name || !email || submittedAt === undefined) {
      console.warn(
        "Skipping record with unexpected NewImage format. Missing required fields.",
        JSON.stringify({ submissionId, name, email, note, submittedAt })
      );
      continue;
    }

    // Build SQS message body with all 5 fields as plain strings
    const messageBody = JSON.stringify({
      submissionId,
      name,
      email,
      note: note ?? "",
      submittedAt,
    });

    const sendParams = {
      QueueUrl: NOTIFICATION_QUEUE_URL,
      MessageBody: messageBody,
    };

    try {
      await sqsClient.send(new SendMessageCommand(sendParams));
    } catch (error) {
      // Log detailed error information for debugging
      console.error("SQS SendMessage failed:", {
        errorMessage: error.message,
        submissionId,
        timestamp: new Date().toISOString(),
      });
      // Throw to let DynamoDB Stream retry the entire batch
      throw error;
    }
  }
}
