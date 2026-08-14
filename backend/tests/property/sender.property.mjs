// Property-based tests for Sender Lambda handler
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// --- Mock DynamoDB client (GetItem + UpdateItem on the same send) ---
const mockDynamoSend = vi.fn();
const mockGetItemCommand = vi.fn((input) => ({ __type: 'GetItem', input }));
const mockUpdateItemCommand = vi.fn((input) => ({ __type: 'UpdateItem', input }));
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: mockDynamoSend })),
  GetItemCommand: mockGetItemCommand,
  UpdateItemCommand: mockUpdateItemCommand,
}));

// --- Mock SES client ---
const mockSesSend = vi.fn();
const mockSendTemplatedEmailCommand = vi.fn((input) => ({ __type: 'SendTemplatedEmail', input }));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn(() => ({ send: mockSesSend })),
  SendTemplatedEmailCommand: mockSendTemplatedEmailCommand,
}));

// --- Mock SNS client ---
const mockSnsSend = vi.fn();
const mockPublishCommand = vi.fn((input) => ({ __type: 'Publish', input }));
vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: mockSnsSend })),
  PublishCommand: mockPublishCommand,
}));

// --- Mock SSM client ---
const mockSsmSend = vi.fn();
const mockGetParameterCommand = vi.fn((input) => ({ __type: 'GetParameter', input }));
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({ send: mockSsmSend })),
  GetParameterCommand: mockGetParameterCommand,
}));

// Env config must be set before importing the handler
process.env.TABLE_NAME = 'guestbook-dynamodb-entries';
process.env.ADMIN_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:guestbook-sns-admin';
process.env.SSM_ADMIN_EMAIL = '/guestbook/admin-email';
process.env.SSM_SES_DOMAIN = '/guestbook/ses-domain';
process.env.SSM_SES_TEMPLATE_NAME = '/guestbook/ses-template-name';

const { handler } = await import('../../src/sender/index.mjs');

const VALID_CONFIG = {
  '/guestbook/admin-email': 'admin@example.com',
  '/guestbook/ses-domain': 'example.com',
  '/guestbook/ses-template-name': 'GuestbookConfirmation',
};

/** Wire the SSM mock to resolve each parameter path from a value map. */
function mockSsmConfig(values) {
  mockSsmSend.mockImplementation(async (command) => ({
    Parameter: { Value: values[command.input.Name] },
  }));
}

/** Wire the DynamoDB mock: GetItem returns a record with the given status. */
function mockDynamoWithStatus(status) {
  mockDynamoSend.mockImplementation(async (command) => {
    if (command.__type === 'GetItem') {
      return { Item: { submissionId: command.input.Key.submissionId, status: { S: status } } };
    }
    return {};
  });
}

const nonEmptyString = fc.string({ minLength: 1, maxLength: 50 });

const submissionArb = fc.record({
  submissionId: nonEmptyString,
  name: nonEmptyString,
  email: nonEmptyString,
  note: fc.string({ maxLength: 100 }),
  submittedAt: nonEmptyString,
});

function toSqsEvent(submission) {
  return { Records: [{ body: JSON.stringify(submission) }] };
}

function resetMocks() {
  vi.clearAllMocks();
  mockSesSend.mockResolvedValue({ MessageId: 'ses-1' });
  mockSnsSend.mockResolvedValue({ MessageId: 'sns-1' });
}

// **Validates: Requirements 3.1, 3.2, 3.3**
describe('Feature: guestbook-backend, Property 7: Successful Notification Pipeline', () => {
  beforeEach(resetMocks);

  it('sends SES templated email, publishes to admin SNS topic, and updates status to NOTIFIED', async () => {
    await fc.assert(
      fc.asyncProperty(submissionArb, async (submission) => {
        resetMocks();
        mockSsmConfig(VALID_CONFIG);
        mockDynamoWithStatus('RECEIVED');

        await handler(toSqsEvent(submission));

        // (a) SES SendTemplatedEmail to the guest email with template data
        expect(mockSendTemplatedEmailCommand).toHaveBeenCalledTimes(1);
        expect(mockSesSend).toHaveBeenCalledTimes(1);
        const sesParams = mockSendTemplatedEmailCommand.mock.calls[0][0];
        expect(sesParams.Source).toBe('noreply@example.com');
        expect(sesParams.Destination.ToAddresses).toEqual([submission.email]);
        expect(sesParams.Template).toBe(VALID_CONFIG['/guestbook/ses-template-name']);
        expect(JSON.parse(sesParams.TemplateData)).toEqual({
          name: submission.name,
          email: submission.email,
          submittedAt: submission.submittedAt,
        });

        // (b) SNS Publish to the Admin Topic containing guest info
        expect(mockPublishCommand).toHaveBeenCalledTimes(1);
        expect(mockSnsSend).toHaveBeenCalledTimes(1);
        const snsParams = mockPublishCommand.mock.calls[0][0];
        expect(snsParams.TopicArn).toBe(process.env.ADMIN_TOPIC_ARN);
        expect(snsParams.Message).toContain(submission.name);
        expect(snsParams.Message).toContain(submission.email);
        expect(snsParams.Message).toContain(submission.submittedAt);

        // (c) DynamoDB UpdateItem sets status to NOTIFIED
        expect(mockUpdateItemCommand).toHaveBeenCalledTimes(1);
        const updateParams = mockUpdateItemCommand.mock.calls[0][0];
        expect(updateParams.TableName).toBe(process.env.TABLE_NAME);
        expect(updateParams.Key).toEqual({ submissionId: { S: submission.submissionId } });
        expect(updateParams.ExpressionAttributeValues[':notified']).toEqual({ S: 'NOTIFIED' });
      }),
      { numRuns: 100 }
    );
  });
});

// **Validates: Requirements 3.4**
describe('Feature: guestbook-backend, Property 8: Idempotency — Skip Already Notified', () => {
  beforeEach(resetMocks);

  it('skips SES, SNS and UpdateItem when the record status is already NOTIFIED', async () => {
    await fc.assert(
      fc.asyncProperty(submissionArb, async (submission) => {
        resetMocks();
        mockSsmConfig(VALID_CONFIG);
        mockDynamoWithStatus('NOTIFIED');

        await handler(toSqsEvent(submission));

        expect(mockSesSend).not.toHaveBeenCalled();
        expect(mockSendTemplatedEmailCommand).not.toHaveBeenCalled();
        expect(mockSnsSend).not.toHaveBeenCalled();
        expect(mockPublishCommand).not.toHaveBeenCalled();
        expect(mockUpdateItemCommand).not.toHaveBeenCalled();
        // Only the idempotency GetItem hit DynamoDB
        expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});

// **Validates: Requirements 6.5, 6.6**
describe('Feature: guestbook-backend, Property 9: Invalid SSM Configuration Rejected', () => {
  beforeEach(resetMocks);

  // Handler validation rules mirrored here to generate invalid values
  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isValidDomain = (v) => /^[^\s]+\.[^\s]+$/.test(v);

  // Empty / whitespace-only parameter value in any of the three parameters
  const emptyValueConfigArb = fc
    .tuple(
      fc.constantFrom(
        '/guestbook/admin-email',
        '/guestbook/ses-domain',
        '/guestbook/ses-template-name'
      ),
      fc.constantFrom('', ' ', '   ', '\t', '\n', ' \t\n ')
    )
    .map(([path, blank]) => ({ ...VALID_CONFIG, [path]: blank }));

  // Admin email that does not match a valid email format (but is not blank)
  const invalidAdminEmailConfigArb = fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => s.trim() !== '' && !isValidEmail(s.trim()))
    .map((email) => ({ ...VALID_CONFIG, '/guestbook/admin-email': email }));

  // Sender domain that does not match a valid domain format (but is not blank)
  const invalidDomainConfigArb = fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => s.trim() !== '' && !isValidDomain(s.trim()))
    .map((domain) => ({ ...VALID_CONFIG, '/guestbook/ses-domain': domain }));

  const invalidConfigArb = fc.oneof(
    emptyValueConfigArb,
    invalidAdminEmailConfigArb,
    invalidDomainConfigArb
  );

  it('throws and never calls SES or SNS when SSM config is empty or malformed', async () => {
    await fc.assert(
      fc.asyncProperty(invalidConfigArb, submissionArb, async (config, submission) => {
        resetMocks();
        mockSsmConfig(config);
        mockDynamoWithStatus('RECEIVED');

        await expect(handler(toSqsEvent(submission))).rejects.toThrow();

        expect(mockSesSend).not.toHaveBeenCalled();
        expect(mockSendTemplatedEmailCommand).not.toHaveBeenCalled();
        expect(mockSnsSend).not.toHaveBeenCalled();
        expect(mockPublishCommand).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});
