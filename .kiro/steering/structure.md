# Project Structure

## Monorepo Layout

```
guestbook-serverless/
├── frontend/          # Next.js app (Amplify Hosting)
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── next.config.js
├── backend/           # AWS SAM project
│   ├── template.yaml  # SAM template (API GW, Lambda, DynamoDB, SQS, SNS, SES)
│   ├── src/
│   │   ├── submitForm/        # Lambda: validate + ghi DynamoDB
│   │   ├── streamProcessor/   # Lambda: DynamoDB Stream → SQS
│   │   └── sender/            # Lambda: SQS → SES + SNS
│   └── events/                # Sample event payloads cho local test
├── .github/
│   └── workflows/             # GitHub Actions CI/CD cho backend
└── .kiro/
    └── steering/              # Steering documents
```

## Naming Convention - AWS Resources

Pattern: `guestbook-{service}-{mô tả ngắn}`

| Resource | Tên |
|----------|-----|
| Lambda submit | `guestbook-lambda-submitform` |
| Lambda stream processor | `guestbook-lambda-streamprocessor` |
| Lambda sender | `guestbook-lambda-sender` |
| DynamoDB table | `guestbook-dynamodb-entries` |
| SQS queue | `guestbook-sqs-notification` |
| SQS DLQ | `guestbook-sqs-notification-dlq` |
| SNS topic | `guestbook-sns-admin` |

## Quy ước thư mục

- Mỗi Lambda function nằm trong thư mục riêng dưới `backend/src/`
- Mỗi function có file `index.mjs` (hoặc `index.js`) là entry point
- Shared utilities (nếu có) đặt trong `backend/src/shared/`
