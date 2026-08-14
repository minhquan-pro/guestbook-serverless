# Technical Conventions

## Architecture Principles

### Synchronous vs Asynchronous

- API Gateway → SubmitForm Lambda → DynamoDB write → response: **đồng bộ (synchronous)**
- DynamoDB Stream → StreamProcessor Lambda → SQS → Sender Lambda → SES/SNS: **bất đồng bộ (asynchronous)**
- Client KHÔNG chờ email gửi xong. Response trả ngay sau khi ghi DynamoDB thành công.

### Luồng chi tiết

1. Client POST → API Gateway
2. SubmitForm Lambda: validate input cơ bản → insert DynamoDB → return success response
3. DynamoDB Stream trigger StreamProcessor Lambda → đẩy message vào SQS NotificationQueue
4. SQS trigger Sender Lambda → đọc message → gửi email xác nhận (SES) + thông báo admin (SNS)

## Security & IAM

- **Mỗi Lambda function có IAM role riêng**, tuân thủ nguyên tắc least-privilege
- IAM policy giữ nguyên cấu trúc, **không tự ý sửa khi không được yêu cầu**
- Ví dụ: SubmitForm Lambda chỉ có quyền `dynamodb:PutItem` trên bảng entries

## SQS & Reliability

- SQS NotificationQueue **bắt buộc có Dead Letter Queue (DLQ)**
- CloudWatch Alarm khi DLQ có message > 0 (phát hiện lỗi gửi notification)
- maxReceiveCount trên main queue nên set 3 lần retry trước khi chuyển DLQ

## Idempotency

- Sender Lambda **phải xử lý idempotency** dựa trên `submissionId`
- Tránh gửi trùng email khi SQS retry (at-least-once delivery)
- Cách tiếp cận: check DynamoDB hoặc conditional write trước khi gửi

## Amazon SES

- Mặc định SES ở **sandbox mode** - chỉ gửi được tới verified email
- Trước khi go-live: request production access
- Domain gửi mail phải verify DKIM/SPF qua Route53

## Configuration Management

- Admin email và domain SES lưu trong **SSM Parameter Store**
- **Không hardcode** giá trị config trong template.yaml hay source code
- Lambda đọc config từ SSM Parameter Store tại runtime hoặc qua environment variables resolved từ SSM

## Code & Documentation Style

- **Comment trong code**: tiếng Anh
- **Tài liệu .md** (README, steering, specs): có thể viết tiếng Việt
- Sử dụng ESM (import/export) cho Lambda functions khi có thể
