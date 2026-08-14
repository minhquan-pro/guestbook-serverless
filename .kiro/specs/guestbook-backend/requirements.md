# Requirements Document

## Introduction

Guestbook Serverless Backend cung cấp API serverless trên AWS để xử lý đăng ký sự kiện. Hệ thống nhận form đăng ký từ client qua API Gateway, lưu vào DynamoDB, và gửi thông báo bất đồng bộ (email xác nhận cho guest qua SES, thông báo admin qua SNS) thông qua pipeline DynamoDB Stream → SQS → Sender Lambda. Luồng đồng bộ chỉ bao gồm bước validate và ghi DynamoDB; toàn bộ notification pipeline chạy async độc lập.

## Glossary

- **SubmitForm_Lambda**: Lambda function (`guestbook-lambda-submitform`) nhận request từ API Gateway, validate input và ghi dữ liệu vào DynamoDB
- **StreamProcessor_Lambda**: Lambda function (`guestbook-lambda-streamprocessor`) được trigger bởi DynamoDB Stream, đẩy message vào SQS NotificationQueue
- **Sender_Lambda**: Lambda function (`guestbook-lambda-sender`) được trigger bởi SQS, gửi email xác nhận qua SES và thông báo admin qua SNS
- **Entries_Table**: DynamoDB table (`guestbook-dynamodb-entries`) lưu trữ các submission với partition key `submissionId`
- **NotificationQueue**: SQS queue (`guestbook-sqs-notification`) nhận message từ StreamProcessor để Sender xử lý
- **DLQ**: Dead Letter Queue (`guestbook-sqs-notification-dlq`) nhận message thất bại sau khi retry hết số lần cho phép
- **Admin_Topic**: SNS topic (`guestbook-sns-admin`) gửi thông báo cho admin khi có đăng ký mới
- **API_Gateway**: Amazon API Gateway (REST) endpoint nhận POST request từ client
- **SSM_Parameter_Store**: AWS Systems Manager Parameter Store lưu trữ cấu hình runtime (admin email, SES domain)
- **GetSubmissions_Lambda**: Lambda function (`guestbook-lambda-getsubmissions`) nhận GET request từ API Gateway, trả về danh sách submissions từ DynamoDB

## Requirements

### Requirement 1: API Gửi Form Đăng Ký

**User Story:** Với vai trò khách tham dự, tôi muốn gửi thông tin đăng ký qua REST API, để việc tham dự của tôi được ghi nhận và tôi nhận được xác nhận.

#### Acceptance Criteria

1. KHI client gửi POST request với dữ liệu hợp lệ (name, email, và note tùy chọn), THÌ SubmitForm_Lambda PHẢI tạo UUID submissionId, insert bản ghi vào Entries_Table với status "RECEIVED" và submittedAt dạng ISO 8601, và trả về response 200 chứa submissionId
2. NẾU client gửi POST request với trường name bị thiếu hoặc chỉ chứa khoảng trắng, THÌ SubmitForm_Lambda PHẢI trả về response lỗi 400 với thông báo name là bắt buộc
3. NẾU client gửi POST request với trường email bị thiếu hoặc chỉ chứa khoảng trắng, THÌ SubmitForm_Lambda PHẢI trả về response lỗi 400 với thông báo email là bắt buộc
4. NẾU client gửi POST request với email không đúng định dạng (local-part@domain với ít nhất một dấu chấm trong domain), THÌ SubmitForm_Lambda PHẢI trả về response lỗi 400 với thông báo định dạng email không hợp lệ
5. KHI client gửi POST request với name và email hợp lệ nhưng note rỗng hoặc không có, THÌ SubmitForm_Lambda PHẢI chấp nhận submission và lưu bản ghi với note là chuỗi rỗng; validation name và email (AC2, AC3, AC4, AC7) PHẢI được ưu tiên kiểm tra trước khi tiêu chí này áp dụng
6. NẾU thao tác ghi DynamoDB thất bại, THÌ SubmitForm_Lambda PHẢI trả về response lỗi 500 với thông báo lỗi chung không tiết lộ chi tiết nội bộ, và KHÔNG ĐƯỢC trả về response 200 trong bất kỳ trường hợp nào khi dữ liệu chưa được lưu thành công
7. NẾU name vượt quá 100 ký tự, email vượt quá 254 ký tự, hoặc note vượt quá 500 ký tự, THÌ SubmitForm_Lambda PHẢI trả về response lỗi 400 với thông báo trường nào vượt quá độ dài cho phép

### Requirement 2: Xử Lý DynamoDB Stream

**User Story:** Với vai trò hệ thống, tôi muốn các submission mới được tự động chuyển tiếp tới notification queue, để pipeline thông báo xử lý bất đồng bộ.

#### Acceptance Criteria

1. KHI một INSERT event mới xuất hiện trên DynamoDB Stream của Entries_Table, THÌ StreamProcessor_Lambda PHẢI trích xuất dữ liệu submission và gửi message vào NotificationQueue chứa submissionId, name, email, note, và submittedAt
2. NẾU StreamProcessor_Lambda gửi message vào NotificationQueue thất bại, THÌ StreamProcessor_Lambda PHẢI ghi log chi tiết lỗi (error message, submissionId, timestamp) và throw error để DynamoDB Stream retry lại batch
3. StreamProcessor_Lambda CHỈ xử lý INSERT events và BỎ QUA các MODIFY và REMOVE events từ DynamoDB Stream

### Requirement 3: Gửi Thông Báo

**User Story:** Với vai trò khách tham dự, tôi muốn nhận email xác nhận sau khi đăng ký, để biết rằng đăng ký của tôi đã thành công.

#### Acceptance Criteria

1. KHI Sender_Lambda nhận message từ NotificationQueue, THÌ Sender_Lambda PHẢI gửi email xác nhận tới địa chỉ email của guest qua SES sử dụng SendTemplatedEmail API với template đã định nghĩa sẵn, truyền template data gồm tên guest, email, và timestamp submittedAt
2. KHI Sender_Lambda nhận message từ NotificationQueue, THÌ Sender_Lambda PHẢI publish thông báo tới Admin_Topic chứa tên guest, email, và submittedAt
3. KHI Sender_Lambda gửi email thành công và publish SNS thành công, THÌ Sender_Lambda PHẢI cập nhật status của bản ghi trong Entries_Table từ "RECEIVED" sang "NOTIFIED"
4. NẾU Sender_Lambda nhận message với submissionId đã có status "NOTIFIED" trong Entries_Table, THÌ Sender_Lambda PHẢI bỏ qua việc gửi email và SNS notification để đảm bảo idempotency
5. NẾU Sender_Lambda gửi email qua SES thất bại, THÌ Sender_Lambda PHẢI throw error để SQS retry message delivery tối đa maxReceiveCount lần trước khi message bị chuyển vào Dead Letter Queue
6. NẾU Sender_Lambda publish tới Admin_Topic qua SNS thất bại, THÌ Sender_Lambda PHẢI throw error để SQS retry message delivery mà không gửi trùng email khi retry
7. NẾU Sender_Lambda nhận message với submissionId không tồn tại trong Entries_Table, THÌ Sender_Lambda PHẢI throw error để SQS retry message delivery

### Requirement 4: Dead Letter Queue và Độ Tin Cậy

**User Story:** Với vai trò admin, tôi muốn các thông báo thất bại được lưu vào dead letter queue, để không có thông báo đăng ký nào bị mất vĩnh viễn.

#### Acceptance Criteria

1. NotificationQueue PHẢI được cấu hình redrive policy chuyển message thất bại vào DLQ sau maxReceiveCount = 3 lần
2. KHI message bị chuyển vào DLQ, THÌ DLQ PHẢI giữ message trong 14 ngày (1.209.600 giây) để admin điều tra thủ công
3. KHI metric ApproximateNumberOfMessagesVisible của DLQ vượt quá 0, THÌ CloudWatch Alarm PHẢI chuyển sang trạng thái ALARM và thông báo tới admin SNS topic
4. DLQ PHẢI giữ nguyên message body và attributes gốc để admin có thể xác định submission đăng ký bị lỗi

### Requirement 5: Bảo Mật và IAM

**User Story:** Với vai trò kỹ sư bảo mật, tôi muốn mỗi Lambda function có IAM role riêng với quyền tối thiểu, để hệ thống tuân thủ nguyên tắc least privilege.

#### Acceptance Criteria

1. SubmitForm_Lambda PHẢI có IAM role chỉ cấp quyền `dynamodb:PutItem` trên resource Entries_Table
2. StreamProcessor_Lambda PHẢI có IAM role chỉ cấp quyền `sqs:SendMessage` trên resource NotificationQueue và quyền đọc DynamoDB Stream trên Entries_Table
3. Sender_Lambda PHẢI có IAM role cấp quyền `ses:SendTemplatedEmail` permission, `sns:Publish` trên Admin_Topic, `dynamodb:UpdateItem` và `dynamodb:GetItem` trên Entries_Table, và `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` trên NotificationQueue
4. API_Gateway PHẢI expose đúng hai endpoint: POST /submit cho form submission và GET /submissions cho lấy danh sách

### Requirement 6: Quản Lý Cấu Hình

**User Story:** Với vai trò developer, tôi muốn toàn bộ cấu hình runtime lưu trong SSM Parameter Store, để thay đổi cấu hình không cần redeploy.

#### Acceptance Criteria

1. Sender_Lambda PHẢI đọc admin email từ SSM_Parameter_Store lúc runtime thông qua SSM API hoặc environment variables được resolve từ SSM parameter references trong SAM template
2. Sender_Lambda PHẢI đọc SES sender email domain từ SSM_Parameter_Store lúc runtime thông qua SSM API hoặc environment variables được resolve từ SSM parameter references trong SAM template
3. Sender_Lambda PHẢI đọc tên SES email template từ SSM_Parameter_Store lúc runtime
4. Hệ thống KHÔNG ĐƯỢC chứa bất kỳ giá trị email address, domain name, hay template name cố định nào trong source code hoặc SAM template parameter defaults
5. NẾU SSM parameter cần thiết cho Sender_Lambda bị thiếu hoặc không truy cập được, THÌ Sender_Lambda PHẢI fail invocation hiện tại với error message chỉ ra parameter nào không lấy được, và SQS message PHẢI được giữ lại trong queue để retry
6. NẾU giá trị SSM parameter rỗng hoặc không đúng định dạng email hợp lệ (cho admin email) hoặc định dạng domain hợp lệ (cho sender domain), THÌ Sender_Lambda PHẢI xử lý như lỗi truy xuất và không gửi email

### Requirement 7: Infrastructure as Code

**User Story:** Với vai trò developer, tôi muốn toàn bộ hạ tầng backend được định nghĩa trong SAM template, để deployment có thể lặp lại và quản lý version.

#### Acceptance Criteria

1. SAM template PHẢI định nghĩa tất cả resources bao gồm API_Gateway, SubmitForm_Lambda, GetSubmissions_Lambda, StreamProcessor_Lambda, Sender_Lambda, IAM role riêng cho mỗi Lambda với least-privilege permissions, Entries_Table với DynamoDB Stream enabled, NotificationQueue, DLQ, Admin_Topic, và event source mappings kết nối DynamoDB Stream tới StreamProcessor_Lambda và NotificationQueue tới Sender_Lambda
2. SAM template PHẢI cấu hình DynamoDB Stream với StreamViewType NEW_IMAGE trên Entries_Table
3. SAM template PHẢI deploy tất cả resources trong region us-east-1
4. SAM template PHẢI sử dụng Node.js 24.x runtime với cấu hình ESM (ECMAScript modules) dùng file extension .mjs cho tất cả Lambda functions
5. SAM template PHẢI cấu hình NotificationQueue với redrive policy chuyển message vào DLQ sau tối đa 3 lần receive
6. SAM template PHẢI reference giá trị cấu hình từ SSM Parameter Store cho admin email, SES domain, và SES template name thay vì hardcode trong resource definitions hoặc environment variables
7. SES email template PHẢI được định nghĩa trong SAM template dưới dạng AWS::SES::Template resource với HtmlPart khai báo inline ngay trong template, deploy tự động cùng `sam deploy`, sử dụng các placeholder {{name}}, {{email}}, {{submittedAt}} và color palette: nền tối #0B0B12, nền card #151035, teal accent #32EFB9, violet accent #8B5CF6

### Requirement 8: API Lấy Danh Sách Đăng Ký

**User Story:** Với vai trò khách tham dự, tôi muốn xem danh sách tất cả người đã đăng ký, để biết ai sẽ tham dự sự kiện.

#### Acceptance Criteria

1. KHI client gửi GET request tới endpoint /submissions, THÌ API Gateway PHẢI invoke GetSubmissions_Lambda và trả về danh sách tất cả submissions từ Entries_Table sắp xếp theo submittedAt giảm dần (mới nhất ở đầu)
2. Mỗi item trong danh sách trả về PHẢI chứa các trường: submissionId, name, note, status, submittedAt
3. NẾU Entries_Table không có bản ghi nào, THÌ GetSubmissions_Lambda PHẢI trả về response 200 với mảng rỗng
4. NẾU thao tác đọc DynamoDB thất bại, THÌ GetSubmissions_Lambda PHẢI trả về response lỗi 500 với thông báo lỗi chung không tiết lộ chi tiết nội bộ
5. GetSubmissions_Lambda PHẢI có IAM role chỉ cấp quyền `dynamodb:Scan` trên resource Entries_Table

### Requirement 9: Giao Diện Frontend

**User Story:** Với vai trò khách tham dự, tôi muốn có giao diện trực quan để đăng ký và xem danh sách người tham dự, để trải nghiệm dễ dàng và nhanh chóng.

#### Acceptance Criteria

1. Giao diện PHẢI chia làm 2 phần: bên trái là form đăng ký (name, email, note), bên phải là danh sách người đã đăng ký
2. Danh sách bên phải PHẢI hiển thị các cột: Tên, Note, Status
3. KHI user submit form thành công, THÌ entry mới PHẢI xuất hiện ngay đầu danh sách bên phải (optimistic update) với status "RECEIVED" mà không cần refresh trang
4. KHI trang được load lần đầu, THÌ frontend PHẢI gọi GET /submissions để hiển thị danh sách submissions hiện có
5. Frontend PHẢI hỗ trợ cả hai chế độ sáng và tối với dark là chế độ mặc định, lựa chọn của người dùng PHẢI được lưu lại giữa các lần truy cập, và mỗi chế độ PHẢI tuân thủ palette được chỉ định — dark: nền tổng thể #0B0B12, nền card #151035, accent chính teal #32EFB9, accent phụ violet #8B5CF6; light: nền tổng thể #F7F7FB, nền card #FFFFFF, accent chính teal #32EFB9, accent phụ violet #5F56D9
6. Mỗi màn hình CHỈ ĐƯỢC có 1 nút teal làm primary CTA; violet CHỈ dùng cho badge/tag/trang trí, KHÔNG dùng làm nền nút chính; teal và violet KHÔNG ĐƯỢC đặt cạnh nhau trên diện tích lớn; nút chuyển chế độ sáng/tối KHÔNG ĐƯỢC dùng nền teal
7. KHI người dùng tải lại trang, THÌ chế độ đã chọn PHẢI được áp dụng trước khi render lần đầu để không xảy ra hiện tượng nháy sai màu
