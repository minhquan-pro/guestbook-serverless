// Property-based tests for SubmitForm Lambda handler (Properties 1-4)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock DynamoDB client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: mockSend })),
  PutItemCommand: vi.fn((input) => ({ input })),
}));

// Set TABLE_NAME env before importing handler
process.env.TABLE_NAME = 'test-entries-table';

const { handler } = await import('../../src/submitForm/index.mjs');

const NUM_RUNS = 100;

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// --- Smart generators constrained to the relevant input space ---

const alnumChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''));

const alnumString = (minLength, maxLength) =>
  fc.array(alnumChar, { minLength, maxLength }).map((chars) => chars.join(''));

// Name: 1-100 chars, not whitespace-only
const validName = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length >= 1 && s.trim().length <= 100);

// Email: local-part@domain.tld, well within 254 chars
const validEmail = fc
  .tuple(alnumString(1, 20), alnumString(1, 20), alnumString(2, 6))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// Note: empty or <= 500 chars
const validNote = fc.oneof(
  fc.constant(''),
  fc.string({ maxLength: 500 }).filter((s) => s.trim().length <= 500)
);

// Whitespace-only strings (including empty string)
const whitespaceOnly = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 0, maxLength: 6 })
  .map((chars) => chars.join(''));

// Strings that are non-blank but do not match local-part@domain.tld
const invalidEmail = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && !EMAIL_REGEX.test(s.trim()));

const buildEvent = (body) => ({ body: JSON.stringify(body) });

const getPutItemInput = () => mockSend.mock.calls[0][0].input;

describe('SubmitForm Lambda - Property Based Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  // Feature: guestbook-backend, Property 1: Valid Submission Round-Trip
  // Validates: Requirements 1.1, 1.5
  it('Feature: guestbook-backend, Property 1: Valid Submission Round-Trip', async () => {
    await fc.assert(
      fc.asyncProperty(validName, validEmail, validNote, async (name, email, note) => {
        mockSend.mockClear();
        mockSend.mockResolvedValue({});

        const result = await handler(buildEvent({ name, email, note }));
        const body = JSON.parse(result.body);

        // Response contract
        expect(result.statusCode).toBe(200);
        expect(body.submissionId).toMatch(UUID_V4_REGEX);

        // DynamoDB record contract
        expect(mockSend).toHaveBeenCalledTimes(1);
        const input = getPutItemInput();
        expect(input.TableName).toBe('test-entries-table');
        expect(input.Item.submissionId.S).toBe(body.submissionId);
        expect(input.Item.name.S).toBe(name.trim());
        expect(input.Item.email.S).toBe(email.trim());
        expect(input.Item.note.S).toBe(note.trim());
        expect(input.Item.status.S).toBe('RECEIVED');
        expect(input.Item.submittedAt.S).toMatch(ISO_8601_REGEX);
        expect(Number.isNaN(Date.parse(input.Item.submittedAt.S))).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: guestbook-backend, Property 2: Missing/Whitespace Required Fields Rejected
  // Validates: Requirements 1.2, 1.3
  it('Feature: guestbook-backend, Property 2: Missing/Whitespace Required Fields Rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('name', 'email'),
        whitespaceOnly,
        validName,
        validEmail,
        validNote,
        async (field, blank, name, email, note) => {
          mockSend.mockClear();
          mockSend.mockResolvedValue({});

          const body = { name, email, note };
          body[field] = blank;

          const result = await handler(buildEvent(body));
          const responseBody = JSON.parse(result.body);

          expect(result.statusCode).toBe(400);
          const expectedField = field === 'name' ? 'Name' : 'Email';
          expect(responseBody.message).toContain(expectedField);
          expect(responseBody.message).toContain('bắt buộc');

          // No DynamoDB record created
          expect(mockSend).not.toHaveBeenCalled();
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: guestbook-backend, Property 3: Invalid Email Format Rejected
  // Validates: Requirements 1.4
  it('Feature: guestbook-backend, Property 3: Invalid Email Format Rejected', async () => {
    await fc.assert(
      fc.asyncProperty(validName, invalidEmail, validNote, async (name, email, note) => {
        mockSend.mockClear();
        mockSend.mockResolvedValue({});

        const result = await handler(buildEvent({ name, email, note }));
        const body = JSON.parse(result.body);

        expect(result.statusCode).toBe(400);
        expect(body.message).toContain('email không hợp lệ');
        expect(mockSend).not.toHaveBeenCalled();
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Feature: guestbook-backend, Property 4: Field Length Validation
  // Validates: Requirements 1.7
  it('Feature: guestbook-backend, Property 4: Field Length Validation', async () => {
    // name > 100 chars
    const tooLongName = fc
      .tuple(alnumString(101, 160), validEmail, validNote)
      .map(([name, email, note]) => ({ body: { name, email, note }, expectedField: 'Name' }));

    // email > 254 chars but still valid format
    const tooLongEmail = fc
      .tuple(validName, alnumString(250, 300), alnumString(1, 10), validNote)
      .map(([name, local, domain, note]) => ({
        body: { name, email: `${local}@${domain}.com`, note },
        expectedField: 'Email',
      }));

    // note > 500 chars
    const tooLongNote = fc
      .tuple(validName, validEmail, alnumString(501, 600))
      .map(([name, email, note]) => ({ body: { name, email, note }, expectedField: 'Note' }));

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(tooLongName, tooLongEmail, tooLongNote),
        async ({ body, expectedField }) => {
          mockSend.mockClear();
          mockSend.mockResolvedValue({});

          const result = await handler(buildEvent(body));
          const responseBody = JSON.parse(result.body);

          expect(result.statusCode).toBe(400);
          expect(responseBody.message).toContain(expectedField);
          expect(responseBody.message).toContain('vượt quá');
          expect(mockSend).not.toHaveBeenCalled();
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
