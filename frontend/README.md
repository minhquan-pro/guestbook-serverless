# Guestbook Frontend

Giao diện đăng ký sự kiện, xây bằng Next.js (App Router). Layout 2 cột: form đăng ký bên trái, danh sách người đã đăng ký bên phải.

## Yêu cầu

- Node.js 20 trở lên
- Backend đã được deploy (xem `../backend/`) — frontend cần API endpoint để hoạt động

## Chạy local

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

Mở `.env.local` và điền `NEXT_PUBLIC_API_URL` bằng endpoint của backend. Nếu backend đã deploy, lấy giá trị bằng:

```bash
aws cloudformation describe-stacks \
  --stack-name guestbook-serverless \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

Rồi chạy dev server:

```bash
npm run dev
```

Mở http://localhost:3000

Nếu `NEXT_PUBLIC_API_URL` để trống hoặc sai, form vẫn render nhưng danh sách bên phải sẽ hiện lỗi `Không thể tải danh sách đăng ký`.

## Các lệnh khác

| Lệnh | Mô tả |
|------|-------|
| `npm run dev` | Dev server có hot reload |
| `npm run build` | Build production |
| `npm start` | Chạy bản đã build (phải `build` trước) |
| `npm run lint` | ESLint |

## Cách hoạt động

**Khi load trang** — gọi `GET /submissions`, hiển thị danh sách sắp xếp theo thời gian mới nhất trước. Trong lúc chờ hiện `Đang tải...`.

**Khi submit form** — gọi `POST /submit` với `{name, email, note}`. Nhận về `submissionId`, sau đó thêm entry mới vào **đầu danh sách ngay trên client** (optimistic update) với status `RECEIVED`, không gọi lại `GET`. Form được clear, lỗi validate từ backend hiện inline dưới các input.

**Về cột Status** — backend xử lý gửi email bất đồng bộ, nên status chuyển `RECEIVED` → `NOTIFIED` sau vài giây. Frontend **không** poll để cập nhật; muốn thấy status mới thì refresh trang. Đây là quyết định có ý thức để giữ app demo đơn giản.

## Theme sáng/tối

Nút toggle ở góc trên phải header. Dark là mặc định.

## Cấu trúc

```
frontend/
├── src/app/
│   ├── layout.js          # Root layout, fonts, inline script set theme
│   ├── page.js            # Trang chính: form + danh sách (client component)
│   ├── ThemeToggle.js     # Nút đổi theme
│   ├── globals.css        # Design tokens, reset
│   └── page.module.css    # Styles của trang
├── .env.local.example
└── next.config.mjs
```

## Deploy

Frontend deploy qua AWS Amplify Hosting, tự động build khi push code lên branch. `NEXT_PUBLIC_API_URL` cần set trong phần Environment variables của Amplify console — file `.env.local` không được commit nên Amplify không đọc được từ repo.
