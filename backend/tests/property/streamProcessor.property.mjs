// Property-based tests for StreamProcessor Lambda handler
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock SQS client
const mockSend = vi.fn();
const mockSendMessageCommand = vi.fn((input) => ({ input }));
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: mockSend })),
  SendMessageCommand: mockSendMessageCommand,
}));

// Set queue URL env before importing handler
process.env.NOTIFICATION_QUEUE_URL =
  'https://sqs.us-east-1.amazonaws.com/123456789012/guestbook-sqs-notification';

const { handler } = await import('../../src/streamProcessor/index.mjs');

// Non-empty strings for fields the handler treats as required
const nonEmptyString = fc.string({ minLength: 1, maxLength: 50 });

// NewImage payload generator: 5 fields required by the SQS message contract
const submissionArb = fc.record({
  submissionId: nonEmptyString,
  name: nonEmptyString,
  email: nonEmptyString,
  note: fc.string({ maxLength: 100 }),
  submittedAt: nonEmptyString,
});

function toStreamRecord(eventName, submission) {
  return {
    eventName,
    dynamodb: {
      NewImage: {
        submissionId: { S: submission.submissionId },
        name: { S: submission.name },
        email: { S: submission.email },
        note: { S: submission.note },
        submittedAt: { S: submission.submittedAt },
      },
    },
  };
}

// **Validates: Requirements 2.1**
describe('Feature: guestbook-backend, Property 5: DynamoDB Stream INSERT Event Transformation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ MessageId: 'msg-1' });
  });

  it('sends an SQS message containing exactly the 5 NewImage fields with matching values', async () => {
    await fc.assert(
      fc.asyncProperty(submissionArb, async (submission) => {
        vi.clearAllMocks();
        mockSend.mockResolvedValue({ MessageId: 'msg-1' });

        await handler({ Records: [toStreamRecord('INSERT', submission)] });

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSendMessageCommand).toHaveBeenCalledTimes(1);

        const params = mockSendMessageCommand.mock.calls[0][0];
        expect(params.QueueUrl).toBe(process.env.NOTIFICATION_QUEUE_URL);

        const body = JSON.parse(params.MessageBody);
        expect(Object.keys(body).sort()).toEqual([
          'email',
          'name',
          'note',
          'submissionId',
          'submittedAt',
        ]);
        expect(body).toEqual(submission);
      }),
      { numRuns: 100 }
    );
  });
});

// **Validates: Requirements 2.3**
describe('Feature: guestbook-backend, Property 6: Non-INSERT Events Filtered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ MessageId: 'msg-1' });
  });

  it('sends no SQS message for MODIFY or REMOVE events', async () => {
    const nonInsertRecords = fc.array(
      fc.tuple(fc.constantFrom('MODIFY', 'REMOVE'), submissionArb),
      { minLength: 1, maxLength: 10 }
    );

    await fc.assert(
      fc.asyncProperty(nonInsertRecords, async (pairs) => {
        vi.clearAllMocks();
        mockSend.mockResolvedValue({ MessageId: 'msg-1' });

        const records = pairs.map(([eventName, submission]) =>
          toStreamRecord(eventName, submission)
        );

        await handler({ Records: records });

        expect(mockSend).not.toHaveBeenCalled();
        expect(mockSendMessageCommand).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});
