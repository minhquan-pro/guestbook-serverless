# Implementation Plan: Guestbook Serverless Backend

## Overview

Triển khai hệ thống guestbook serverless trên AWS bao gồm: SAM template định nghĩa hạ tầng, 4 Lambda functions (SubmitForm, GetSubmissions, StreamProcessor, Sender), SES email template, và frontend Next.js. Mỗi task xây dựng tăng dần trên các task trước đó, kết thúc bằng việc kết nối toàn bộ hệ thống.

## Tasks

- [x] 1. Thiết lập cấu trúc dự án và SAM template
  - [x] 1.1 Tạo cấu trúc thư mục backend và khởi tạo package.json
    - Tạo thư mục `backend/src/submitForm/`, `backend/src/getSubmissions/`, `backend/src/streamProcessor/`, `backend/src/sender/`, `backend/src/templates/`, `backend/tests/unit/`, `backend/tests/property/`, `backend/tests/integration/`, `backend/events/`
    - Tạo `backend/package.json` với dependencies: `@aws-sdk/client-dynamodb`, `@aws-sdk/client-sqs`, `@aws-sdk/client-ses`, `@aws-sdk/client-sns`, `@aws-sdk/client-ssm`, `uuid`
    - Thêm devDependencies: `vitest`, `fast-check`, `@aws-sdk/client-dynamodb` (mock)
    - Cấu hình `"type": "module"` cho ESM
    - _Requirements: 7.4_

  - [x] 1.2 Tạo SAM template với toàn bộ resources
    - Tạo `backend/template.yaml` định nghĩa: API Gateway (REST, 2 endpoints: POST /submit, GET /submissions), 4 Lambda functions (Node.js 24.x, ESM .mjs), DynamoDB table (PAY_PER_REQUEST, Stream NEW_IMAGE), SQS NotificationQueue (VisibilityTimeout 180s, redrive policy maxReceiveCount 3), DLQ (retention 14 ngày), SNS Admin Topic, SES Template resource, CloudWatch Alarm (DLQ messages > 0)
    - Cấu hình IAM role riêng cho mỗi Lambda với least-privilege permissions
    - Reference SSM Parameter Store cho admin email, SES domain, SES template name (không hardcode)
    - Cấu hình event source mappings: DynamoDB Stream → StreamProcessor, SQS → Sender
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 1.3 Tạo sample event payloads cho local testing
    - Tạo `backend/events/submit.json` (API Gateway POST event với body hợp lệ)
    - Tạo `backend/events/getSubmissions.json` (API Gateway GET event)
    - Tạo `backend/events/dynamodb-stream.json` (DynamoDB Stream INSERT event)
    - Tạo `backend/events/sqs-notification.json` (SQS event với message body)
    - _Requirements: 7.1_

- [x] 2. Triển khai SubmitForm Lambda
  - [x] 2.1 Implement logic validate input và ghi DynamoDB cho SubmitForm Lambda
    - Tạo `backend/src/submitForm/index.mjs` với handler function
    - Parse request body từ API Gateway event
    - Validate: name (required, không chỉ whitespace, ≤100 ký tự), email (required, không chỉ whitespace, format local@domain.tld, ≤254 ký tự), note (optional, ≤500 ký tự)
    - Ưu tiên kiểm tra name/email trước khi áp dụng logic note rỗng
    - Generate UUID v4 cho submissionId
    - PutItem vào DynamoDB với status "RECEIVED", submittedAt ISO 8601
    - Trả về response 200 `{submissionId}`, 400 `{message}` cho validation errors, 500 `{message}` cho DynamoDB failures
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x]* 2.2 Viết property tests cho SubmitForm Lambda (Properties 1-4)
    - **Property 1: Valid Submission Round-Trip**
    - **Property 2: Missing/Whitespace Required Fields Rejected**
    - **Property 3: Invalid Email Format Rejected**
    - **Property 4: Field Length Validation**
    - Sử dụng fast-check với minimum 100 iterations
    - Mock DynamoDB client, verify gọi PutItem đúng params
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7**

  - [x]* 2.3 Viết unit tests cho SubmitForm Lambda
    - Test case: DynamoDB PutItem thất bại → response 500 với message chung
    - Test case: Request body invalid JSON → response 400
    - Test case: name chỉ whitespace → response 400
    - Test case: email invalid format → response 400
    - Test case: vượt quá độ dài cho phép → response 400 chỉ ra trường nào
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.6, 1.7**

- [x] 3. Triển khai GetSubmissions Lambda
  - [x] 3.1 Implement logic đọc danh sách submissions từ DynamoDB
    - Tạo `backend/src/getSubmissions/index.mjs` với handler function
    - Scan toàn bộ Entries_Table
    - Sort kết quả theo submittedAt giảm dần (mới nhất đầu)
    - Map mỗi item chỉ trả về: submissionId, name, note, status, submittedAt
    - Trả về response 200 `{submissions: [...]}` hoặc mảng rỗng nếu không có data
    - Trả về 500 với message chung nếu DynamoDB Scan thất bại
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x]* 3.2 Viết unit tests cho GetSubmissions Lambda
    - Test case: Scan trả về danh sách → response 200 với submissions sorted
    - Test case: Table rỗng → response 200 với mảng rỗng
    - Test case: DynamoDB Scan thất bại → response 500
    - **Validates: Requirements 8.1, 8.3, 8.4**

- [x] 4. Checkpoint - Kiểm tra luồng đồng bộ
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Triển khai StreamProcessor Lambda
  - [x] 5.1 Implement logic xử lý DynamoDB Stream events và đẩy message vào SQS
    - Tạo `backend/src/streamProcessor/index.mjs` với handler function
    - Iterate qua records trong batch từ DynamoDB Stream event
    - Filter: chỉ xử lý records có `eventName === "INSERT"`, bỏ qua MODIFY/REMOVE
    - Trích xuất NewImage: submissionId, name, email, note, submittedAt
    - SendMessage tới SQS NotificationQueue với JSON body chứa 5 trường
    - Nếu SendMessage thất bại: log chi tiết (error message, submissionId, timestamp) và throw error
    - _Requirements: 2.1, 2.2, 2.3_

  - [x]* 5.2 Viết property tests cho StreamProcessor Lambda (Properties 5-6)
    - **Property 5: DynamoDB Stream INSERT Event Transformation**
    - **Property 6: Non-INSERT Events Filtered**
    - Sử dụng fast-check với minimum 100 iterations
    - Mock SQS client, verify SendMessage params hoặc không gọi SendMessage
    - **Validates: Requirements 2.1, 2.3**

  - [x]* 5.3 Viết unit tests cho StreamProcessor Lambda
    - Test case: SQS SendMessage thất bại → throw error với log chi tiết
    - Test case: Batch chứa mix INSERT/MODIFY/REMOVE → chỉ xử lý INSERT
    - Test case: Invalid record format → log warning, skip, tiếp tục xử lý
    - **Validates: Requirements 2.2, 2.3**

- [x] 6. Triển khai Sender Lambda
  - [x] 6.1 Implement logic đọc SSM config, idempotency check, gửi email và thông báo
    - Tạo `backend/src/sender/index.mjs` với handler function
    - Đọc config từ SSM Parameter Store: admin email, SES domain, SES template name
    - Validate SSM parameters: không rỗng, admin email đúng format, domain đúng format
    - Parse SQS message body: submissionId, name, email, note, submittedAt
    - Idempotency check: GetItem từ DynamoDB, nếu status === "NOTIFIED" → return (skip)
    - Nếu submissionId không tồn tại trong DynamoDB → throw error
    - Gửi email qua SES SendTemplatedEmail API với template data (name, email, submittedAt)
    - Publish thông báo tới Admin SNS Topic (tên guest, email, submittedAt)
    - UpdateItem status → "NOTIFIED" trong DynamoDB
    - Nếu bất kỳ bước nào thất bại → throw error để SQS retry
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 6.3, 6.5, 6.6_

  - [x]* 6.2 Viết property tests cho Sender Lambda (Properties 7-9)
    - **Property 7: Successful Notification Pipeline**
    - **Property 8: Idempotency — Skip Already Notified**
    - **Property 9: Invalid SSM Configuration Rejected**
    - Sử dụng fast-check với minimum 100 iterations
    - Mock SES, SNS, DynamoDB, SSM clients
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 6.5, 6.6**

  - [x]* 6.3 Viết unit tests cho Sender Lambda
    - Test case: SES SendTemplatedEmail thất bại → throw error
    - Test case: SNS Publish thất bại sau SES thành công → throw error
    - Test case: submissionId không tồn tại → throw error
    - Test case: SSM parameter thiếu → throw error với tên parameter
    - Test case: SSM parameter rỗng/format sai → throw error
    - **Validates: Requirements 3.5, 3.6, 3.7, 6.5, 6.6**

- [x] 7. Checkpoint - Kiểm tra toàn bộ backend Lambdas
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Tạo SES Email Template HTML
  - [x] 8.1 Tạo file HTML template cho email xác nhận
    - Tạo `backend/src/templates/confirmation-email.html`
    - Sử dụng inline CSS (không external stylesheet), đảm bảo tương thích email clients
    - Dark theme: nền tổng thể #0B0B12, nền card #151035, teal accent #32EFB9, violet accent #8B5CF6
    - Responsive layout
    - Sử dụng placeholder variables: `{{name}}`, `{{email}}`, `{{submittedAt}}`
    - Nội dung: xác nhận đăng ký sự kiện thành công, hiển thị thông tin guest
    - _Requirements: 7.7_

- [x] 9. Triển khai Frontend Next.js
  - [x] 9.1 Khởi tạo project Next.js và cấu hình design system
    - Tạo Next.js project trong `frontend/` với `package.json`, `next.config.js`
    - Cấu hình CSS variables cho color tokens: `--bg-base` (#0B0B12), `--bg-card` (#151035), `--accent-primary` (#32EFB9), `--accent-secondary` (#8B5CF6), `--text-primary` (#FFFFFF), `--text-secondary` (#8B87B3)
    - Import fonts: Space Grotesk (heading), Inter (body), JetBrains Mono (mono)
    - Thiết lập global styles với dark-mode theme
    - _Requirements: 9.5_

  - [x] 9.2 Implement layout 2 cột và form đăng ký
    - Tạo trang chính với layout: bên trái là form (name, email, note), bên phải là danh sách
    - Header "Guestbook" với Space Grotesk font và teal accent
    - Form inputs: nền #0B0B12, border #8B87B3, focus border teal
    - Nút Submit là primary CTA duy nhất màu teal (#32EFB9, text #0B0B12)
    - Violet chỉ dùng cho badge/tag, không dùng làm nền nút
    - _Requirements: 9.1, 9.5, 9.6_

  - [x] 9.3 Implement danh sách submissions và API integration
    - Gọi GET /submissions khi trang load để hiển thị danh sách hiện có
    - Hiển thị các cột: Tên, Note, Status (trên nền card #151035, status badge dùng violet)
    - Khi submit form thành công (POST /submit): optimistic update thêm entry mới đầu danh sách với status "RECEIVED"
    - Không gọi lại GET sau khi POST thành công
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 10. Checkpoint cuối - Đảm bảo toàn bộ hệ thống hoạt động
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Các task đánh dấu `*` là optional và có thể bỏ qua để MVP nhanh hơn
- Mỗi task reference requirements cụ thể để traceability
- Checkpoints đảm bảo kiểm tra tăng dần
- Property tests kiểm chứng thuộc tính phổ quát (dùng fast-check)
- Unit tests kiểm chứng ví dụ cụ thể và edge cases
- Code comments viết tiếng Anh, tài liệu viết tiếng Việt theo conventions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "8.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["9.3"] }
  ]
}
```
