import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;

// CORS headers included in all responses
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

// Simple email regex: local-part@domain with at least one dot in domain
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Build a standard HTTP response with CORS headers.
 */
function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

/**
 * Validate the request input fields with priority order:
 * 1. name required / whitespace / length
 * 2. email required / whitespace / format / length
 * 3. note length
 *
 * Returns { valid: true, data } or { valid: false, message }
 */
function validateInput(body) {
  // --- Name validation ---
  if (body.name === undefined || body.name === null || body.name === "") {
    return { valid: false, message: "Name là bắt buộc" };
  }

  const trimmedName = String(body.name).trim();

  if (trimmedName.length === 0) {
    return { valid: false, message: "Name là bắt buộc" };
  }

  if (trimmedName.length > 100) {
    return { valid: false, message: "Name vượt quá 100 ký tự cho phép" };
  }

  // --- Email validation ---
  if (body.email === undefined || body.email === null || body.email === "") {
    return { valid: false, message: "Email là bắt buộc" };
  }

  const trimmedEmail = String(body.email).trim();

  if (trimmedEmail.length === 0) {
    return { valid: false, message: "Email là bắt buộc" };
  }

  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return { valid: false, message: "Định dạng email không hợp lệ" };
  }

  if (trimmedEmail.length > 254) {
    return { valid: false, message: "Email vượt quá 254 ký tự cho phép" };
  }

  // --- Note validation ---
  const rawNote = body.note !== undefined && body.note !== null ? String(body.note) : "";
  const trimmedNote = rawNote.trim();

  if (trimmedNote.length > 500) {
    return { valid: false, message: "Note vượt quá 500 ký tự cho phép" };
  }

  return {
    valid: true,
    data: {
      name: trimmedName,
      email: trimmedEmail,
      note: trimmedNote,
    },
  };
}

/**
 * Lambda handler for POST /submit
 * Validates input, generates submissionId, writes to DynamoDB.
 */
export async function handler(event) {
  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return buildResponse(400, { message: "Request body không hợp lệ" });
  }

  // Validate input
  const validation = validateInput(body);
  if (!validation.valid) {
    return buildResponse(400, { message: validation.message });
  }

  const { name, email, note } = validation.data;
  const submissionId = uuidv4();
  const submittedAt = new Date().toISOString();

  // Write to DynamoDB
  const putParams = {
    TableName: TABLE_NAME,
    Item: {
      submissionId: { S: submissionId },
      name: { S: name },
      email: { S: email },
      note: { S: note },
      status: { S: "RECEIVED" },
      submittedAt: { S: submittedAt },
    },
  };

  try {
    await dynamoClient.send(new PutItemCommand(putParams));
  } catch (error) {
    console.error("DynamoDB PutItem failed:", error);
    return buildResponse(500, {
      message: "Đã xảy ra lỗi, vui lòng thử lại sau",
    });
  }

  return buildResponse(200, { submissionId });
}
