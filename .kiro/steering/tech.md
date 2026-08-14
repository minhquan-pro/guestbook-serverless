# Tech Stack

## Frontend

- **Framework**: Next.js
- **Hosting**: AWS Amplify (auto CI/CD khi push lên branch)

## Backend

- **Runtime**: Node.js (AWS Lambda)
- **API**: Amazon API Gateway (REST)
- **Database**: Amazon DynamoDB + DynamoDB Streams
- **Queue**: Amazon SQS (với Dead Letter Queue)
- **Email**: Amazon SES
- **Notification**: Amazon SNS
- **Parameters**: AWS Systems Manager Parameter Store

## Infrastructure & Deployment

- **IaC**: AWS SAM (template.yaml)
- **CI/CD Backend**: GitHub Actions
- **Region**: `us-east-1`

## Common Commands

```bash
# Backend - build & deploy
cd backend/
sam build
sam deploy --guided          # lần đầu
sam deploy                   # các lần sau

# Backend - local development
sam local start-api
sam local invoke SubmitFormFunction --event events/submit.json

# Frontend - development
cd frontend/
npm install
npm run dev

# Frontend - build
npm run build
```

## Lưu ý

- SAM CLI và AWS CLI cần được cấu hình profile với region `us-east-1`
- Frontend deploy tự động qua Amplify khi push code, không cần command thủ công
