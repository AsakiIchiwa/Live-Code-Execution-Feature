# ARCHITECTURE.md — Detailed System Documentation

> File-by-file, function-by-function breakdown of the EdStronaunt Live Code Execution system.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Request Flow (End-to-End)](#2-request-flow-end-to-end)
3. [Config Layer](#3-config-layer)
4. [Types & Validation](#4-types--validation)
5. [Utilities](#5-utilities)
6. [Middleware](#6-middleware)
7. [Services (Business Logic)](#7-services-business-logic)
8. [Controllers (HTTP Layer)](#8-controllers-http-layer)
9. [Routes](#9-routes)
10. [Worker](#10-worker)
11. [Server Entry Point](#11-server-entry-point)
12. [Database Schema](#12-database-schema)
13. [Docker & Infrastructure](#13-docker--infrastructure)
14. [Security Architecture](#14-security-architecture)

---

## 1. Project Structure

```
live-code-execution/
├── prisma/
│   ├── schema.prisma          # Database schema (17 tables, 6 enums)
│   ├── seed.ts                # Seed languages, packs, lessons, admin user
│   └── migrations/            # PostgreSQL migrations
├── src/
│   ├── config/
│   │   ├── env.ts             # Environment variable validation (Zod)
│   │   ├── database.ts        # Prisma client singleton
│   │   ├── redis.ts           # Redis + BullMQ queue setup
│   │   └── index.ts           # Barrel export
│   ├── types/
│   │   └── schemas.ts         # Zod request/response schemas (all endpoints)
│   ├── utils/
│   │   └── helpers.ts         # Hashing, sanitization, AppError
│   ├── services/
│   │   ├── authService.ts         # Register, login, device-login, refresh, logout
│   │   ├── userSettingsService.ts # Get/update user settings
│   │   ├── languagePackService.ts # Language pack unlock/install/manifest
│   │   ├── lessonPackService.ts   # Lesson pack list/unlock/lessons
│   │   ├── submissionService.ts   # Code submission & test-case grading
│   │   ├── progressService.ts     # Learning progress tracking
│   │   ├── adminService.ts        # Admin CRUD for packs/lessons/test-cases
│   │   ├── sessionService.ts      # Session CRUD + autosave + validation
│   │   ├── executionService.ts    # Execution submit + rate limit + caching
│   │   ├── sandboxService.ts      # Code execution in isolated process
│   │   └── index.ts               # Barrel export
│   ├── controllers/
│   │   ├── sessionController.ts   # HTTP handlers for /code-sessions
│   │   └── executionController.ts # HTTP handlers for /executions
│   ├── middlewares/
│   │   ├── authGuard.ts       # JWT Bearer token verification + admin guard
│   │   └── errorHandler.ts    # Global error -> HTTP response mapping
│   ├── routes/
│   │   └── index.ts           # 70+ route registrations + OpenAPI schemas
│   ├── workers/
│   │   └── executionWorker.ts # BullMQ consumer (processes code jobs)
│   └── server.ts              # Fastify app bootstrap + plugin registration
├── scripts/
│   └── start-all.sh           # Combined API + Worker startup (single-container)
├── tests/
│   ├── unit/                  # Unit tests (schemas, helpers)
│   └── integration/           # Integration tests (API + execution flow)
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

**Separation of Concerns:**
- `config/` — Only connections + environment validation
- `types/` — Only schema validation definitions
- `services/` — Pure business logic, no HTTP knowledge
- `controllers/` — Only parse request → call service → format response
- `middlewares/` — Cross-cutting concerns (auth, error handling)
- `workers/` — Separate consumer process, scales independently

---

## 2. Request Flow (End-to-End)

### 2.1 Authentication Flow

```
Client -> POST /api/v1/auth/register (or /login or /device-login)
  -> routes/index.ts (route matching)
  -> Zod validates body
  -> authService.register() / login() / deviceLogin()
    -> Hash password (bcrypt, cost 12)
    -> INSERT user + user_settings (transaction)
    -> Generate JWT access_token (15min, HS256)
    -> Generate refresh_token (UUID, stored in DB, 30 day expiry)
  -> Return { user, access_token, refresh_token }
```

### 2.2 Authenticated Request Flow

```
Client -> Any protected endpoint
  -> Authorization: Bearer <token>
  -> authGuard middleware
    -> Extract token from header
    -> jwt.verify(token, JWT_SECRET)
    -> Attach { userId, role } to request.currentUser
  -> Controller handler
    -> getCurrentUserId(request) extracts userId
    -> Call service with userId
```

### 2.3 Create Code Session

```
Client -> POST /api/v1/code-sessions
  -> authGuard (JWT verification)
  -> sessionController.create()
    -> Zod validates body (language, title, mode, template_code)
    -> sessionService.create()
      -> Verify language exists & is active
      -> Calculate expires_at = now + SESSION_TTL_HOURS
      -> INSERT code_session with user_id from JWT
    -> Return 201 { session_id, title, mode, status: "ACTIVE" }
```

### 2.4 Autosave

```
Client -> PATCH /api/v1/code-sessions/:session_id
  -> authGuard
  -> sessionController.autosave()
    -> sessionService.autosave()
      -> getValidSession() — verify ownership, active, not expired
      -> Check version (optimistic locking)
      -> TRANSACTION:
        -> UPDATE code_sessions.source_code, version++
        -> INSERT code_snapshots (save history)
      -> cleanupSnapshots() — keep latest 50
    -> Return 200 { session_id, status, version }
```

### 2.5 Execute Code

```
Client -> POST /api/v1/code-sessions/:session_id/run
  -> authGuard
  -> executionController.run()
    -> executionService.submitExecution()
      -> getValidSession() — ownership, active, not expired
      -> checkRateLimit() — Redis counter, max N/min
      -> checkCooldown() — 3 consecutive timeouts → block 60s
      -> Snapshot current code, generate idempotency key
      -> TRANSACTION: INSERT execution (status=QUEUED) + log
      -> Enqueue job to BullMQ (payload = execution_id only)
    -> Return 202 { execution_id, status: "QUEUED" }
```

### 2.6 Submit for Grading (Study Mode)

```
Client -> POST /api/v1/lessons/:lesson_id/submissions
  -> authGuard
  -> submissionService.submit()
    -> Fetch lesson + test cases
    -> INSERT submission (status=PENDING)
    -> For each test case:
      -> Run code via sandboxService
      -> Compare output with expected
    -> UPDATE submission (PASSED/FAILED + results JSON)
    -> Auto-update lesson_progress
  -> Return { submission_id, status, results }
```

---

## 3. Config Layer

### `src/config/env.ts`

Validates all environment variables at app start using Zod. Crash-early on missing/invalid config.

| Export | Role |
|---|---|
| `config` | Validated config object. Includes: `DATABASE_URL`, `REDIS_URL`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN_DAYS`, `SESSION_TTL_HOURS`, `MAX_EXECUTIONS_PER_MINUTE`, `WORKER_CONCURRENCY` |

### `src/config/database.ts`

Prisma client singleton. Prevents multiple connection pools during hot reload.

### `src/config/redis.ts`

| Export | Role |
|---|---|
| `redisConnection` | Config object for BullMQ workers |
| `redis` | IORedis instance for rate limiting, cooldown, caching |
| `executionQueue` | BullMQ Queue instance (producer side) |

---

## 4. Types & Validation

### `src/types/schemas.ts`

All Zod schemas for request validation. Key schemas:

| Schema | Endpoint | Key Fields |
|---|---|---|
| `registerSchema` | POST /auth/register | email, password (min 6), display_name |
| `loginSchema` | POST /auth/login | email, password |
| `deviceLoginSchema` | POST /auth/device-login | device_id |
| `refreshTokenSchema` | POST /auth/refresh | refresh_token |
| `updateProfileSchema` | PATCH /users/me | display_name?, avatar_url? |
| `updateSettingsSchema` | PATCH /users/me/settings | default_language?, editor_theme?, font_size?, auto_save?, preferred_mode? |
| `createSessionSchema` | POST /code-sessions | language, title?, mode?, template_code?, lesson_id? |
| `updateSessionSchema` | PATCH /code-sessions/:id | source_code (max 50KB), version (positive int) |
| `listSessionsSchema` | GET /code-sessions | page?, limit?, mode? |
| `submitCodeSchema` | POST /lessons/:id/submissions | source_code (max 50KB), language |
| `createLangPackSchema` | POST /admin/language-packs | code, name, description?, version?, is_free? |
| `createLessonPackSchema` | POST /admin/lesson-packs | language_pack_id, title, description?, difficulty? |
| `createLessonSchema` | POST /admin/lessons | lesson_pack_id, title, instructions, type?, difficulty? |
| `createTestCaseSchema` | POST /admin/lessons/:id/test-cases | input?, expected, is_public?, is_hidden?, order_index? |

---

## 5. Utilities

### `src/utils/helpers.ts`

| Function | Purpose |
|---|---|
| `generateIdempotencyKey()` | SHA-256 hash from session_id + snapshot_id + user_id. Prevents duplicate executions |
| `sanitizeOutput()` | Strip ANSI escape codes + control characters, truncate to max bytes |
| `AppError` | Custom error class with HTTP status code + error code |

---

## 6. Middleware

### `src/middlewares/authGuard.ts`

JWT authentication middleware for Fastify.

| Export | Role |
|---|---|
| `authGuard` | Fastify preHandler. Extracts Bearer token → `jwt.verify()` → attaches `request.currentUser = { userId, role }`. Throws 401 on invalid/missing token |
| `adminGuard` | Fastify preHandler. Checks `request.currentUser.role === 'ADMIN'`. Throws 403 if not admin |
| `getCurrentUserId()` | Helper to extract userId from verified request. Throws 401 if not authenticated |

### `src/middlewares/errorHandler.ts`

Maps all error types to standardized HTTP responses:

| Error Type | HTTP Status | Response |
|---|---|---|
| `ZodError` | 400 | `{ error: "VALIDATION_ERROR", details: [...] }` |
| `AppError` | Custom | `{ error: code, message }` |
| Fastify validation | 400 | `{ error: "VALIDATION_ERROR", details: [...] }` |
| Unknown | 500 | `{ error: "INTERNAL_ERROR" }` — never leaks stack traces |

---

## 7. Services (Business Logic)

### `src/services/authService.ts` — AuthService

| Method | Role |
|---|---|
| `register(input)` | Check email unique → bcrypt hash (cost 12) → create user + settings → generate tokens |
| `login(input)` | Find by email → bcrypt compare → update last_login → generate tokens |
| `deviceLogin(input)` | Find or create anonymous user by device_id → generate tokens |
| `refreshToken(token)` | Validate refresh token → revoke old → issue new pair (rotation) |
| `logout(userId)` | Revoke all user's refresh tokens |
| `getMe(userId)` | Return user profile with settings |
| `updateProfile(userId, input)` | Update display_name, avatar_url |

### `src/services/userSettingsService.ts` — UserSettingsService

| Method | Role |
|---|---|
| `get(userId)` | Return user settings or defaults |
| `update(userId, input)` | Upsert settings (default_language, editor_theme, font_size, auto_save, preferred_mode) |

### `src/services/languagePackService.ts` — LanguagePackService

| Method | Role |
|---|---|
| `list()` | List all published language packs |
| `getById(id)` | Get pack details |
| `unlock(packId, userId)` | Upsert user_language_pack with is_unlocked=true |
| `install(packId, userId)` | Set is_installed=true + installed_at |
| `getUserPacks(userId)` | List user's unlocked/installed packs |
| `uninstall(packId, userId)` | Set is_installed=false |
| `getManifest(packId)` | Return version + manifest JSON |

### `src/services/lessonPackService.ts` — LessonPackService

| Method | Role |
|---|---|
| `list(query)` | List published packs with filters (language, difficulty, free_only) + pagination |
| `getById(id)` | Get pack details with language info |
| `unlock(packId, userId)` | Upsert user_lesson_pack with is_unlocked=true |
| `getUserPacks(userId)` | List user's unlocked packs |
| `getManifest(packId)` | Return version + manifest + total_lessons |
| `getLessons(packId)` | List published lessons in pack (ordered) |
| `getLesson(lessonId)` | Get full lesson details |

### `src/services/submissionService.ts` — SubmissionService

| Method | Role |
|---|---|
| `submit(lessonId, userId, input)` | Create submission → run code against test cases → grade → update progress |
| `getById(submissionId)` | Get submission details |
| `listByLesson(lessonId, userId)` | List user's submissions for a lesson |
| `getResult(submissionId)` | Get grading results |
| `recheck(submissionId)` | Re-run submission against current test cases |

### `src/services/progressService.ts` — ProgressService

| Method | Role |
|---|---|
| `getOverview(userId)` | Aggregate progress across all lesson packs |
| `getPackProgress(packId, userId)` | Calculate completion percentage |
| `getLessonProgress(lessonId, userId)` | Get lesson-level progress |
| `updateProgress(lessonId, userId, input)` | Update progress status + time_spent |
| `completeLesson(lessonId, userId)` | Mark lesson COMPLETED |
| `unlockNext(lessonId, userId)` | Find next lesson by order_index → create NOT_STARTED progress |

### `src/services/adminService.ts` — AdminService

| Method | Role |
|---|---|
| `createLanguagePack(input)` | Create unpublished language pack |
| `updateLanguagePack(id, input)` | Update pack fields |
| `publishLanguagePack(id)` | Set is_published=true |
| `createLessonPack(input)` | Create unpublished lesson pack |
| `updateLessonPack(id, input)` | Update pack fields |
| `publishLessonPack(id)` | Count lessons → set total_lessons → publish |
| `createLesson(input)` | Create lesson in pack |
| `updateLesson(id, input)` | Update lesson fields |
| `createTestCase(lessonId, input)` | Create test case for lesson |
| `updateTestCase(id, input)` | Update test case |

### `src/services/sessionService.ts` — SessionService

| Method | Role |
|---|---|
| `create(input, userId)` | Validate language → create session with title, mode (PLAYGROUND/STUDY), optional lessonId |
| `autosave(sessionId, input, userId)` | Ownership check → version check → TRANSACTION(update + snapshot) → cleanup |
| `listByUser(userId, query)` | Paginated session list for user |
| `getById(sessionId)` | Get session with language details |
| `delete(sessionId, userId)` | Ownership check → set status CLOSED |
| `getValidSession(sessionId, userId)` | Central auth gate: exists → ownership → active → not expired |

### `src/services/executionService.ts` — ExecutionService

| Method | Role |
|---|---|
| `submitExecution(sessionId, userId)` | Full pipeline: validate → rate limit → cooldown → snapshot → idempotency → enqueue |
| `getExecution(executionId)` | Redis cache check → DB fallback → cache terminal results |
| `listBySession(sessionId, limit)` | Recent executions for a session |
| `trackTimeout(userId)` | Count consecutive timeouts → set cooldown if streak ≥ 3 |

### `src/services/sandboxService.ts` — SandboxService

| Method | Role |
|---|---|
| `execute(sourceCode, language)` | Create temp dir → write file → spawn process → capture output → cleanup |
| `getCommand(language, filePath)` | Resolve runtime (python3, node, javac+java, g++) |
| `runProcess(command, args, opts)` | Spawn with timeout SIGKILL, capture stdout/stderr, track timing |

---

## 8. Controllers (HTTP Layer)

### `src/controllers/sessionController.ts`

| Method | Route | Role |
|---|---|---|
| `create()` | POST /code-sessions | Parse body → getCurrentUserId() → sessionService.create() → 201 |
| `autosave()` | PATCH /code-sessions/:id | Parse body + params → sessionService.autosave() |
| `getById()` | GET /code-sessions/:id | Parse params → sessionService.getById() |
| `list()` | GET /code-sessions | Parse query → sessionService.listByUser() |
| `delete()` | DELETE /code-sessions/:id | Parse params → sessionService.delete() |
| `autosaveEndpoint()` | POST /code-sessions/:id/autosave | Alternative autosave via POST |

### `src/controllers/executionController.ts`

| Method | Route | Role |
|---|---|---|
| `run()` | POST /code-sessions/:id/run | getCurrentUserId() → executionService.submitExecution() → 202 |
| `getResult()` | GET /executions/:id | executionService.getExecution() |
| `listBySession()` | GET /code-sessions/:id/executions | executionService.listBySession() |

---

## 9. Routes

### `src/routes/index.ts`

70+ endpoints organized by feature group. All authenticated routes use `preHandler: [authGuard]`, admin routes additionally use `adminGuard`.

| Route Group | # Endpoints | Auth | Description |
|---|---|---|---|
| Health | 2 | No | `/health`, `/health/worker` |
| Auth | 6 | Mixed | Register, login, device-login, refresh, logout, me |
| User Settings | 3 | Yes | Profile update, get/update settings |
| Language Packs | 7 | Yes | List, detail, unlock, install, uninstall, manifest |
| Lesson Packs | 7 | Yes | List, detail, unlock, user packs, manifest, lessons |
| Progress | 6 | Yes | Overview, pack progress, lesson progress, complete, unlock-next |
| Code Sessions | 7 | Yes | CRUD + autosave + list |
| Executions | 3 | Yes | Run, get result, list by session |
| Submissions | 5 | Yes | Submit, get, list, recheck, result |
| Tests & Content | 4 | Yes | Test summary, public tests, run sample, downloads |
| Admin | 10 | Admin | CRUD for language packs, lesson packs, lessons, test cases |
| System | 3 | No | Status, supported languages, runtime config |

---

## 10. Worker

### `src/workers/executionWorker.ts`

BullMQ consumer process — runs separately from the API server.

| Component | Role |
|---|---|
| `WORKER_ID` | Short UUID for tracing which worker handled which job |
| `processJob()` | Fetch execution → atomic claim (WHERE status='QUEUED') → sandbox.execute() → update result |
| Graceful shutdown | SIGTERM/SIGINT → wait for current jobs → close connections |

**Atomic claim:** `UPDATE WHERE status='QUEUED' → RUNNING`. If affected_rows=0, another worker claimed it → skip.

---

## 11. Server Entry Point

### `src/server.ts`

| Function | Role |
|---|---|
| `buildApp()` | Create Fastify instance + register plugins + routes |
| `start()` | Connect DB → start server → setup graceful shutdown |

**Plugins (in order):**
1. `@fastify/cors` — Allow DELETE, Authorization header
2. `@fastify/helmet` — Security headers
3. `@fastify/swagger` — OpenAPI 3.0.3 spec with tags for all route groups
4. `@fastify/swagger-ui` — Interactive docs at `/docs`
5. `@fastify/rate-limit` — Request-level rate limiting
6. `bodyLimit: 1MB`

---

## 12. Database Schema

### 17 Tables + 6 Enums

**Core Auth:**
- `users` — email, password_hash, display_name, role (USER/ADMIN), is_anonymous, device_id
- `refresh_tokens` — token rotation with expiry + revocation
- `user_settings` — per-user preferences (theme, font, language, mode)

**Content System:**
- `language_packs` — code, name, version, is_builtin, is_free, is_published, manifest (JSONB)
- `user_language_packs` — unlock/install state per user
- `lesson_packs` — title, difficulty, total_lessons, is_free, is_published
- `user_lesson_packs` — unlock state per user
- `lessons` — title, instructions, starter_code, expected_output, type, difficulty, order_index
- `test_cases` — input, expected output, is_public, is_hidden

**Learning:**
- `submissions` — source_code, language, status (PENDING→PASSED/FAILED), results (JSONB)
- `lesson_progress` — status (NOT_STARTED→IN_PROGRESS→COMPLETED), best_score, attempts

**Code Execution:**
- `supported_languages` — name, version, docker_image, file_extension, timeout, memory limits
- `code_sessions` — title, mode (PLAYGROUND/STUDY), source_code, version (optimistic lock), expires_at
- `code_snapshots` — autosave history (50 per session)
- `executions` — status, stdout, stderr, exit_code, timing, idempotency_key
- `execution_logs` — state transition audit trail with JSONB metadata

---

## 13. Docker & Infrastructure

### `docker-compose.yml`

| Service | Port | Role |
|---|---|---|
| `postgres` | 5432 | Database, healthcheck via `pg_isready` |
| `redis` | 6379 | Queue + rate limiting + caching, maxmemory 256MB |
| `api` | 3000 | Fastify server |
| `worker` | — | BullMQ consumer |

### `Dockerfile`

Multi-stage build using `node:20-slim`:
1. **Builder:** Install deps → generate Prisma → compile TypeScript
2. **Production:** Copy dist + node_modules + prisma. `tini` as PID 1, non-root user

---

## 14. Security Architecture

### Layer 1 — Authentication
- JWT Bearer tokens (HS256, 15min expiry)
- Refresh token rotation (revoke on use)
- bcrypt password hashing (cost 12)
- Anonymous device-based login
- Admin role guard for content management

### Layer 2 — Application
- Zod validation on all inputs; source_code max 50KB
- Ownership checks: users can only access their own data
- Optimistic locking for concurrent autosave
- Session expiry (4h TTL)

### Layer 3 — Execution Safety
- Rate limit: 10 executions/min per user (Redis counter)
- Cooldown: 3 consecutive timeouts → block 60s
- SIGKILL on timeout (cannot be trapped)
- stdout/stderr truncated to 1MB
- Job payload = ID only (source code never in Redis)

### Layer 4 — Network
- Fastify bodyLimit 1MB
- Helmet security headers
- CORS configuration
- Request-level rate limiting
