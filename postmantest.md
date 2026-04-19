# Hướng dẫn test API bằng Postman

## Chuẩn bị

1. Tải và cài đặt [Postman](https://www.postman.com/downloads/)
2. Chạy project theo hướng dẫn trong `README.md`
3. Đảm bảo server đang chạy tại `http://localhost:3000`

---

## Biến dùng chung

Tạo các biến trong Postman (tab **Variables** của Collection):

| Biến | Giá trị |
|------|---------|
| `base_url` | `http://localhost:3000` |
| `token` | _(sẽ lấy từ bước đăng ký/đăng nhập)_ |

> Sau khi đăng nhập, copy `access_token` vào biến `token`.

### Cách set Authorization cho tất cả request

Trong tab **Authorization** của Collection:
- Type: **Bearer Token**
- Token: `{{token}}`

---

## Bước 1: Health Check

```
GET {{base_url}}/health
```

Response (200):
```json
{
  "status": "ok",
  "timestamp": "2026-04-19T00:00:00.000Z",
  "uptime": 123.456
}
```

---

## Bước 2: Đăng ký tài khoản

```
POST {{base_url}}/api/v1/auth/register
Content-Type: application/json
```

Body:
```json
{
  "email": "test@example.com",
  "password": "password123",
  "display_name": "Test User"
}
```

Response (201):
```json
{
  "user": {
    "id": "uuid",
    "email": "test@example.com",
    "displayName": "Test User",
    "role": "USER",
    "createdAt": "..."
  },
  "access_token": "eyJhbGci...",
  "refresh_token": "uuid-uuid"
}
```

> ⚡ **Copy `access_token` vào biến `token`** để dùng cho các request tiếp theo.

---

## Bước 3: Đăng nhập

```
POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
```

Body:
```json
{
  "email": "test@example.com",
  "password": "password123"
}
```

> Response giống đăng ký. Copy `access_token` vào biến `token`.

---

## Bước 4: Đăng nhập bằng thiết bị (ẩn danh)

```
POST {{base_url}}/api/v1/auth/device-login
Content-Type: application/json
```

Body:
```json
{
  "device_id": "my-phone-unique-id"
}
```

---

## Bước 5: Xem thông tin người dùng

```
GET {{base_url}}/api/v1/auth/me
Authorization: Bearer {{token}}
```

---

## Bước 6: Cập nhật profile

```
PATCH {{base_url}}/api/v1/users/me
Authorization: Bearer {{token}}
Content-Type: application/json
```

Body:
```json
{
  "display_name": "New Name"
}
```

---

## Bước 7: Xem/cập nhật cài đặt

### Xem cài đặt

```
GET {{base_url}}/api/v1/users/me/settings
Authorization: Bearer {{token}}
```

### Cập nhật cài đặt

```
PATCH {{base_url}}/api/v1/users/me/settings
Authorization: Bearer {{token}}
Content-Type: application/json
```

Body:
```json
{
  "editor_theme": "light",
  "font_size": 16,
  "auto_save": true,
  "preferred_mode": "study"
}
```

---

## Bước 8: Language Packs

### Danh sách language packs

```
GET {{base_url}}/api/v1/language-packs
Authorization: Bearer {{token}}
```

### Mở khóa language pack

```
POST {{base_url}}/api/v1/language-packs/{{pack_id}}/unlock
Authorization: Bearer {{token}}
```

### Cài đặt language pack

```
POST {{base_url}}/api/v1/language-packs/{{pack_id}}/install
Authorization: Bearer {{token}}
```

### Xem language packs đã cài

```
GET {{base_url}}/api/v1/users/me/language-packs
Authorization: Bearer {{token}}
```

### Gỡ cài đặt

```
DELETE {{base_url}}/api/v1/users/me/language-packs/{{pack_id}}
Authorization: Bearer {{token}}
```

---

## Bước 9: Lesson Packs

### Danh sách lesson packs

```
GET {{base_url}}/api/v1/lesson-packs
Authorization: Bearer {{token}}
```

Query params (tùy chọn):
- `language`: filter theo ngôn ngữ (vd: `java`)
- `difficulty`: `BEGINNER`, `INTERMEDIATE`, `ADVANCED`
- `free_only`: `true` / `false`
- `page`: số trang
- `limit`: số item/trang

### Mở khóa lesson pack

```
POST {{base_url}}/api/v1/lesson-packs/{{pack_id}}/unlock
Authorization: Bearer {{token}}
```

### Xem danh sách bài học

```
GET {{base_url}}/api/v1/lesson-packs/{{pack_id}}/lessons
Authorization: Bearer {{token}}
```

### Xem chi tiết bài học

```
GET {{base_url}}/api/v1/lessons/{{lesson_id}}
Authorization: Bearer {{token}}
```

---

## Bước 10: Code Sessions (Playground)

### Tạo session mới

```
POST {{base_url}}/api/v1/code-sessions
Authorization: Bearer {{token}}
Content-Type: application/json
```

Body:
```json
{
  "language": "java",
  "title": "My First Program",
  "mode": "PLAYGROUND"
}
```

Response (201):
```json
{
  "session_id": "uuid",
  "title": "My First Program",
  "mode": "PLAYGROUND",
  "status": "ACTIVE",
  "language": "java",
  "language_version": "21",
  "expires_at": "...",
  "created_at": "..."
}
```

### Danh sách sessions

```
GET {{base_url}}/api/v1/code-sessions
Authorization: Bearer {{token}}
```

### Autosave code

```
PATCH {{base_url}}/api/v1/code-sessions/{{session_id}}
Authorization: Bearer {{token}}
Content-Type: application/json
```

Body:
```json
{
  "source_code": "public class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello World\");\n  }\n}",
  "version": 1
}
```

### Chạy code

```
POST {{base_url}}/api/v1/code-sessions/{{session_id}}/run
Authorization: Bearer {{token}}
```

Response (202):
```json
{
  "execution_id": "uuid",
  "status": "QUEUED"
}
```

### Xem kết quả (poll)

```
GET {{base_url}}/api/v1/executions/{{execution_id}}
Authorization: Bearer {{token}}
```

> Poll mỗi 1-2 giây cho đến khi status = `COMPLETED` / `FAILED` / `TIMEOUT`.

### Xóa session

```
DELETE {{base_url}}/api/v1/code-sessions/{{session_id}}
Authorization: Bearer {{token}}
```

---

## Bước 11: Submissions (Study Mode)

### Nộp bài

```
POST {{base_url}}/api/v1/lessons/{{lesson_id}}/submissions
Authorization: Bearer {{token}}
Content-Type: application/json
```

Body:
```json
{
  "source_code": "public class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello World\");\n  }\n}",
  "language": "java"
}
```

### Xem kết quả submission

```
GET {{base_url}}/api/v1/submissions/{{submission_id}}
Authorization: Bearer {{token}}
```

### Danh sách submissions của bài học

```
GET {{base_url}}/api/v1/lessons/{{lesson_id}}/submissions
Authorization: Bearer {{token}}
```

---

## Bước 12: Progress Tracking

### Tổng quan tiến độ

```
GET {{base_url}}/api/v1/users/me/progress
Authorization: Bearer {{token}}
```

### Tiến độ theo lesson pack

```
GET {{base_url}}/api/v1/users/me/progress/lesson-packs/{{pack_id}}
Authorization: Bearer {{token}}
```

### Hoàn thành bài học

```
POST {{base_url}}/api/v1/lessons/{{lesson_id}}/complete
Authorization: Bearer {{token}}
```

### Mở khóa bài tiếp theo

```
POST {{base_url}}/api/v1/lessons/{{lesson_id}}/unlock-next
Authorization: Bearer {{token}}
```

---

## Bước 13: Refresh Token

```
POST {{base_url}}/api/v1/auth/refresh
Content-Type: application/json
```

Body:
```json
{
  "refresh_token": "uuid-uuid"
}
```

> Copy `access_token` mới vào biến `token`.

---

## Bước 14: Đăng xuất

```
POST {{base_url}}/api/v1/auth/logout
Authorization: Bearer {{token}}
```

---

## Admin Endpoints

> Đăng nhập bằng tài khoản admin: `admin@edtronaut.ai` / `admin123`

### Tạo language pack

```
POST {{base_url}}/api/v1/admin/language-packs
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

Body:
```json
{
  "code": "python",
  "name": "Python",
  "description": "Python programming language",
  "version": "1.0.0",
  "is_free": true
}
```

### Publish language pack

```
POST {{base_url}}/api/v1/admin/language-packs/{{pack_id}}/publish
Authorization: Bearer {{admin_token}}
```

### Tạo lesson pack

```
POST {{base_url}}/api/v1/admin/lesson-packs
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

Body:
```json
{
  "language_pack_id": "uuid",
  "title": "Python Basics",
  "description": "Learn Python fundamentals",
  "difficulty": "BEGINNER"
}
```

### Tạo lesson

```
POST {{base_url}}/api/v1/admin/lessons
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

Body:
```json
{
  "lesson_pack_id": "uuid",
  "title": "Hello World",
  "description": "Print your first message",
  "instructions": "Write a program that prints 'Hello World'",
  "starter_code": "# Write your code here",
  "type": "CODING",
  "difficulty": "BEGINNER",
  "order_index": 1
}
```

### Tạo test case

```
POST {{base_url}}/api/v1/admin/lessons/{{lesson_id}}/test-cases
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

Body:
```json
{
  "input": "",
  "expected": "Hello World",
  "is_public": true,
  "description": "Should print Hello World"
}
```

### Publish lesson pack

```
POST {{base_url}}/api/v1/admin/lesson-packs/{{pack_id}}/publish
Authorization: Bearer {{admin_token}}
```

---

## System Endpoints (không cần auth)

### Trạng thái hệ thống

```
GET {{base_url}}/api/v1/system/status
```

### Danh sách ngôn ngữ hỗ trợ

```
GET {{base_url}}/api/v1/system/supported-languages
```

### Runtime config

```
GET {{base_url}}/api/v1/system/runtime-config
```
