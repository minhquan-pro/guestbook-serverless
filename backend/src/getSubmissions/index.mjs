// GetSubmissions Lambda - Returns all submissions from DynamoDB
// Validates: Requirements 8.1, 8.2, 8.3, 8.4

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;

// CORS headers applied to all responses
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

/**
 * Unmarshal a DynamoDB item (with type descriptors) to a plain object.
 * Only handles String (S) type since all fields in the schema are strings.
 */
function unmarshalItem(item) {
  const result = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.S !== undefined) {
      result[key] = value.S;
    } else if (value.N !== undefined) {
      result[key] = Number(value.N);
    } else if (value.BOOL !== undefined) {
      result[key] = value.BOOL;
    } else if (value.NULL) {
      result[key] = null;
    }
  }
  return result;
}

/**
 * Lambda handler for GET /submissions
 * Scans the entire Entries_Table and returns submissions sorted by submittedAt descending.
 */
export const handler = async (event) => {
  try {
    const command = new ScanCommand({
      TableName: TABLE_NAME,
    });

    const response = await client.send(command);
    const items = response.Items || [];

    // Unmarshal DynamoDB items to plain objects
    const unmarshalled = items.map(unmarshalItem);

    // Sort by submittedAt descending (newest first)
    unmarshalled.sort((a, b) => {
      const dateA = a.submittedAt || '';
      const dateB = b.submittedAt || '';
      return dateB.localeCompare(dateA);
    });

    // Map to response shape — exclude email for privacy in list view
    const submissions = unmarshalled.map((item) => ({
      submissionId: item.submissionId,
      name: item.name,
      note: item.note,
      status: item.status,
      submittedAt: item.submittedAt,
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ submissions }),
    };
  } catch (error) {
    console.error('Failed to scan submissions:', error);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'Đã xảy ra lỗi, vui lòng thử lại sau' }),
    };
  }
};
