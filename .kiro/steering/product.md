# Product Overview

**Guestbook Serverless** là ứng dụng đăng ký sự kiện (event registration) serverless trên AWS.

## Mục đích

- Cung cấp form đăng ký sự kiện cho người dùng (guest)
- Gửi email xác nhận cho người đăng ký qua Amazon SES
- Gửi thông báo cho admin qua Amazon SNS khi có đăng ký mới

## Luồng xử lý chính

1. Client submit form → API Gateway → Lambda ghi vào DynamoDB → response thành công ngay cho client
2. DynamoDB Stream → Lambda → SQS NotificationQueue (async)
3. SQS trigger Sender Lambda → gửi email xác nhận (SES) + thông báo admin (SNS)

## Nguyên tắc thiết kế

- API response đồng bộ chỉ với bước ghi DynamoDB
- Toàn bộ notification pipeline chạy bất đồng bộ, độc lập sau khi API đã trả response
- Frontend hiển thị thành công ngay khi nhận response từ API, không chờ mail gửi xong
