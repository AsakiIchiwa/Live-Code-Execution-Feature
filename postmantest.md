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
| `user_id` | `660e8400-e29b-41d4-a716-446655440001` |
| `simulation_id` | `550e8400-e29b-41d4-a716-446655440000` |

> Hoặc thay trực tiếp vào các request bên dưới.

---

## Bước 1: Health Check

Kiểm tra server đã chạy chưa.

```
GET {{base_url}}/health
```

**Kết quả mong đợi** (200 OK):

```json
{
  "status": "ok",
  "timestamp": "2026-04-10T10:00:00.000Z",
  "uptime": 123.456
}
```

---

## Bước 2: Tạo Code Session

Tạo một phiên code mới.

```
POST {{base_url}}/api/v1/code-sessions
```

**Headers:**

| Key | Value |
|-----|-------|
| Content-Type | application/json |

**Body** (raw JSON):

```json
{
  "simulation_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "660e8400-e29b-41d4-a716-446655440001",
  "language": "python",
  "template_code": "# Write your solution\n"
}
```

**Kết quả mong đợi** (201 Created):

```json
{
  "session_id": "abc12345-...",
  "status": "ACTIVE",
  "language": "python",
  "language_version": "3.11",
  "expires_at": "2026-04-11T10:00:00.000Z",
  "created_at": "2026-04-10T10:00:00.000Z"
}
```

> **Lưu giá trị `session_id`** để dùng cho các bước tiếp theo.

---

## Bước 3: Xem chi tiết Session

```
GET {{base_url}}/api/v1/code-sessions/{{session_id}}
```

Thay `{{session_id}}` bằng giá trị nhận được từ Bước 2.

**Kết quả mong đợi** (200 OK):

```json
{
  "session_id": "abc12345-...",
  "simulation_id": "550e8400-...",
  "user_id": "660e8400-...",
  "language": "python",
  "language_version": "3.11",
  "source_code": "# Write your solution\n",
  "status": "ACTIVE",
  "version": 1,
  "expires_at": "...",
  "created_at": "...",
  "updated_at": "..."
}
```

---

## Bước 4: Autosave code (cập nhật code)

Lưu code mới vào session. Cần gửi kèm `version` hiện tại (optimistic locking).

```
PATCH {{base_url}}/api/v1/code-sessions/{{session_id}}
```

**Headers:**

| Key | Value |
|-----|-------|
| Content-Type | application/json |
| x-user-id | 660e8400-e29b-41d4-a716-446655440001 |

**Body** (raw JSON):

```json
{
  "source_code": "print('Hello World')",
  "version": 1
}
```

**Kết quả mong đợi** (200 OK):

```json
{
  "session_id": "abc12345-...",
  "status": "ACTIVE",
  "version": 2,
  "updated_at": "..."
}
```

> Mỗi lần autosave thành công, `version` tăng lên 1. Lần autosave tiếp theo phải gửi `version: 2`.

---

## Bước 5: Chạy code (Run Execution)

Gửi code để thực thi. Server sẽ trả về ngay lập tức với status `QUEUED`, worker sẽ xử lý ngầm.

```
POST {{base_url}}/api/v1/code-sessions/{{session_id}}/run
```

**Headers:**

| Key | Value |
|-----|-------|
| Content-Type | application/json |
| x-user-id | 660e8400-e29b-41d4-a716-446655440001 |

**Body**: `{}` (object rỗng)

**Kết quả mong đợi** (202 Accepted):

```json
{
  "execution_id": "xyz98765-...",
  "status": "QUEUED"
}
```

> **Lưu giá trị `execution_id`** để dùng cho bước tiếp theo.

---

## Bước 6: Xem kết quả thực thi

Poll kết quả cho đến khi `status` không còn là `QUEUED` hoặc `RUNNING`.

```
GET {{base_url}}/api/v1/executions/{{execution_id}}
```

Thay `{{execution_id}}` bằng giá trị nhận được từ Bước 5.

**Khi đang chờ** (status = QUEUED hoặc RUNNING):

```json
{
  "execution_id": "xyz98765-...",
  "session_id": "abc12345-...",
  "status": "RUNNING",
  "queued_at": "...",
  "started_at": "...",
  "completed_at": null,
  "lifecycle": [...]
}
```

**Khi hoàn thành** (status = COMPLETED):

```json
{
  "execution_id": "xyz98765-...",
  "session_id": "abc12345-...",
  "status": "COMPLETED",
  "queued_at": "...",
  "started_at": "...",
  "completed_at": "...",
  "stdout": "Hello World\n",
  "stderr": "",
  "exit_code": 0,
  "execution_time_ms": 150,
  "memory_used_kb": null,
  "lifecycle": [
    { "fromStatus": null, "toStatus": "QUEUED", "createdAt": "..." },
    { "fromStatus": "QUEUED", "toStatus": "RUNNING", "createdAt": "..." },
    { "fromStatus": "RUNNING", "toStatus": "COMPLETED", "createdAt": "..." }
  ]
}
```

> Nếu `status` vẫn là `QUEUED` hoặc `RUNNING`, đợi 1-2 giây rồi gọi lại.

---

## Bước 7: Xem lịch sử thực thi của Session

```
GET {{base_url}}/api/v1/code-sessions/{{session_id}}/executions
```

**Kết quả mong đợi** (200 OK):

```json
{
  "executions": [
    {
      "id": "xyz98765-...",
      "status": "COMPLETED",
      "executionTimeMs": 150,
      "queuedAt": "...",
      "completedAt": "..."
    }
  ]
}
```

---

## Các trường hợp lỗi thường gặp

### Thiếu header `x-user-id` → 401

```
POST {{base_url}}/api/v1/code-sessions/{{session_id}}/run
```

Không gửi header `x-user-id`.

```json
{
  "error": "UNAUTHORIZED",
  "message": "Missing x-user-id header"
}
```

### Sai user → 403

Gửi `x-user-id` khác với user tạo session.

```json
{
  "error": "FORBIDDEN",
  "message": "Access denied: you do not own this session"
}
```

### Version conflict khi autosave → 409

Gửi `version` cũ (không đúng version hiện tại).

```json
{
  "error": "VERSION_CONFLICT",
  "message": "Version conflict: expected 2, got 1. Refetch and retry."
}
```

### Session không tồn tại → 404

```json
{
  "error": "SESSION_NOT_FOUND",
  "message": "Session not found"
}
```

### Rate limit → 429

Gửi quá nhiều request chạy code trong 1 phút.

```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded: max 10 executions per minute"
}
```

---

## Các status thực thi

| Status | Ý nghĩa |
|--------|----------|
| `QUEUED` | Đang chờ trong queue |
| `RUNNING` | Worker đang thực thi |
| `COMPLETED` | Chạy thành công (exit code = 0) |
| `FAILED` | Có lỗi runtime (exit code ≠ 0) |
| `TIMEOUT` | Quá thời gian cho phép (mặc định 10 giây) |

---

## Thứ tự test đề nghị

1. `GET /health` — kiểm tra server
2. `POST /api/v1/code-sessions` — tạo session
3. `GET /api/v1/code-sessions/:id` — xem session
4. `PATCH /api/v1/code-sessions/:id` — autosave code
5. `POST /api/v1/code-sessions/:id/run` — chạy code
6. `GET /api/v1/executions/:id` — xem kết quả (gọi lại vài lần)
7. `GET /api/v1/code-sessions/:id/executions` — xem lịch sử
