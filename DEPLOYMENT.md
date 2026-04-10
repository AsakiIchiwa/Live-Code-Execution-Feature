# 🚀 Deployment Guide — Live Code Execution Backend

> Hướng dẫn deploy chi tiết cho project **Live Code Execution Backend** lên các nền tảng cloud.  
> Bao gồm: **Render (Recommended)**, **Railway**, **Vercel**, và cách truy cập **API Documentation** để demo/thuyết trình.

---

## 📖 Table of Contents

1. [API Documentation Page (Swagger UI)](#1-api-documentation-page-swagger-ui)
2. [Option A: Deploy lên Render (✅ Recommended)](#2-option-a-deploy-lên-render--recommended)
3. [Option B: Deploy lên Railway (🚂 Nhanh & Tiện)](#3-option-b-deploy-lên-railway--nhanh--tiện)
4. [Option C: Deploy lên Vercel (⚠️ Có giới hạn)](#4-option-c-deploy-lên-vercel--có-giới-hạn)
5. [Database & Redis Setup (Dùng chung)](#5-database--redis-setup)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [Post-Deploy Verification](#7-post-deploy-verification)
8. [Tips cho Demo/Thuyết trình](#8-tips-cho-demothuyết-trình)

---

## 1. API Documentation Page (Swagger UI)

### ✅ Đã có sẵn trong project!

Project đã tích hợp **Swagger UI** tại route `/docs`. Khi server chạy, bạn có thể truy cập:

```
http://localhost:3000/docs
```

Sau khi deploy, đổi thành URL của server:

```
https://your-app.onrender.com/docs
```

### Swagger UI cung cấp:

- **Giao diện trực quan** để xem tất cả API endpoints
- **Nút "Try it out"** để test API trực tiếp từ trình duyệt
- **Request/Response schemas** với ví dụ mẫu
- **Tất cả 7 endpoints** được document đầy đủ:
  - `GET /health` — Health Check
  - `GET /health/worker` — Worker Health Check  
  - `POST /api/v1/code-sessions` — Tạo session mới
  - `PATCH /api/v1/code-sessions/:session_id` — Autosave code
  - `GET /api/v1/code-sessions/:session_id` — Xem chi tiết session
  - `POST /api/v1/code-sessions/:session_id/run` — Chạy code
  - `GET /api/v1/executions/:execution_id` — Xem kết quả execution
  - `GET /api/v1/code-sessions/:session_id/executions` — Liệt kê executions

### OpenAPI JSON endpoint:

```
GET /docs/json
```

Có thể import vào **Postman**, **Insomnia**, hoặc bất kỳ API client nào.

### Screenshot minh họa flow test trên Swagger UI:

1. Mở `/docs` → Expand **Sessions** → Click `POST /api/v1/code-sessions`
2. Click **"Try it out"** → Điền body:
   ```json
   {
     "simulation_id": "550e8400-e29b-41d4-a716-446655440000",
     "user_id": "660e8400-e29b-41d4-a716-446655440001",
     "language": "python"
   }
   ```
3. Click **Execute** → Copy `session_id` từ response
4. Expand **Executions** → `POST /api/v1/code-sessions/{session_id}/run`
5. Thêm header `x-user-id` → Click **Execute** → Nhận `execution_id`
6. Dùng `GET /api/v1/executions/{execution_id}` để poll kết quả

---

## 2. Option A: Deploy lên Render (✅ Recommended)

> **Render là lựa chọn tốt nhất** vì hỗ trợ Docker, Background Workers, managed PostgreSQL & Redis.

### Tại sao chọn Render?

| Feature | Render | Vercel |
|---------|--------|--------|
| Long-running server | ✅ | ❌ (Serverless, 10s timeout) |
| Background Worker (BullMQ) | ✅ | ❌ |
| File system (sandbox) | ✅ | ❌ (Read-only) |
| Docker support | ✅ | ❌ |
| WebSocket support | ✅ | ⚠️ Limited |
| Managed PostgreSQL | ✅ | ❌ (External only) |
| Managed Key Value (Redis) | ✅ | ❌ (External only) |
| Free tier | ✅ | ✅ |

### Bước 1: Tạo tài khoản Render

1. Truy cập [https://render.com](https://render.com)
2. Đăng ký bằng GitHub (để dễ connect repo)

### Bước 2: Tạo PostgreSQL Database

1. Dashboard → **New** → **PostgreSQL**
2. Cấu hình:
   - **Name**: `live-code-execution-db`
   - **Database**: `live_code_execution`
   - **User**: `edtronaut`
   - **Region**: Singapore (gần Việt Nam nhất)
   - **Plan**: Free (90 ngày) hoặc Starter ($7/tháng)
3. Click **Create Database**
4. Sau khi tạo xong → Copy **Internal Database URL** (dạng `postgresql://...`)

### Bước 3: Tạo Key Value Store (Redis)

1. Dashboard → **New** → **Key Value**
2. Cấu hình:
   - **Name**: `live-code-execution-redis`
   - **Region**: Singapore (cùng region với DB)
   - **Plan**: Free (25MB) hoặc Starter ($10/tháng)
3. Click **Create Key Value**
4. Copy **Internal Connection Info**:
   - Tab **Info** → Lấy `Host`, `Port`, `Password`
   - Hoặc copy **Internal Redis URL** (dạng `redis://...`)

> 💡 **Lưu ý**: Render gọi Redis là **"Key Value"** trong dashboard, nhưng bên dưới vẫn là Redis protocol — tương thích hoàn toàn với `ioredis` và BullMQ.

### Bước 4: Deploy API Server

1. Dashboard → **New** → **Web Service**
2. Connect GitHub repo chứa project
3. Cấu hình:
   - **Name**: `live-code-execution-api`
   - **Region**: Singapore
   - **Runtime**: **Docker** (sẽ dùng Dockerfile có sẵn)
   - **Plan**: Free hoặc Starter ($7/tháng)
4. **Environment Variables** (xem [Section 5](#5-environment-variables-reference)):
   ```
   NODE_ENV=production
   PORT=3000
   HOST=0.0.0.0
   DATABASE_URL=<Internal Database URL từ Bước 2>
   REDIS_HOST=<Redis host từ Bước 3>
   REDIS_PORT=6379
   REDIS_PASSWORD=<Redis password từ Bước 3>
   ```
5. **Build Command**: _(để trống — Dockerfile tự xử lý)_
6. **Docker Command Override** — chạy cả API + Worker trong 1 container (tiết kiệm, không cần tạo Background Worker riêng):
   ```bash
   sh scripts/start-all.sh
   ```
   > Script này chạy migration → start API server + Worker song song → graceful shutdown.
   >
   > 💡 File `scripts/start-all.sh` đã có sẵn trong repo.
7. Click **Create Web Service**

### Bước 5: Seed Database

Sau khi deploy thành công, vào **Web Service** → **Shell** tab:

```bash
npx tsx prisma/seed.ts
```

> Migration đã tự chạy trong `start-all.sh`, chỉ cần seed 1 lần.

### Bước 6: Verify

Truy cập:
- Health check: `https://live-code-execution-api.onrender.com/health`
- API Docs: `https://live-code-execution-api.onrender.com/docs`
- Worker health: `https://live-code-execution-api.onrender.com/health/worker`

> ⚠️ **Lưu ý Free Tier**: Render free tier sẽ sleep sau 15 phút không có request. Request đầu tiên sau khi sleep sẽ mất ~50s để wake up. Dùng [UptimeRobot](https://uptimerobot.com) ping `/health` mỗi 14 phút để giữ server luôn online.

---

## 3. Option B: Deploy lên Railway (🚂 Nhanh & Tiện)

> **Railway** là lựa chọn tuyệt vời — setup nhanh, UI đẹp, hỗ trợ Docker + PostgreSQL + Redis 1-click.
> Rất phù hợp để **demo/thuyết trình** vì dashboard trực quan và deploy chỉ mất ~5 phút.

### Tại sao chọn Railway?

| Feature | Railway | Render | Vercel |
|---------|---------|--------|--------|
| Setup speed | ✅ ~5 phút | ⚠️ ~10 phút | ❌ Phức tạp |
| Docker | ✅ Auto-detect | ✅ | ❌ |
| PostgreSQL | ✅ 1-click plugin | ✅ Managed | ❌ External |
| Redis | ✅ 1-click plugin | ✅ Key Value (Redis) | ❌ External |
| Background Worker | ✅ Thêm service | ✅ | ❌ |
| Cold start | ✅ Không có | ⚠️ Free tier 50s | ❌ 2-5s |
| Free tier | ⚠️ $5/tháng credit | ✅ 750 hours | ✅ |
| UI/Dashboard | ✅ Đẹp, trực quan | ⚠️ Functional | ⚠️ |
| Deploy speed | ✅ ~1-2 phút | ⚠️ ~3-5 phút | ✅ ~1 phút |

### Bước 1: Tạo tài khoản Railway

1. Truy cập [https://railway.app](https://railway.app)
2. Đăng ký bằng **GitHub** (để auto-connect repo)
3. Verify email → Nhận **$5 free credit/tháng**

### Bước 2: Tạo Project mới

1. Dashboard → **New Project** → **Deploy from GitHub repo**
2. Chọn repo `live-code-execution`
3. Railway sẽ **tự động detect Dockerfile** và bắt đầu build

### Bước 3: Thêm PostgreSQL

1. Trong project → Click **"+ New"** → **Database** → **Add PostgreSQL**
2. Railway tự động tạo database và inject biến `DATABASE_URL` vào service
3. Click vào PostgreSQL service → Tab **Connect** → Copy `DATABASE_URL` (nếu cần)

### Bước 4: Thêm Redis

1. Trong project → Click **"+ New"** → **Database** → **Add Redis**
2. Railway tự động inject `REDIS_URL`
3. Click vào Redis service → Tab **Connect** → Copy connection details:
   - `REDIS_HOST`
   - `REDIS_PORT`
   - `REDIS_PASSWORD`

### Bước 5: Cấu hình API Server

1. Click vào service (app) chính → Tab **Variables**
2. Thêm environment variables:
   ```
   NODE_ENV=production
   PORT=3000
   HOST=0.0.0.0
   LOG_LEVEL=warn
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_HOST=${{Redis.REDIS_HOST}}
   REDIS_PORT=${{Redis.REDIS_PORT}}
   REDIS_PASSWORD=${{Redis.REDIS_PASSWORD}}
   ```
   > 💡 Cú pháp `${{Service.VAR}}` là **Railway variable references** — tự động link tới service khác.
3. Tab **Settings**:
   - **Start Command**: `sh -c "npx prisma migrate deploy && node dist/server.js"`
   - **Port**: `3000`
4. Tab **Settings** → **Networking** → **Generate Domain** → Nhận URL dạng `https://xxx.up.railway.app`

### Bước 6: Thêm Worker Service

1. Trong project → **"+ New"** → **GitHub Repo** → Chọn cùng repo
2. Đổi tên service thành `worker`
3. Tab **Variables** → Copy tất cả variables từ API service + thêm:
   ```
   QUEUE_CONCURRENCY=5
   ```
4. Tab **Settings**:
   - **Start Command**: `node dist/workers/executionWorker.js`
   - ❌ **Tắt** "Generate Domain" (worker không cần public URL)

### Bước 7: Chạy Migration & Seed

Cách 1 — **Railway CLI**:
```bash
# Cài Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link project
railway link

# Chạy commands
railway run npx prisma migrate deploy
railway run npx tsx prisma/seed.ts
```

Cách 2 — **Start Command đã bao gồm migration** (Bước 5):
- Migration tự chạy khi deploy
- Chỉ cần seed 1 lần qua CLI:
  ```bash
  railway run npx tsx prisma/seed.ts
  ```

### Bước 8: Verify

Truy cập:
- Health: `https://xxx.up.railway.app/health`
- API Docs: `https://xxx.up.railway.app/docs`
- Worker: `https://xxx.up.railway.app/health/worker`

### 💡 Tips Railway

- **Logs real-time**: Click vào service → Tab **Deployments** → Click deployment → Xem logs
- **Restart**: Tab **Deployments** → **Redeploy**
- **Monitor usage**: Dashboard → **Usage** → Xem credit còn lại
- **Auto-deploy**: Mỗi lần push code lên GitHub, Railway tự deploy lại
- **Sleep mode**: Free tier sẽ sleep sau 5 phút không có request (wake up ~1-2s)

### 🚀 Quick Deploy — Railway trong 5 phút

```bash
# 1. Cài Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Init project từ repo hiện tại
railway init

# 4. Add PostgreSQL + Redis
railway add --plugin postgresql
railway add --plugin redis

# 5. Set variables
railway variables set NODE_ENV=production PORT=3000 HOST=0.0.0.0

# 6. Deploy
railway up

# 7. Chạy migration + seed
railway run npx prisma migrate deploy
railway run npx tsx prisma/seed.ts

# 8. Mở app
railway open
```

---

## 4. Option C: Deploy lên Vercel (⚠️ Có giới hạn)

> **⚠️ CẢNH BÁO**: Vercel là nền tảng **serverless**, không phù hợp lắm cho project này vì:
> - Không hỗ trợ long-running process (BullMQ Worker)
> - Không có file system writable (sandbox cần ghi file tạm)
> - Timeout giới hạn 10-60s (Free/Pro)
> - Không có Redis/PostgreSQL built-in
>
> **Tuy nhiên**, bạn vẫn có thể deploy **API server** lên Vercel nếu:
> - Dùng external PostgreSQL (Neon, Supabase)
> - Dùng external Redis (Upstash)
> - Worker chạy riêng trên Render/Railway
> - Chấp nhận sandbox execution sẽ bị giới hạn

### Bước 1: Cài Vercel CLI

```bash
npm install -g vercel
```

### Bước 2: Tạo file `vercel.json`

Tạo file `vercel.json` ở root project:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "dist/server.js"
    }
  ],
  "buildCommand": "npm run build && npx prisma generate",
  "outputDirectory": "dist",
  "env": {
    "NODE_ENV": "production"
  }
}
```

### Bước 3: Tạo Vercel Serverless Adapter

Vì Fastify cần adapter cho serverless, tạo file `api/index.ts`:

```typescript
import { buildApp } from '../src/server';

let app: any;

export default async function handler(req: any, res: any) {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  app.server.emit('request', req, res);
}
```

Và cập nhật `vercel.json`:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "api/index.ts"
    }
  ]
}
```

### Bước 4: Setup External Services

#### PostgreSQL — Dùng Neon (Free)

1. Truy cập [https://neon.tech](https://neon.tech) → Sign up
2. Create Project → Copy connection string
3. Dạng: `postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`

#### Redis — Dùng Upstash (Free)

1. Truy cập [https://upstash.com](https://upstash.com) → Sign up
2. Create Redis Database → Copy connection details
3. **REDIS_HOST**: `xxx.upstash.io`
4. **REDIS_PORT**: `6379`
5. **REDIS_PASSWORD**: `<password>`

### Bước 5: Set Environment Variables trên Vercel

```bash
vercel env add DATABASE_URL
vercel env add REDIS_HOST
vercel env add REDIS_PORT
vercel env add REDIS_PASSWORD
vercel env add NODE_ENV
```

Hoặc qua Dashboard: Settings → Environment Variables

### Bước 6: Deploy

```bash
# Login
vercel login

# Deploy (preview)
vercel

# Deploy (production)
vercel --prod
```

### Bước 7: Deploy Worker riêng (trên Render)

Vercel **KHÔNG** hỗ trợ background workers. Bạn **PHẢI** deploy worker riêng:

1. Trên Render: tạo **Background Worker** (xem Bước 5 ở Section 2)
2. Dùng cùng `DATABASE_URL` và `REDIS_HOST` external
3. Worker command: `node dist/workers/executionWorker.js`

### ⚠️ Giới hạn khi deploy Vercel

| Vấn đề | Ảnh hưởng | Giải pháp |
|---------|-----------|-----------|
| Serverless timeout (10s free, 60s pro) | Code execution có thể timeout | Giảm `EXEC_TIMEOUT_MS` xuống 5000 |
| Read-only file system | Sandbox không ghi được file tạm | Cần refactor sandbox dùng `/tmp` (Vercel cho phép `/tmp`) |
| Cold start | Request đầu tiên chậm 2-5s | Accept hoặc dùng cron ping |
| No worker | BullMQ worker không chạy được | Deploy worker trên Render/Railway |
| No WebSocket | Không dùng được nếu cần | Dùng polling (đã implement) |

---

## 5. Database & Redis Setup

### Option A: Render Managed (Dễ nhất)

- PostgreSQL: Dashboard → **New** → **Postgres**
- Redis: Dashboard → **New** → **Key Value** (đây chính là Redis)
- Ưu điểm: Internal network, không tốn bandwidth, latency thấp

### Option B: External Services (Cho Vercel hoặc muốn free tier tốt hơn)

#### PostgreSQL Providers:

| Provider | Free Tier | Link |
|----------|-----------|------|
| **Neon** | 0.5GB, auto-suspend | [neon.tech](https://neon.tech) |
| **Supabase** | 500MB, 2 projects | [supabase.com](https://supabase.com) |
| **ElephantSQL** | 20MB (rất nhỏ) | [elephantsql.com](https://www.elephantsql.com) |
| **Aiven** | 5GB trial | [aiven.io](https://aiven.io) |

#### Redis Providers:

| Provider | Free Tier | Link |
|----------|-----------|------|
| **Upstash** | 10K commands/day | [upstash.com](https://upstash.com) |
| **Redis Cloud** | 30MB | [redis.com/cloud](https://redis.com/try-free/) |
| **Aiven** | Trial | [aiven.io](https://aiven.io) |

### Chạy Migration sau khi có DATABASE_URL

```bash
# Local (set DATABASE_URL trong .env)
npx prisma migrate deploy
npx tsx prisma/seed.ts

# Hoặc trên Render Shell
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

---

## 6. Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_HOST` | ❌ | `localhost` | Redis host |
| `REDIS_PORT` | ❌ | `6379` | Redis port |
| `REDIS_PASSWORD` | ❌ | — | Redis password |
| `PORT` | ❌ | `3000` | Server port |
| `HOST` | ❌ | `0.0.0.0` | Server host |
| `NODE_ENV` | ❌ | `development` | `development` / `production` / `test` |
| `LOG_LEVEL` | ❌ | `info` | Log level |
| `EXEC_TIMEOUT_MS` | ❌ | `10000` | Max execution time (ms) |
| `EXEC_MAX_OUTPUT_BYTES` | ❌ | `1048576` | Max output size (1MB) |
| `EXEC_MAX_MEMORY_KB` | ❌ | `262144` | Max memory (256MB) |
| `EXEC_MAX_RETRIES` | ❌ | `2` | Max retry count |
| `EXEC_MAX_PIDS` | ❌ | `10` | Max child processes |
| `RATE_LIMIT_EXECUTIONS_PER_MINUTE` | ❌ | `10` | Executions per user/min |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | ❌ | `100` | Global requests/min |
| `RATE_LIMIT_COOLDOWN_AFTER_TIMEOUTS` | ❌ | `3` | Timeouts before cooldown |
| `RATE_LIMIT_COOLDOWN_SECONDS` | ❌ | `60` | Cooldown duration (s) |
| `SESSION_MAX_CODE_SIZE_BYTES` | ❌ | `51200` | Max code size (50KB) |
| `SESSION_TTL_HOURS` | ❌ | `4` | Session time-to-live |
| `SESSION_MAX_SNAPSHOTS` | ❌ | `50` | Max snapshots per session |
| `QUEUE_NAME` | ❌ | `code-execution` | BullMQ queue name |
| `QUEUE_JOB_TTL_MS` | ❌ | `300000` | Job TTL (5 min) |
| `QUEUE_CONCURRENCY` | ❌ | `5` | Worker concurrency |

### Production Environment Variables Template

```env
# === REQUIRED ===
DATABASE_URL=postgresql://user:password@host:5432/live_code_execution?sslmode=require
NODE_ENV=production

# === REDIS ===
REDIS_HOST=your-redis-host.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# === SERVER ===
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=warn

# === RECOMMENDED FOR PRODUCTION ===
EXEC_TIMEOUT_MS=10000
RATE_LIMIT_EXECUTIONS_PER_MINUTE=10
RATE_LIMIT_REQUESTS_PER_MINUTE=100
QUEUE_CONCURRENCY=5
```

---

## 7. Post-Deploy Verification

### Checklist sau khi deploy

```bash
# 1. Health Check
curl https://your-app-url/health
# Expected: {"status":"ok","timestamp":"...","uptime":...}

# 2. Worker Health
curl https://your-app-url/health/worker
# Expected: {"status":"ok","waiting":0,"active":0,"completed":...}

# 3. Swagger UI
# Mở trình duyệt: https://your-app-url/docs

# 4. Tạo session test
curl -X POST https://your-app-url/api/v1/code-sessions \
  -H "Content-Type: application/json" \
  -d '{
    "simulation_id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "660e8400-e29b-41d4-a716-446655440001",
    "language": "python"
  }'

# 5. Run code test (thay SESSION_ID từ response trên)
curl -X POST https://your-app-url/api/v1/code-sessions/SESSION_ID/run \
  -H "x-user-id: 660e8400-e29b-41d4-a716-446655440001"

# 6. Get result (thay EXECUTION_ID từ response trên)
curl https://your-app-url/api/v1/executions/EXECUTION_ID
```

### Troubleshooting

| Vấn đề | Nguyên nhân | Giải pháp |
|---------|-------------|-----------|
| `500` khi tạo session | Database chưa migrate/seed | Chạy `prisma migrate deploy` + `seed` |
| `TIMEOUT` mọi execution | Worker chưa chạy | Check Background Worker trên Render |
| `Connection refused` Redis | Redis URL sai | Check REDIS_HOST, PORT, PASSWORD |
| Swagger UI trắng | CSP header block | Set `NODE_ENV=development` tạm thời |
| Cold start chậm | Vercel serverless | Bình thường, request thứ 2 sẽ nhanh |

---

## 8. Tips cho Demo/Thuyết trình

### 🎯 Chuẩn bị trước demo

1. **Seed database** trước để có sẵn supported languages
2. **Tạo sẵn 1-2 sessions** để không mất thời gian chờ
3. **Mở sẵn Swagger UI** (`/docs`) trên trình duyệt
4. **Test thử 1 lần** để warm up server (tránh cold start)

### 🎯 Flow demo tốt nhất

1. **Mở Swagger UI** → Giới thiệu tổng quan API
2. **Tạo session** → Show `POST /api/v1/code-sessions`
3. **Autosave code** → Show `PATCH /api/v1/code-sessions/:id` với code Python:
   ```json
   {
     "source_code": "for i in range(5):\n    print(f'Hello {i}')",
     "version": 1
   }
   ```
4. **Run code** → Show `POST /api/v1/code-sessions/:id/run`
5. **Poll result** → Show `GET /api/v1/executions/:id` (status: QUEUED → RUNNING → COMPLETED)
6. **Show output** → `stdout: "Hello 0\nHello 1\nHello 2\nHello 3\nHello 4"`
7. **Demo error handling** → Run code có lỗi syntax
8. **Demo timeout** → Run infinite loop `while True: pass`
9. **Demo optimistic locking** → Autosave với version cũ → Show conflict error
10. **Demo rate limiting** → Spam run nhiều lần → Show 429 error

### 🎯 Các điểm nổi bật để trình bày

- **Security**: Sandbox isolation, rate limiting, input validation
- **Scalability**: Queue-based, horizontal scaling ready
- **Reliability**: Optimistic locking, idempotency keys, graceful shutdown
- **Developer Experience**: Swagger UI, detailed error messages, structured logging

### 🎯 Dùng Postman thay thế Swagger UI

Nếu muốn demo bằng Postman:

1. Import OpenAPI spec: `GET /docs/json` → Save JSON
2. Import vào Postman: File → Import → Paste JSON
3. Tất cả endpoints sẽ tự động tạo với schema đầy đủ

---

## Quick Start — Deploy lên Render trong 10 phút

```bash
# 1. Push code lên GitHub (nếu chưa)
git add -A
git commit -m "ready for deployment"
git push origin main

# 2. Vào render.com → New → Postgres → Tạo DB → Copy Internal URL

# 3. New → Key Value → Tạo Redis → Copy Host & Port

# 4. New → Web Service → Connect repo → Docker
#    → Docker Command: sh scripts/start-all.sh
#    → Set env vars (DATABASE_URL, REDIS_HOST, REDIS_PORT, NODE_ENV, PORT, HOST)
#    → Create

# 5. Vào Web Service → Shell tab:
npx tsx prisma/seed.ts

# 6. Truy cập: https://your-app.onrender.com/docs ← API Documentation!
```

> 💡 Không cần tạo Background Worker riêng — `scripts/start-all.sh` chạy cả API + Worker trong 1 container.

**Done! 🎉 API Documentation sẵn sàng để demo.**
