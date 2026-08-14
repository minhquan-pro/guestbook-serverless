// Unit tests for SubmitForm Lambda handler
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DynamoDB client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: mockSend })),
  PutItemCommand: vi.fn((input) => ({ input })),
}));

// Mock uuid so submissionId is predictable
const FIXED_UUID = '11111111-2222-4333-8444-555555555555';
vi.mock('uuid', () => ({
  v4: vi.fn(() => FIXED_UUID),
}));

// Set TABLE_NAME env before importing handler
process.env.TABLE_NAME = 'test-entries-table';

const { handler } = await import('../../src/submitForm/index.mjs');

/** Build an API Gateway style POST event from a raw body string. */
function rawEvent(body) {
  return { body };
}

/** Build an API Gateway style POST event from an object payload. */
function jsonEvent(payload) {
  return { body: JSON.stringify(payload) };
}

describe('SubmitForm Lambda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should return 500 with generic message when DynamoDB PutItem fails', async () => {
    mockSend.mockRejectedValue(new Error('ProvisionedThroughputExceededException: table xyz'));

    const result = await handler(jsonEvent({ name: 'Nguyễn Văn A', email: 'a@example.com' }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe('Đã xảy ra lỗi, vui lòng thử lại sau');
    // Internal details must not leak
    expect(body).not.toHaveProperty('error');
    expect(result.body).not.toContain('ProvisionedThroughputExceededException');
  });

  it('should return 400 when request body is invalid JSON', async () => {
    const result = await handler(rawEvent('{name: "broken"'));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toBe('Request body không hợp lệ');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should return 400 when name is whitespace-only', async () => {
    const result = await handler(jsonEvent({ name: '   ', email: 'a@example.com' }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain('Name');
    expect(body.message).toContain('bắt buộc');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should return 400 when name is missing', async () => {
    const result = await handler(jsonEvent({ email: 'a@example.com', note: 'hi' }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain('Name');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should return 400 when email is missing', async () => {
    const result = await handler(jsonEvent({ name: 'Nguyễn Văn A' }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain('Email');
    expect(body.message).toContain('bắt buộc');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each(['notanemail', 'user@nodot', 'user @example.com', '@example.com'])(
    'should return 400 for invalid email format: %s',
    async (email) => {
      const result = await handler(jsonEvent({ name: 'Test User', email }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.message).toBe('Định dạng email không hợp lệ');
      expect(mockSend).not.toHaveBeenCalled();
    }
  );

  it('should return 400 indicating name field when name exceeds 100 chars', async () => {
    const result = await handler(
      jsonEvent({ name: 'a'.repeat(101), email: 'a@example.com' })
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain('Name');
    expect(body.message).toContain('100');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should return 400 indicating email field when email exceeds 254 chars', async () => {
    // Valid format but longer than 254 characters
    const longEmail = `${'a'.repeat(250)}@example.com`;
    expect(longEmail.length).toBeGreaterThan(254);

    const result = await handler(jsonEvent({ name: 'Test User', email: longEmail }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain('Email');
    expect(body.message).toContain('254');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should return 400 indicating note field when note exceeds 500 chars', async () => {
    const result = await handler(
      jsonEvent({ name: 'Test User', email: 'a@example.com', note: 'x'.repeat(501) })
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain('Note');
    expect(body.message).toContain('500');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should return 200 with submissionId and call PutItem with correct params', async () => {
    const result = await handler(
      jsonEvent({ name: '  Nguyễn Văn A  ', email: ' a@example.com ', note: ' Hẹn gặp lại ' })
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.submissionId).toBe(FIXED_UUID);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putParams = mockSend.mock.calls[0][0].input;

    expect(putParams.TableName).toBe('test-entries-table');
    expect(putParams.Item.submissionId).toEqual({ S: FIXED_UUID });
    expect(putParams.Item.name).toEqual({ S: 'Nguyễn Văn A' });
    expect(putParams.Item.email).toEqual({ S: 'a@example.com' });
    expect(putParams.Item.note).toEqual({ S: 'Hẹn gặp lại' });
    expect(putParams.Item.status).toEqual({ S: 'RECEIVED' });
    // submittedAt must be a valid ISO 8601 timestamp
    expect(putParams.Item.submittedAt.S).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it.each([
    ['absent note', { name: 'Test User', email: 'a@example.com' }],
    ['empty note', { name: 'Test User', email: 'a@example.com', note: '' }],
    ['whitespace note', { name: 'Test User', email: 'a@example.com', note: '   ' }],
  ])('should store note as empty string with %s', async (_label, payload) => {
    const result = await handler(jsonEvent(payload));

    expect(result.statusCode).toBe(200);
    const putParams = mockSend.mock.calls[0][0].input;
    expect(putParams.Item.note).toEqual({ S: '' });
  });

  it('should include CORS headers in successful response', async () => {
    const result = await handler(jsonEvent({ name: 'Test User', email: 'a@example.com' }));

    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(result.headers['Access-Control-Allow-Methods']).toContain('POST');
  });

  it('should include CORS headers in error responses', async () => {
    const validationError = await handler(jsonEvent({ email: 'a@example.com' }));
    expect(validationError.statusCode).toBe(400);
    expect(validationError.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(validationError.headers['Access-Control-Allow-Methods']).toContain('POST');

    mockSend.mockRejectedValue(new Error('fail'));
    const serverError = await handler(jsonEvent({ name: 'Test User', email: 'a@example.com' }));
    expect(serverError.statusCode).toBe(500);
    expect(serverError.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(serverError.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(serverError.headers['Access-Control-Allow-Methods']).toContain('POST');
  });
});
