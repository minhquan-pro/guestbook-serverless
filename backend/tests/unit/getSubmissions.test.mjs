// Unit tests for GetSubmissions Lambda handler
// **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DynamoDB client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: mockSend })),
  ScanCommand: vi.fn((input) => ({ input })),
}));

// Set TABLE_NAME env before importing handler
process.env.TABLE_NAME = 'test-entries-table';

const { handler } = await import('../../src/getSubmissions/index.mjs');

describe('GetSubmissions Lambda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 200 with empty array when no items exist', async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const result = await handler({});
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.submissions).toEqual([]);
  });

  it('should return 200 with empty array when Items is undefined', async () => {
    mockSend.mockResolvedValue({});

    const result = await handler({});
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.submissions).toEqual([]);
  });

  it('should unmarshal DynamoDB items and return correct fields', async () => {
    mockSend.mockResolvedValue({
      Items: [
        {
          submissionId: { S: 'id-001' },
          name: { S: 'Nguyễn Văn A' },
          email: { S: 'a@example.com' },
          note: { S: 'Hello' },
          status: { S: 'RECEIVED' },
          submittedAt: { S: '2024-01-15T10:00:00.000Z' },
        },
      ],
    });

    const result = await handler({});
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.submissions).toHaveLength(1);
    expect(body.submissions[0]).toEqual({
      submissionId: 'id-001',
      name: 'Nguyễn Văn A',
      note: 'Hello',
      status: 'RECEIVED',
      submittedAt: '2024-01-15T10:00:00.000Z',
    });
  });

  it('should exclude email field from response (privacy)', async () => {
    mockSend.mockResolvedValue({
      Items: [
        {
          submissionId: { S: 'id-001' },
          name: { S: 'Test User' },
          email: { S: 'secret@example.com' },
          note: { S: '' },
          status: { S: 'NOTIFIED' },
          submittedAt: { S: '2024-01-15T10:00:00.000Z' },
        },
      ],
    });

    const result = await handler({});
    const body = JSON.parse(result.body);

    expect(body.submissions[0]).not.toHaveProperty('email');
  });

  it('should sort submissions by submittedAt descending (newest first)', async () => {
    mockSend.mockResolvedValue({
      Items: [
        {
          submissionId: { S: 'id-old' },
          name: { S: 'Old' },
          email: { S: 'old@x.com' },
          note: { S: '' },
          status: { S: 'NOTIFIED' },
          submittedAt: { S: '2024-01-10T08:00:00.000Z' },
        },
        {
          submissionId: { S: 'id-new' },
          name: { S: 'New' },
          email: { S: 'new@x.com' },
          note: { S: 'Latest' },
          status: { S: 'RECEIVED' },
          submittedAt: { S: '2024-01-15T10:00:00.000Z' },
        },
        {
          submissionId: { S: 'id-mid' },
          name: { S: 'Mid' },
          email: { S: 'mid@x.com' },
          note: { S: 'Middle' },
          status: { S: 'RECEIVED' },
          submittedAt: { S: '2024-01-12T12:00:00.000Z' },
        },
      ],
    });

    const result = await handler({});
    const body = JSON.parse(result.body);

    expect(body.submissions[0].submissionId).toBe('id-new');
    expect(body.submissions[1].submissionId).toBe('id-mid');
    expect(body.submissions[2].submissionId).toBe('id-old');
  });

  it('should return 500 with generic error message when DynamoDB scan fails', async () => {
    mockSend.mockRejectedValue(new Error('DynamoDB connection failed'));

    const result = await handler({});
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe('Đã xảy ra lỗi, vui lòng thử lại sau');
    // Should not expose internal error details
    expect(body).not.toHaveProperty('error');
  });

  it('should include CORS headers in successful response', async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const result = await handler({});

    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(result.headers['Access-Control-Allow-Methods']).toContain('GET');
  });

  it('should include CORS headers in error response', async () => {
    mockSend.mockRejectedValue(new Error('fail'));

    const result = await handler({});

    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(result.headers['Access-Control-Allow-Methods']).toContain('GET');
  });
});
