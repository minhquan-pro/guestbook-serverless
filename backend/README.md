# Guestbook Backend

Backend serverless cho ứng dụng đăng ký sự kiện, deploy bằng AWS SAM.

API trả response ngay sau khi ghi DynamoDB. Việc gửi email xác nhận (SES) và thông báo admin (SNS) chạy bất đồng bộ phía sau qua DynamoDB Stream → SQS → Sender Lambda, nên client không phải chờ.

## Yêu cầu

| | Ghi chú |
|---|---|
| Node.js 20+ | Chạy test local |
| AWS CLI | Đã `aws configure` với profile có quyền tạo Lambda/DynamoDB/SQS/SNS/SES/IAM |
| SAM CLI **1.165.0+** | Bản cũ hơn không build được runtime `nodejs24.x` |
| Một domain trên Route 53 | Để verify SES — xem bước 2 |

Kiểm tra nhanh:

```bash
aws sts get-caller-identity    # xác nhận đúng account
sam --version                  # phải >= 1.165.0
```

Nếu SAM CLI cũ, tải bản mới tại [trang cài đặt SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).

Toàn bộ hướng dẫn dùng region `us-east-1`. Đổi region thì phải đổi đồng bộ ở tất cả lệnh bên dưới.

## Bước 1 — Cài dependencies

```bash
cd backend
npm install
npm test        # 53 tests, nên pass hết trước khi deploy
```

## Bước 2 — Verify domain trên SES

SES chỉ cho gửi mail từ địa chỉ/domain đã verify. Verify domain (khuyến nghị, vì gửi được từ mọi địa chỉ thuộc domain đó):

```bash
aws sesv2 create-email-identity \
  --email-identity your-domain.com \
  --region us-east-1
```

Lệnh trên trả về 3 CNAME record DKIM. Thêm chúng vào DNS của domain, rồi chờ verify (thường vài phút tới vài giờ). Kiểm tra trạng thái:

```bash
aws sesv2 get-email-identity \
  --email-identity your-domain.com \
  --region us-east-1 \
  --query '{Verified:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}'
```

Đợi tới khi thấy `Verified: true` và `Dkim: SUCCESS` mới sang bước sau.

> **Về SES sandbox:** account mới mặc định ở sandbox mode, chỉ gửi được tới email đã verify. Muốn gửi cho người lạ phải request production access trong SES console (thường được duyệt trong 24h). Kiểm tra bằng:
> ```bash
> aws sesv2 get-account --region us-east-1 --query ProductionAccessEnabled
> ```
> Nếu là `false` và bạn chỉ đang demo, cứ verify thêm email người nhận là test được:
> ```bash
> aws ses verify-email-identity --email-address you@gmail.com --region us-east-1
> ```

## Bước 3 — Tạo SSM Parameters

Code đọc config từ Parameter Store lúc runtime, không hardcode. Phải tạo **cả 3** trước khi deploy, nếu thiếu thì Sender Lambda sẽ throw và message rơi vào DLQ.

```bash
# Email admin nhận thông báo khi có đăng ký mới
aws ssm put-parameter --name /guestbook/admin-email \
  --value "admin@your-domain.com" --type String --region us-east-1

# Domain gửi mail — DOMAIN TRẦN, không kèm local-part.
# Sender Lambda tự dựng thành noreply@{domain}
aws ssm put-parameter --name /guestbook/ses-domain \
  --value "your-domain.com" --type String --region us-east-1

# Tên SES template, phải khớp TemplateName trong template.yaml
aws ssm put-parameter --name /guestbook/ses-template-name \
  --value "GuestbookConfirmation" --type String --region us-east-1
```

Lỗi hay gặp: điền `ses-domain` thành `noreply@your-domain.com` → sender sẽ thành `noreply@noreply@your-domain.com` và SES reject. Chỉ điền domain.

Kiểm tra lại:

```bash
aws ssm get-parameters-by-path --path /guestbook --region us-east-1 \
  --query 'Parameters[].{Name:Name,Value:Value}' --output table
```

## Bước 4 — Deploy

```bash
sam build
sam deploy --guided        # lần đầu
```

Trả lời prompt: stack name `guestbook-serverless`, region `us-east-1`, còn lại để mặc định (chấp nhận tạo IAM role khi được hỏi). `--guided` giờ sẽ hỏi thêm parameter `Env` (mặc định `prod`, chỉ nhận `dev` hoặc `prod`) — dùng cho tag `Env` trên mọi resource.

Các lần sau chỉ cần:

```bash
sam build && sam deploy
```

Hoặc deploy không interactive:

```bash
sam deploy --stack-name guestbook-serverless --region us-east-1 \
  --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset \
  --tags Project=guestbook Env=prod
```

Vì sao vẫn cần `--tags` ở mức stack khi template đã tag từng resource? Vì SAM tự sinh thêm một số resource không khai báo trong template (event source mapping, Lambda permission, RestApi, deployment) và những resource đó không có chỗ đặt tag trong template — chúng chỉ nhận tag được CloudFormation propagate xuống từ stack. Tag trong template lo phần resource đã khai báo, `--tags` lo phần còn lại.

Riêng IAM role thì không cần lo: SAM tự propagate `Tags` của từng function xuống role tương ứng, nên role nhận đủ cả 3 tag kể cả `Name`.

Deploy xong sẽ in ra Outputs, giữ lại `ApiEndpoint` để cấu hình frontend.

## Bước 5 — Subscribe email admin vào SNS

CloudFormation tạo được SNS topic nhưng **không** tự tạo subscription email (vì cần người nhận bấm confirm). Làm thủ công một lần:

```bash
TOPIC_ARN=$(aws cloudformation describe-stacks --stack-name guestbook-serverless \
  --region us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`AdminTopicArn`].OutputValue' \
  --output text)

aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email \
  --notification-endpoint admin@your-domain.com --region us-east-1
```

AWS gửi email xác nhận — **phải bấm link trong đó**. Chưa confirm thì không nhận được thông báo đăng ký mới, và cả CloudWatch alarm khi DLQ có message.

Kiểm tra đã confirm chưa (confirmed thì `Arn` là ARN thật, chưa thì là `PendingConfirmation`):

```bash
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --region us-east-1 \
  --query 'Subscriptions[].{Endpoint:Endpoint,Arn:SubscriptionArn}'
```

## Bước 6 — Test end-to-end

```bash
API=$(aws cloudformation describe-stacks --stack-name guestbook-serverless \
  --region us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

# Tạo submission
curl -X POST "$API/submit" -H 'Content-Type: application/json' \
  -d '{"name":"Nguyễn Văn A","email":"you@gmail.com","note":"Test"}'
# → {"submissionId":"..."}

# Chờ ~10s cho pipeline async chạy, rồi xem danh sách
sleep 10
curl "$API/submissions"
```

Nếu `status` đã là `NOTIFIED` thì toàn bộ pipeline chạy đúng: DynamoDB → Stream → SQS → Sender → SES + SNS → update status. Còn `RECEIVED` nghĩa là pipeline chưa xong hoặc bị lỗi — xem phần Troubleshooting.

Kiểm tra DLQ rỗng (0 là tốt):

```bash
aws sqs get-queue-attributes --region us-east-1 \
  --queue-url "$(aws cloudformation describe-stacks --stack-name guestbook-serverless \
    --region us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`NotificationQueueUrl`].OutputValue' \
    --output text)-dlq" \
  --attribute-names ApproximateNumberOfMessages
```

## Cấu trúc

```
backend/
├── template.yaml              # Toàn bộ hạ tầng + SES template (HTML inline)
├── src/
│   ├── submitForm/            # POST /submit — validate + ghi DynamoDB
│   ├── getSubmissions/        # GET /submissions — Scan + sort
│   ├── streamProcessor/       # DynamoDB Stream → SQS
│   └── sender/                # SQS → SES + SNS, có idempotency check
├── tests/
│   ├── unit/                  # Test theo ví dụ cụ thể
│   ├── property/              # Property-based tests (fast-check, 9 properties)
│   └── integration/
└── events/                    # Sample payload cho sam local invoke
```

## Test local

```bash
npm test                  # tất cả
npm run test:unit
npm run test:property
npm run test:watch

# Invoke 1 function với sample event
sam local invoke SubmitFormFunction --event events/submit.json

# Chạy API local
sam local start-api
```

## Troubleshooting

**`'nodejs24.x' runtime is not supported` khi `sam build`** — SAM CLI cũ, cần 1.165.0+.

**Status kẹt ở `RECEIVED`** — pipeline async lỗi. Xem log Sender Lambda:
```bash
sam logs --stack-name guestbook-serverless --name SenderFunction --region us-east-1 --tail
```
Nguyên nhân thường gặp: thiếu SSM parameter, domain SES chưa verify, hoặc đang ở sandbox mode mà gửi tới email chưa verify.

**Message vào DLQ** — Sender đã fail 3 lần. Đọc message để biết submission nào lỗi:
```bash
aws sqs receive-message --region us-east-1 --queue-url <DLQ_URL> --max-number-of-messages 10
```
Sau khi fix nguyên nhân, có thể redrive từ DLQ về queue chính bằng SQS console (Start DLQ redrive).

**Email không tới** — kiểm tra SES production access và domain verify (bước 2). Nếu ở sandbox, email người nhận cũng phải được verify.

**`sam deploy` báo SES template already exists** — template `GuestbookConfirmation` đã tồn tại ngoài stack. Xoá rồi deploy lại:
```bash
aws ses delete-template --template-name GuestbookConfirmation --region us-east-1
```

## Dọn dẹp

```bash
sam delete --stack-name guestbook-serverless --region us-east-1
```

Lệnh trên **không** xoá SSM parameters (nằm ngoài stack). Xoá thủ công nếu cần:

```bash
aws ssm delete-parameters --region us-east-1 \
  --names /guestbook/admin-email /guestbook/ses-domain /guestbook/ses-template-name
```

Lưu ý: xoá stack sẽ xoá luôn DynamoDB table cùng toàn bộ dữ liệu đăng ký.

## Tags

Mọi resource taggable trong stack đều có 3 tag, phục vụ cost allocation (nhóm chi phí theo project/môi trường trong Cost Explorer):

| Tag | Giá trị | Mục đích |
|---|---|---|
| `Name` | tên riêng của từng resource, ví dụ `guestbook-lambda-sender` | Nhận diện resource trong console và báo cáo chi phí |
| `Project` | `guestbook` | Tách chi phí của project này khỏi phần còn lại của account |
| `Env` | `dev` hoặc `prod` (parameter `Env`) | So sánh chi phí giữa các môi trường |

Độ phủ của tag không đồng đều, và đây là hành vi đúng chứ không phải thiếu sót:

| Nhóm resource | `Project` + `Env` | `Name` |
|---|---|---|
| Resource khai báo trong template (4 Lambda, API stage, DynamoDB, 2 SQS, SNS, alarm) | ✅ | ✅ |
| IAM role do SAM tự tạo | ✅ | ✅ (SAM propagate từ function) |
| SES template | ✅ (propagate từ stack) | ❌ |
| Event source mapping, RestApi, CloudFormation stack | ✅ (propagate từ stack) | ❌ |

Lý do SES template và event source mapping thiếu `Name`: tag `Name` chỉ đặt được qua property `Tags` của chính resource đó trong template. `AWS::SES::Template` không có property `Tags`, còn event source mapping thì SAM sinh ra ngầm. Cả hai vẫn nhận `Project`/`Env` qua propagation từ stack, nên **vẫn lọc được chi phí theo project** — đó là mục đích chính. Đừng thêm `Tags` vào `GuestbookEmailTemplate`, deploy sẽ fail.

Kiểm tra resource nào đã được tag:

```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=guestbook \
  --region us-east-1 \
  --query 'ResourceTagMappingList[].ResourceARN' --output table
```

Muốn dùng các tag này để lọc/nhóm trong Cost Explorer thì phải **activate** chúng trước: Billing console → Cost allocation tags → chọn `Project`, `Env`, `Name` → Activate. Tag do người dùng tự định nghĩa không tự động bật, và chỉ áp dụng cho chi phí phát sinh **từ ngày activate trở đi** — chi phí trước đó sẽ không được gán tag.

## Bảo mật

Cấu hình hiện tại phù hợp cho demo, **không** phù hợp để chạy công khai lâu dài:

- API không có authentication — ai có URL cũng POST và đọc được toàn bộ danh sách đăng ký (gồm tên và ghi chú của mọi người)
- CORS đang mở `AllowOrigin: '*'`
- Không có rate limit, `POST /submit` có thể bị spam không giới hạn

Nếu đưa lên production, tối thiểu nên thêm API key + usage plan của API Gateway, siết CORS về đúng origin của frontend, và cân nhắc CAPTCHA cho form.
