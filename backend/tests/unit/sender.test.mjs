// Unit tests for Sender Lambda handler
// Validates: Requirements 3.5, 3.6, 3.7, 6.5, 6.6
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- AWS SDK mocks ---
const mockDynamoSend = vi.fn();
const mockSesSend = vi.fn();
const mockSnsSend = vi.fn();
const mockSsmSend = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: mockDynamoSend })),
  GetItemCommand: vi.fn((input) => ({ __type: 'GetItem', input })),
  UpdateItemCommand: vi.fn((input) => ({ __type: 'UpdateItem', input })),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn(() => ({ send: mockSesSend })),
  SendTemplatedEmailCommand: vi.fn((input) => ({ __type: 'SendTemplatedEmail', input })),
}));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: mockSnsSend })),
  PublishCommand: vi.fn((input) => ({ __type: 'Publish', input })),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({ send: mockSsmSend })),
  GetParameterCommand: vi.fn((input) => ({ __type: 'GetParameter', input })),
}));

// --- Env vars must be set before importing the handler ---
const TABLE_NAME = 'guestbook-dynamodb-entries';
const ADMIN_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:guestbook-sns-admin';
const SSM_ADMIN_EMAIL = '/guestbook/admin-email';
const SSM_SES_DOMAIN = '/guestbook/ses-domain';
const SSM_SES_TEMPLATE_NAME = '/guestbook/ses-template-name';

process.env.TABLE_NAME = TABLE_NAME;
process.env.ADMIN_TOPIC_ARN = ADMIN_TOPIC_ARN;
process.env.SSM_ADMIN_EMAIL = SSM_ADMIN_EMAIL;
process.env.SSM_SES_DOMAIN = SSM_SES_DOMAIN;
process.env.SSM_SES_TEMPLATE_NAME = SSM_SES_TEMPLATE_NAME;

const { handler } = await import('../../src/sender/index.mjs');

// --- Helpers ---
const SUBMISSION = {
  submissionId: 'id-001',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  note: 'Đến sớm 30 phút',
  submittedAt: '2024-01-15T10:30:00.000Z',
};

function makeEvent(overrides = {}) {
  return {
    Records: [{ body: JSON.stringify({ ...SUBMISSION, ...overrides }) }],
  };
}

/** Route SSM GetParameter by Name so ordering doesn't matter */
function setSSMConfig({
  adminEmail = 'admin@example.com',
  sesDomain = 'example.com',
  templateName = 'guestbook-confirmation',
} = {}) {
  const values = {
    [SSM_ADMIN_EMAIL]: adminEmail,
    [SSM_SES_DOMAIN]: sesDomain,
    [SSM_SES_TEMPLATE_NAME]: templateName,
  };
  mockSsmSend.mockImplementation((command) => {
    const name = command.input.Name;
    if (!(name in values)) {
      return Promise.reject(new Error(`ParameterNotFound: ${name}`));
    }
    return Promise.resolve({ Parameter: { Value: values[name] } });
  });
}

/** Route DynamoDB commands: GetItem returns given item, UpdateItem resolves */
function setDynamoItem(item) {
  mockDynamoSend.mockImplementation((command) => {
    if (command.__type === 'GetItem') {
      return Promise.resolve(item === null ? {} : { Item: item });
    }
    return Promise.resolve({});
  });
}

function makeItem(status = 'RECEIVED') {
  return {
    submissionId: { S: SUBMISSION.submissionId },
    name: { S: SUBMISSION.name },
    email: { S: SUBMISSION.email },
    status: { S: status },
    submittedAt: { S: SUBMISSION.submittedAt },
  };
}

function dynamoCallsOfType(type) {
  return mockDynamoSend.mock.calls.filter((call) => call[0].__type === type);
}

describe('Sender Lambda', () => {
  let logSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    setSSMConfig();
    setDynamoItem(makeItem('RECEIVED'));
    mockSesSend.mockResolvedValue({ MessageId: 'ses-1' });
    mockSnsSend.mockResolvedValue({ MessageId: 'sns-1' });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('should send email, publish to SNS, and mark status NOTIFIED on the happy path', async () => {
    await handler(makeEvent());

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const sesInput = mockSesSend.mock.calls[0][0].input;
    expect(sesInput.Source).toBe('noreply@example.com');
    expect(sesInput.Template).toBe('guestbook-confirmation');
    expect(sesInput.Destination).toEqual({ ToAddresses: [SUBMISSION.email] });
    expect(JSON.parse(sesInput.TemplateData)).toEqual({
      name: SUBMISSION.name,
      email: SUBMISSION.email,
      submittedAt: SUBMISSION.submittedAt,
    });

    expect(mockSnsSend).toHaveBeenCalledTimes(1);
    const snsInput = mockSnsSend.mock.calls[0][0].input;
    expect(snsInput.TopicArn).toBe(ADMIN_TOPIC_ARN);
    expect(snsInput.Subject).toContain(SUBMISSION.name);
    expect(snsInput.Message).toContain(SUBMISSION.name);
    expect(snsInput.Message).toContain(SUBMISSION.email);
    expect(snsInput.Message).toContain(SUBMISSION.submittedAt);
    expect(snsInput.Message).toContain(SUBMISSION.submissionId);

    const updateCalls = dynamoCallsOfType('UpdateItem');
    expect(updateCalls).toHaveLength(1);
    const updateInput = updateCalls[0][0].input;
    expect(updateInput.TableName).toBe(TABLE_NAME);
    expect(updateInput.Key).toEqual({ submissionId: { S: SUBMISSION.submissionId } });
    expect(updateInput.ExpressionAttributeValues[':notified']).toEqual({ S: 'NOTIFIED' });
  });

  it('should skip SES, SNS, and UpdateItem when status is already NOTIFIED', async () => {
    setDynamoItem(makeItem('NOTIFIED'));

    await expect(handler(makeEvent())).resolves.toBeUndefined();

    expect(mockSesSend).not.toHaveBeenCalled();
    expect(mockSnsSend).not.toHaveBeenCalled();
    expect(dynamoCallsOfType('UpdateItem')).toHaveLength(0);
  });

  it('should throw when submissionId is not found in DynamoDB', async () => {
    setDynamoItem(null);

    await expect(handler(makeEvent())).rejects.toThrow(/not found/i);

    expect(mockSesSend).not.toHaveBeenCalled();
    expect(mockSnsSend).not.toHaveBeenCalled();
  });

  it('should throw when SES SendTemplatedEmail fails', async () => {
    mockSesSend.mockRejectedValue(new Error('SES throttled'));

    await expect(handler(makeEvent())).rejects.toThrow('SES throttled');

    expect(mockSnsSend).not.toHaveBeenCalled();
    expect(dynamoCallsOfType('UpdateItem')).toHaveLength(0);
  });

  it('should throw when SNS Publish fails after SES succeeded', async () => {
    mockSnsSend.mockRejectedValue(new Error('SNS unavailable'));

    await expect(handler(makeEvent())).rejects.toThrow('SNS unavailable');

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(dynamoCallsOfType('UpdateItem')).toHaveLength(0);
  });

  it('should throw when DynamoDB UpdateItem fails after SES and SNS succeeded', async () => {
    mockDynamoSend.mockImplementation((command) => {
      if (command.__type === 'GetItem') {
        return Promise.resolve({ Item: makeItem('RECEIVED') });
      }
      return Promise.reject(new Error('UpdateItem failed'));
    });

    await expect(handler(makeEvent())).rejects.toThrow('UpdateItem failed');

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });

  it('should throw with the parameter name when an SSM parameter is inaccessible', async () => {
    mockSsmSend.mockRejectedValue(new Error('AccessDeniedException'));

    await expect(handler(makeEvent())).rejects.toThrow(/admin-email/);

    expect(mockDynamoSend).not.toHaveBeenCalled();
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('should throw indicating empty when an SSM parameter is an empty string', async () => {
    setSSMConfig({ sesDomain: '' });

    await expect(handler(makeEvent())).rejects.toThrow(/ses-domain.*empty/i);

    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('should throw when admin email from SSM has invalid format', async () => {
    setSSMConfig({ adminEmail: 'not-an-email' });

    await expect(handler(makeEvent())).rejects.toThrow(/invalid email format/i);

    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('should throw when ses-domain from SSM has no dot', async () => {
    setSSMConfig({ sesDomain: 'localhost' });

    await expect(handler(makeEvent())).rejects.toThrow(/invalid domain format/i);

    expect(mockSesSend).not.toHaveBeenCalled();
  });
});
