# EdStronaunt — Live Code Execution Backend

Backend API for the EdStronaunt mobile coding education platform. Features JWT authentication, language/lesson pack management, code playground sessions, study-mode grading, progress tracking, and live code execution — all through a RESTful API.

**Live**: https://live-code-execution-api.onrender.com  
**Repo**: https://github.com/AsakiIchiwa/Live-Code-Execution-Feature

## Requirements

- **Node.js** >= 20
- **Docker** + **Docker Compose** (for PostgreSQL and Redis)

---

## Setup Instructions

### Option 1: Docker (simplest — one command)

```bash
docker compose up --build -d
# Verify: http://localhost:3000/health
docker compose down -v
```

### Option 2: Local development

```bash
# 1. Install dependencies
npm install

# 2. Create config
cp .env.example .env

# 3. Start PostgreSQL + Redis
docker compose up postgres redis -d

# 4. Generate Prisma Client + migrate + seed
npm run db:generate
npm run db:migrate
npm run db:seed

# 5. Start API server
npm run dev

# 6. Start Worker (new terminal)
npm run worker
```

> Server runs at http://localhost:3000  
> Swagger docs at http://localhost:3000/docs

---

## Authentication

All authenticated endpoints require a JWT Bearer token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Getting a token

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123","display_name":"User"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Device login (anonymous)
curl -X POST http://localhost:3000/api/v1/auth/device-login \
  -H "Content-Type: application/json" \
  -d '{"device_id":"unique-device-id"}'
```

All auth endpoints return `{ access_token, refresh_token, user }`.

### Default admin account (from seed)

- Email: `admin@edtronaut.ai`
- Password: `admin123`

---

## API Endpoints

### Health & System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/health/worker` | No | Worker + queue health |
| GET | `/api/v1/system/status` | No | DB + Redis connectivity |
| GET | `/api/v1/system/supported-languages` | No | List active languages |
| GET | `/api/v1/system/runtime-config` | No | Runtime configuration |

### Auth (6 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | No | Register with email/password |
| POST | `/api/v1/auth/login` | No | Login with email/password |
| POST | `/api/v1/auth/device-login` | No | Anonymous device login |
| POST | `/api/v1/auth/refresh` | No | Refresh access token |
| POST | `/api/v1/auth/logout` | Yes | Revoke refresh tokens |
| GET | `/api/v1/auth/me` | Yes | Get current user profile |

### User Profile & Settings (3 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PATCH | `/api/v1/users/me` | Yes | Update profile (display_name, avatar_url) |
| GET | `/api/v1/users/me/settings` | Yes | Get settings |
| PATCH | `/api/v1/users/me/settings` | Yes | Update settings (theme, font_size, etc.) |

### Language Packs (7 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/language-packs` | Yes | List published packs |
| GET | `/api/v1/language-packs/:pack_id` | Yes | Get pack details |
| POST | `/api/v1/language-packs/:pack_id/unlock` | Yes | Unlock a pack |
| POST | `/api/v1/language-packs/:pack_id/install` | Yes | Install a pack |
| GET | `/api/v1/users/me/language-packs` | Yes | List user's packs |
| DELETE | `/api/v1/users/me/language-packs/:pack_id` | Yes | Uninstall a pack |
| GET | `/api/v1/language-packs/:pack_id/manifest` | Yes | Get pack manifest |

### Lesson Packs (7 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/lesson-packs` | Yes | List published packs (filterable) |
| GET | `/api/v1/lesson-packs/:pack_id` | Yes | Get pack details |
| POST | `/api/v1/lesson-packs/:pack_id/unlock` | Yes | Unlock a pack |
| GET | `/api/v1/users/me/lesson-packs` | Yes | List user's packs |
| GET | `/api/v1/lesson-packs/:pack_id/manifest` | Yes | Get pack manifest |
| GET | `/api/v1/lesson-packs/:pack_id/lessons` | Yes | List lessons in pack |
| GET | `/api/v1/lessons/:lesson_id` | Yes | Get lesson details |

### Progress Tracking (6 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/users/me/progress` | Yes | Overall progress overview |
| GET | `/api/v1/users/me/progress/lesson-packs/:pack_id` | Yes | Pack progress (%) |
| GET | `/api/v1/users/me/progress/lessons/:lesson_id` | Yes | Lesson progress |
| PATCH | `/api/v1/users/me/progress/lessons/:lesson_id` | Yes | Update lesson progress |
| POST | `/api/v1/lessons/:lesson_id/complete` | Yes | Mark lesson complete |
| POST | `/api/v1/lessons/:lesson_id/unlock-next` | Yes | Unlock next lesson |

### Code Sessions (7 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/code-sessions` | Yes | Create session (playground/study) |
| GET | `/api/v1/code-sessions` | Yes | List user's sessions |
| GET | `/api/v1/code-sessions/:session_id` | Yes | Get session details |
| PATCH | `/api/v1/code-sessions/:session_id` | Yes | Autosave code |
| POST | `/api/v1/code-sessions/:session_id/autosave` | Yes | Autosave (alternate) |
| DELETE | `/api/v1/code-sessions/:session_id` | Yes | Close/delete session |

### Executions (3 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/code-sessions/:session_id/run` | Yes | Execute code |
| GET | `/api/v1/executions/:execution_id` | Yes | Get execution result |
| GET | `/api/v1/code-sessions/:session_id/executions` | Yes | List executions |

### Submissions — Study Mode (5 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/lessons/:lesson_id/submissions` | Yes | Submit code for grading |
| GET | `/api/v1/submissions/:submission_id` | Yes | Get submission |
| GET | `/api/v1/lessons/:lesson_id/submissions` | Yes | List lesson submissions |
| POST | `/api/v1/submissions/:submission_id/recheck` | Yes | Re-grade submission |
| GET | `/api/v1/submissions/:submission_id/result` | Yes | Get grading result |

### Tests & Content (4 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/lessons/:lesson_id/test-summary` | Yes | Test case summary |
| GET | `/api/v1/lessons/:lesson_id/public-tests` | Yes | Public test cases |
| POST | `/api/v1/lessons/:lesson_id/run-sample` | Yes | Run against sample tests |
| GET | `/api/v1/downloads/language-packs/:pack_id` | Yes | Download language pack |
| GET | `/api/v1/downloads/lesson-packs/:pack_id` | Yes | Download lesson pack |

### Admin (10 endpoints, requires ADMIN role)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/admin/language-packs` | Create language pack |
| PATCH | `/api/v1/admin/language-packs/:pack_id` | Update language pack |
| POST | `/api/v1/admin/language-packs/:pack_id/publish` | Publish language pack |
| POST | `/api/v1/admin/lesson-packs` | Create lesson pack |
| PATCH | `/api/v1/admin/lesson-packs/:pack_id` | Update lesson pack |
| POST | `/api/v1/admin/lesson-packs/:pack_id/publish` | Publish lesson pack |
| POST | `/api/v1/admin/lessons` | Create lesson |
| PATCH | `/api/v1/admin/lessons/:lesson_id` | Update lesson |
| POST | `/api/v1/admin/lessons/:lesson_id/test-cases` | Create test case |
| PATCH | `/api/v1/admin/test-cases/:test_case_id` | Update test case |

---

## Architecture Overview

### Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| API Framework | Fastify | ~2x throughput vs Express, built-in validation hooks, TypeScript-first |
| Auth | JWT (jsonwebtoken + bcryptjs) | Stateless auth, refresh token rotation |
| Queue | BullMQ + Redis | Node.js native, battle-tested, built-in retry/backoff/dead-letter |
| Database | PostgreSQL + Prisma ORM | ACID compliance, strong schema with FK integrity, type-safe queries |
| Validation | Zod | Runtime validation with automatic TypeScript type inference |
| Testing | Vitest | Fast, ESM-native, compatible with Fastify inject() |

### Database Schema

```
users (1) ──── (N) refresh_tokens
  │  (1) ──── (1) user_settings
  │  (1) ──── (N) user_language_packs ──── (1) language_packs
  │  (1) ──── (N) user_lesson_packs  ──── (1) lesson_packs
  │  (1) ──── (N) code_sessions
  │  (1) ──── (N) submissions
  │  (1) ──── (N) lesson_progress

language_packs (1) ──── (N) lesson_packs (1) ──── (N) lessons (1) ──── (N) test_cases
                                                    │  (1) ──── (N) submissions

supported_languages (1) ──── (N) code_sessions (1) ──── (N) code_snapshots
                    (1) ──── (N) executions    (1) ──── (N) execution_logs
                                 code_sessions (1) ──── (N) executions
```

**17 tables:** users, refresh_tokens, user_settings, language_packs, user_language_packs, lesson_packs, user_lesson_packs, lessons, test_cases, submissions, lesson_progress, supported_languages, code_sessions, code_snapshots, executions, execution_logs

### Key Enums

- **UserRole**: `USER`, `ADMIN`
- **SessionMode**: `PLAYGROUND`, `STUDY`
- **Difficulty**: `BEGINNER`, `INTERMEDIATE`, `ADVANCED`
- **LessonType**: `TUTORIAL`, `EXERCISE`, `QUIZ`, `CODING`
- **SubmissionStatus**: `PENDING`, `RUNNING`, `PASSED`, `FAILED`, `ERROR`
- **ProgressStatus**: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`

---

## Reliability & Safety

### Authentication & Authorization

| Protection | Mechanism |
|-----------|-----------|
| JWT Auth | Bearer token in Authorization header, 15min expiry |
| Refresh tokens | Rotation on use, revocation on logout |
| Role-based access | ADMIN role required for content management |
| Ownership checks | Users can only access their own sessions/data |

### Abuse Protection

| Protection | Mechanism |
|-----------|-----------|
| Rate limiting | Redis counter: max 10 executions/minute per user |
| Cooldown | 3 consecutive timeouts → block user for 60s |
| Infinite loops | SIGKILL after timeout (cannot be trapped by user code) |
| Large code | source_code max 50KB (Zod validation) |
| Output truncation | stdout/stderr truncated to 1MB |
| Session expiry | Auto-expire after 4h (configurable TTL) |

---

## Environment Variables

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
REDIS_URL=redis://localhost:6379
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN_DAYS=30
SESSION_TTL_HOURS=4
MAX_EXECUTIONS_PER_MINUTE=10
WORKER_CONCURRENCY=5
```

---

## npm Scripts

| Script | Description |
|--------|------------|
| `npm run dev` | Start API server (dev, hot reload) |
| `npm run build` | Build TypeScript to `dist/` |
| `npm start` | Start API server (production) |
| `npm run worker` | Start worker (dev) |
| `npm run worker:start` | Start worker (production) |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:migrate` | Run migrations (dev) |
| `npm run db:migrate:prod` | Run migrations (production) |
| `npm run db:seed` | Seed data (languages, packs, admin user) |
| `npm run db:reset` | Reset entire database |
| `npm test` | Run all tests |

---

## Project Structure

```
src/
├── server.ts              # Fastify app bootstrap
├── config/                # Configuration (env, database, redis)
├── controllers/           # HTTP request handlers
├── services/              # Business logic (no HTTP knowledge)
│   ├── authService.ts         # Register, login, device-login, refresh, logout
│   ├── userSettingsService.ts # User settings CRUD
│   ├── languagePackService.ts # Language pack management
│   ├── lessonPackService.ts   # Lesson pack management
│   ├── submissionService.ts   # Code submission & grading
│   ├── progressService.ts     # Learning progress tracking
│   ├── adminService.ts        # Admin content management
│   ├── sessionService.ts      # Code session CRUD + autosave
│   ├── executionService.ts    # Code execution + rate limiting
│   └── sandboxService.ts      # Sandbox code runner
├── middlewares/
│   ├── authGuard.ts       # JWT auth + admin role guard
│   └── errorHandler.ts    # Global error → HTTP response mapping
├── routes/                # Route registration (70+ endpoints)
├── types/                 # Zod validation schemas
├── utils/                 # Helpers (hashing, sanitization, AppError)
└── workers/               # BullMQ worker (code execution consumer)

prisma/                    # Database schema + migrations + seed
tests/
├── unit/                  # Unit tests (schemas, helpers)
└── integration/           # Integration tests (API + execution flow)
```

> For detailed file-by-file documentation, see [ARCHITECTURE.md](ARCHITECTURE.md).
