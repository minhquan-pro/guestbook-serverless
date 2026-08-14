// Unit tests for StreamProcessor Lambda handler
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock SQS client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: mockSend })),
  SendMessageCommand: vi.fn((input) => ({ input })),
}));

// Set NOTIFICATION_QUEUE_URL env before importing handler
const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/guestbook-sqs-notification';
process.env.NOTIFICATION_QUEUE_URL = QUEUE_URL;

const { handler } = await import('../../src/streamProcessor/index.mjs');

/** Build a DynamoDB Stream record with typed NewImage attributes */
function makeRecord(eventName, newImage) {
  return {
    eventName,
    dynamodb: newImage === undefined ? {} : { NewImage: newImage },
  };
}

/** Build a valid NewImage with all 5 fields */
function makeNewImage(overrides = {}) {
  return {
    submissionId: { S: 'id-001' },
    name: { S: 'Nguyễn Văn A' },
    email: { S: 'a@example.com' },
    note: { S: 'Đến sớm 30 phút' },
    submittedAt: { S: '2024-01-15T10:30:00.000Z' },
    ...overrides,
  };
}

describe('StreamProcessor Lambda', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ MessageId: 'msg-1' });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should send message with correct QueueUrl and all 5 fields for a valid INSERT event', async () => {
    const event = { Records: [makeRecord('INSERT', makeNewImage())] };

    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentParams = mockSend.mock.calls[0][0].input;
    expect(sentParams.QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(sentParams.MessageBody)).toEqual({
      submissionId: 'id-001',
      name: 'Nguyễn Văn A',
      email: 'a@example.com',
      note: 'Đến sớm 30 phút',
      submittedAt: '2024-01-15T10:30:00.000Z',
    });
  });

  it('should throw error and log details when SQS SendMessage fails', async () => {
    mockSend.mockRejectedValue(new Error('SQS unavailable'));
    const event = { Records: [makeRecord('INSERT', makeNewImage())] };

    await expect(handler(event)).rejects.toThrow('SQS unavailable');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, details] = errorSpy.mock.calls[0];
    expect(message).toContain('SQS SendMessage failed');
    expect(details.errorMessage).toBe('SQS unavailable');
    expect(details.submissionId).toBe('id-001');
    expect(typeof details.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(details.timestamp))).toBe(false);
  });

  it('should only send messages for INSERT records in a mixed batch', async () => {
    const event = {
      Records: [
        makeRecord('MODIFY', makeNewImage({ submissionId: { S: 'id-modify' } })),
        makeRecord('INSERT', makeNewImage({ submissionId: { S: 'id-insert' } })),
        makeRecord('REMOVE', makeNewImage({ submissionId: { S: 'id-remove' } })),
      ],
    };

    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
    expect(body.submissionId).toBe('id-insert');
  });

  it('should warn and skip record with missing NewImage, then continue with remaining records', async () => {
    const event = {
      Records: [
        makeRecord('INSERT', undefined),
        makeRecord('INSERT', makeNewImage({ submissionId: { S: 'id-valid' } })),
      ],
    };

    await handler(event);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('NewImage');
    expect(mockSend).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
    expect(body.submissionId).toBe('id-valid');
  });

  it('should warn and skip record missing required fields', async () => {
    const newImage = makeNewImage();
    delete newImage.submissionId;
    const event = { Records: [makeRecord('INSERT', newImage)] };

    await handler(event);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should do nothing for an empty Records array', async () => {
    await expect(handler({ Records: [] })).resolves.toBeUndefined();

    expect(mockSend).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('should send one message per valid INSERT record', async () => {
    const event = {
      Records: [
        makeRecord('INSERT', makeNewImage({ submissionId: { S: 'id-1' } })),
        makeRecord('INSERT', makeNewImage({ submissionId: { S: 'id-2' } })),
        makeRecord('INSERT', makeNewImage({ submissionId: { S: 'id-3' } })),
      ],
    };

    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(3);
    const ids = mockSend.mock.calls.map(
      (call) => JSON.parse(call[0].input.MessageBody).submissionId
    );
    expect(ids).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('should default note to empty string when absent from NewImage', async () => {
    const newImage = makeNewImage();
    delete newImage.note;
    const event = { Records: [makeRecord('INSERT', newImage)] };

    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockSend.mock.calls[0][0].input.MessageBody);
    expect(body.note).toBe('');
  });
});
