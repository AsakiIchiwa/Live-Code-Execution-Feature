# ARCHITECTURE.md -- Detailed System Documentation

> File-by-file, function-by-function breakdown of the Live Code Execution system.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Request Flow (End-to-End)](#2-request-flow-end-to-end)
3. [Config Layer](#3-config-layer)
4. [Types & Validation](#4-types--validation)
5. [Utilities](#5-utilities)
6. [Services (Business Logic)](#6-services-business-logic)
7. [Controllers (HTTP Layer)](#7-controllers-http-layer)
8. [Middleware](#8-middleware)
9. [Routes](#9-routes)
10. [Worker](#10-worker)
11. [Server Entry Point](#11-server-entry-point)
12. [Database Schema](#12-database-schema)
13. [Docker & Infrastructure](#13-docker--infrastructure)
14. [Security Architecture](#14-security-architecture)
15. [Scalability Considerations](#15-scalability-considerations)
16. [Trade-offs](#16-trade-offs)

---

## 1. Project Structure

```
live-code-execution/
├── prisma/
│   ├── schema.prisma          # Database schema (3NF normalized)
│   └── seed.ts                # Seed supported languages
├── src/
│   ├── config/
│   │   ├── env.ts             # Environment variable validation (Zod)
│   │   ├── database.ts        # Prisma client singleton
│   │   ├── redis.ts           # Redis + BullMQ queue setup
│   │   └── index.ts           # Barrel export
│   ├── types/
│   │   └── schemas.ts         # Zod request/response schemas
│   ├── utils/
│   │   └── helpers.ts         # Hashing, sanitization, AppError
│   ├── services/
│   │   ├── sessionService.ts  # Session CRUD + autosave + validation
│   │   ├── executionService.ts # Execution submit + rate limit + caching
│   │   ├── sandboxService.ts  # Code execution in isolated process
│   │   └── index.ts           # Barrel export
│   ├── controllers/
│   │   ├── sessionController.ts  # HTTP handlers for /code-sessions
│   │   └── executionController.ts # HTTP handlers for /executions
│   ├── middlewares/
│   │   └── errorHandler.ts    # Global error -> HTTP response mapping
│   ├── routes/
│   │   └── index.ts           # Route registration + OpenAPI schemas
│   ├── workers/
│   │   └── executionWorker.ts # BullMQ consumer (processes code jobs)
│   └── server.ts              # Fastify app bootstrap + plugin registration
├── scripts/
│   └── start-all.sh           # Combined API + Worker startup script (for single-container deploy)
├── tests/
│   ├── unit/                  # 29 unit tests (schemas, helpers)
│   └── integration/           # 21 integration tests (API + execution flow)
├── docker-compose.yml         # One-command infrastructure
├── Dockerfile                 # Multi-stage build (Debian slim)
├── package.json
├── tsconfig.json
├── prisma/tsconfig.json       # Prisma-specific TypeScript config
├── vitest.config.ts
└── .env.example
```

**Designed with Separation of Concerns:**
- `config/` -- Only connections + environment validation
- `types/` -- Only schema validation definitions
- `services/` -- Pure business logic, no HTTP knowledge
- `controllers/` -- Only parse request -> call service -> format response
- `workers/` -- Separate consumer process, can scale independently
- `middlewares/` -- Cross-cutting concerns (error handling, logging)

---

## 2. Request Flow (End-to-End)

### 2.1 Create Session

```
Client -> POST /api/v1/code-sessions
  -> routes/index.ts (route matching + Fastify JSON Schema validation)
  -> sessionController.create()
    -> Zod validates body (createSessionSchema)
    -> sessionService.create()
      -> Verify language exists & is active in supported_languages
      -> Calculate expires_at = now + SESSION_TTL_HOURS
      -> INSERT into code_sessions
    -> Return 201 { session_id, status: "ACTIVE" }
```

### 2.2 Autosave

```
Client -> PATCH /api/v1/code-sessions/:session_id
  -> sessionController.autosave()
    -> Extract x-user-id header
    -> Zod validates body (updateSessionSchema)
    -> sessionService.autosave()
      -> getValidSession() -- verify ownership, active, not expired
      -> Check version (optimistic locking)
      -> TRANSACTION:
        -> UPDATE code_sessions.source_code, version++
        -> INSERT code_snapshots (save history)
      -> cleanupSnapshots() -- delete old snapshots beyond retention limit
    -> Return 200 { session_id, status, version }
```

### 2.3 Execute Code

```
Client -> POST /api/v1/code-sessions/:session_id/run
  -> executionController.run()
    -> executionService.submitExecution()
      -> getValidSession() -- ownership, active, not expired
      -> checkRateLimit() -- Redis counter, max N/min
      -> checkCooldown() -- if 3 consecutive timeouts -> block 60s
      -> INSERT code_snapshots (snapshot current code)
      -> generateIdempotencyKey(session_id + snapshot_id + user_id)
      -> Check idempotency_key already exists? -> return existing execution
      -> TRANSACTION:
        -> INSERT executions (status=QUEUED)
        -> INSERT execution_logs (NULL -> QUEUED)
      -> executionQueue.add() -- push job to BullMQ (only execution_id)
      -> incrementRateLimit() -- increment counter in Redis
    -> Return 202 { execution_id, status: "QUEUED" }
```

### 2.4 Worker Processing

```
BullMQ dequeues job
  -> executionWorker.processJob()
    -> Fetch execution from DB (include snapshot, language, session)
    -> Verify status === QUEUED
    -> Atomic claim: UPDATE WHERE status='QUEUED' -> status='RUNNING'
      -> affected_rows === 0? Skip (another worker already claimed)
    -> INSERT execution_logs (QUEUED -> RUNNING)
    -> sandboxService.execute()
      -> Create temp directory /tmp/sandbox/{uuid}
      -> Write source code to file
      -> Spawn process with timeout + output limit
      -> Capture stdout/stderr
      -> SIGKILL on timeout (not SIGTERM -- cannot be trapped)
      -> Sanitize output (strip ANSI, control chars, truncate)
      -> Cleanup temp directory
    -> UPDATE executions (status, stdout, stderr, exit_code, timing)
    -> INSERT execution_logs (RUNNING -> COMPLETED/FAILED/TIMEOUT)
    -> Track timeout streak or reset streak
```

### 2.5 Client Polls Result

```
Client -> GET /api/v1/executions/:execution_id (poll every 1-2s)
  -> executionController.getResult()
    -> executionService.getExecution()
      -> Check Redis cache first (terminal results cached 5 min)
      -> Cache miss: query PostgreSQL (SELECT execution + logs)
      -> If COMPLETED/FAILED/TIMEOUT -> include stdout, stderr, timing
      -> Cache terminal result in Redis for subsequent polls
      -> Include lifecycle logs for transparency
    -> Return execution result
```

---

## 3. Config Layer

### `src/config/env.ts`

**Purpose:** Validate all environment variables at app start. If missing or wrong type -> crash immediately instead of runtime failure.

| Function/Export | Role |
|---|---|
| `envSchema` | Zod schema defining all env vars with type + default values |
| `config` | Object containing all validated config. Import from here, never read `process.env` directly |

**Rationale:** Crash-early is better than debugging runtime errors. Zod provides type-safe config.

### `src/config/database.ts`

**Purpose:** Prisma client singleton. Prevents creating multiple connection pools during development (hot reload).

| Export | Role |
|---|---|
| `prisma` | Single PrismaClient instance. Uses global singleton pattern |

### `src/config/redis.ts`

**Purpose:** Redis connection + BullMQ queue creation.

| Export | Role |
|---|---|
| `redisConnection` | Config object for BullMQ workers (requires `maxRetriesPerRequest: null`) |
| `redis` | IORedis instance for rate limiting, cooldown tracking, result caching |
| `executionQueue` | BullMQ Queue instance -- producer side. Enqueue jobs here |

**Important queue config:**
- `removeOnComplete: { age: 3600, count: 1000 }` -- Keep 1000 completed jobs or 1 hour, then Redis auto-cleans
- `removeOnFail: { age: 86400, count: 5000 }` -- Keep failed jobs 24h for debugging
- `backoff: exponential, delay: 2000` -- Retry after 2s, 4s, 8s...

---

## 4. Types & Validation

### `src/types/schemas.ts`

**Purpose:** Zod schemas for all request inputs. Validation happens at controller layer.

| Schema | Used In | Validation Rules |
|---|---|---|
| `createSessionSchema` | POST /code-sessions | simulation_id: UUID, user_id: UUID, language: string 1-20 chars, template_code: max 50KB |
| `updateSessionSchema` | PATCH /code-sessions/:id | source_code: max 50KB, version: positive integer |
| `runCodeSchema` | POST /code-sessions/:id/run | user_id: UUID |
| `sessionParamsSchema` | URL params | session_id: UUID |
| `executionParamsSchema` | URL params | execution_id: UUID |

**Why Zod over Joi/Yup:** Type inference (`z.infer<typeof schema>`) generates TypeScript types automatically.

---

## 5. Utilities

### `src/utils/helpers.ts`

| Function | Purpose | Details |
|---|---|---|
| `generateIdempotencyKey()` | Create SHA-256 hash from session_id + snapshot_id + user_id | Prevents duplicate executions. Same code + same user = same key -> return existing execution |
| `sanitizeOutput()` | Clean stdout/stderr before returning to client | Strip ANSI escape codes (prevent terminal injection), strip control characters (prevent XSS), truncate to max bytes |
| `AppError` | Custom error class with HTTP status code | Allows services to throw errors that controllers know how to map to status codes |

---

## 6. Services (Business Logic)

### `src/services/sessionService.ts` -- SessionService

**Purpose:** Manage the lifecycle of coding sessions.

| Method | Role | Core Logic |
|---|---|---|
| `create(input)` | Create new session | Validate language active -> calculate TTL -> INSERT |
| `autosave(sessionId, input, userId)` | Save code + create snapshot | Ownership check -> version check (optimistic lock) -> TRANSACTION(update + snapshot) -> cleanup old |
| `getById(sessionId)` | Read session | Simple SELECT + 404 if not found |
| `getValidSession(sessionId, userId)` | **Central auth gate** | Checks: exists -> ownership -> status ACTIVE -> not expired. All write operations must pass through here |
| `cleanupSnapshots(sessionId)` | Delete old snapshots | Keep N most recent snapshots (configurable), delete the rest |

**Optimistic Locking:** Client sends current `version`. If server has a different version (someone else saved) -> reject 409 Conflict. Prevents race conditions with multiple tabs/devices.

### `src/services/executionService.ts` -- ExecutionService

**Purpose:** Manage submission, rate limiting, result caching, and polling.

| Method | Role | Core Logic |
|---|---|---|
| `submitExecution(sessionId, userId)` | Submit code for execution | Full pipeline: validate -> rate limit -> cooldown -> snapshot -> idempotency -> enqueue |
| `getExecution(executionId)` | Poll result with caching | Check Redis cache first -> cache miss: query DB -> cache terminal results (5 min TTL) |
| `listBySession(sessionId, limit)` | Execution history | Recent 20 executions for a session |
| `checkRateLimit(userId)` | Redis sliding window | Max N executions/min. Key: `rate:exec:{userId}`, TTL 60s |
| `incrementRateLimit(userId)` | Increment counter | INCR + EXPIRE atomic via Redis |
| `checkCooldown(userId)` | Anti-abuse | If `cooldown:{userId}` exists and not expired -> reject 429 |
| `trackTimeout(userId)` | Count consecutive timeouts | Key: `timeout:streak:{userId}`. If streak >= 3 -> set cooldown 60s |
| `resetTimeoutStreak(userId)` | Reset streak | Delete key on successful execution |

**Result Caching:** Terminal execution results (COMPLETED/FAILED/TIMEOUT) are cached in Redis with key `exec:result:{executionId}` and a 5-minute TTL. Non-terminal states (QUEUED/RUNNING) are never cached to ensure fresh polling. This read-through cache pattern significantly reduces DB load during client polling.

**Why job payload only contains execution_id:** Security. If Redis is compromised, attacker only sees UUIDs, not source code. Worker fetches code from DB.

### `src/services/sandboxService.ts` -- SandboxService

**Purpose:** Execute code in an isolated environment.

| Method | Role | Core Logic |
|---|---|---|
| `execute(sourceCode, language)` | Entry point for code execution | Create temp dir -> write file -> spawn process -> capture output -> cleanup |
| `getCommand(language, filePath)` | Resolve runtime command | python -> `python3 -u`, javascript -> `node --max-old-space-size=256`, etc. |
| `runProcess(command, args, opts)` | Spawn + monitor process | Hard timeout SIGKILL, capture stdout/stderr with size limit, track timing |
| `cleanup(dir)` | Delete temp directory | rmSync recursive, always runs (finally block) |

**SIGKILL vs SIGTERM:** Uses SIGKILL because user code can trap SIGTERM (Python: `signal.signal(SIGTERM, handler)`). SIGKILL cannot be trapped -> guaranteed kill.

**Production upgrade path:** Replace `spawn()` with Docker container + nsjail:
- `docker run --network=none --read-only --memory=256m --cpus=0.5 --pids-limit=10 sandbox-python:3.12`
- nsjail adds syscall whitelist, user namespace isolation

---

## 7. Controllers (HTTP Layer)

### `src/controllers/sessionController.ts`

| Method | Route | Role |
|---|---|---|
| `create()` | POST /code-sessions | Parse body -> sessionService.create() -> 201 |
| `autosave()` | PATCH /code-sessions/:id | Parse body + params + header -> sessionService.autosave() |
| `getById()` | GET /code-sessions/:id | Parse params -> sessionService.getById() -> format response |
| `extractUserId()` | (private) | Read `x-user-id` header. Production: will come from JWT middleware |

### `src/controllers/executionController.ts`

| Method | Route | Role |
|---|---|---|
| `run()` | POST /code-sessions/:id/run | Parse params + header -> executionService.submitExecution() -> 202 |
| `getResult()` | GET /executions/:id | Parse params -> executionService.getExecution() |
| `listBySession()` | GET /code-sessions/:id/executions | Parse params -> executionService.listBySession() |

**Controller rules:** No business logic. Only: validate input -> call service -> format output.

---

## 8. Middleware

### `src/middlewares/errorHandler.ts`

**Purpose:** Map all error types to standardized HTTP responses.

| Error Type | HTTP Status | Response Format |
|---|---|---|
| `ZodError` | 400 | `{ error: "VALIDATION_ERROR", details: [...] }` |
| Fastify `FST_ERR_VALIDATION` | 400 | `{ error: "VALIDATION_ERROR", details: [...] }` -- from route JSON Schema validation |
| `AppError` | Custom (400/401/403/404/409/429) | `{ error: code, message }` |
| Fastify errors (rate limit, payload) | Varies | `{ error: code, message }` |
| Unknown errors | 500 | `{ error: "INTERNAL_ERROR", message: "An unexpected error occurred" }` -- **never leaks stack traces** |

---

## 9. Routes

### `src/routes/index.ts`

**Purpose:** Register all routes on the Fastify instance with OpenAPI schema definitions.

| Route | Method | Controller | OpenAPI Tag |
|---|---|---|---|
| `/health` | GET | Inline (status, uptime) | Health |
| `/health/worker` | GET | Inline (queue + Redis + DB check) | Health |
| `/api/v1/code-sessions` | POST | sessionController.create | Sessions |
| `/api/v1/code-sessions/:session_id` | PATCH | sessionController.autosave | Sessions |
| `/api/v1/code-sessions/:session_id` | GET | sessionController.getById | Sessions |
| `/api/v1/code-sessions/:session_id/run` | POST | executionController.run | Executions |
| `/api/v1/code-sessions/:session_id/executions` | GET | executionController.listBySession | Executions |
| `/api/v1/executions/:execution_id` | GET | executionController.getResult | Executions |

Each route includes a Fastify JSON Schema definition for request body, params, headers, and response types. These schemas are used by `@fastify/swagger` to auto-generate the OpenAPI 3.0.3 specification.

**API versioning:** `/api/v1/` prefix for backward compatibility when adding v2.

**Worker health check (`/health/worker`):** Checks queue job counts (waiting/active/completed/failed), Redis connectivity (`PING`), and PostgreSQL connectivity (`SELECT 1`). Returns `"ok"` or `"degraded"` with error details.

---

## 10. Worker

### `src/workers/executionWorker.ts`

**Purpose:** BullMQ consumer process -- runs separately from the API server.

| Component | Role |
|---|---|
| `WORKER_ID` | Short UUID, attached to all logs + DB records for tracing which worker handled which job |
| `processJob()` | Main handler: fetch execution -> claim (atomic) -> sandbox.execute() -> update result |
| `worker` (BullMQ Worker) | Consumer instance, concurrency configurable via `WORKER_CONCURRENCY` env var |
| Graceful shutdown | SIGTERM/SIGINT -> wait for current jobs to finish -> close connections |

**Atomic claim pattern:**
```sql
UPDATE executions SET status='RUNNING', worker_id='...'
WHERE id='{id}' AND status='QUEUED'
```
If `affected_rows = 0` -> another worker already claimed -> skip. Prevents duplicate processing with multiple workers.

**Retry logic:** BullMQ auto-retries if `processJob()` throws an error. Config: max 3 attempts, exponential backoff (2s, 4s, 8s). After max retries -> job moves to failed queue.

---

## 11. Server Entry Point

### `src/server.ts`

| Function | Role |
|---|---|
| `buildApp()` | Create Fastify instance + register plugins + routes. Separated for testability |
| `start()` | Connect DB -> start server -> setup graceful shutdown |

**Plugins registered (in order):**
1. `@fastify/cors` -- Production: only allow `edtronaut.ai` domains
2. `@fastify/helmet` -- Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
3. `@fastify/swagger` -- OpenAPI 3.0.3 spec generation from route schemas
4. `@fastify/swagger-ui` -- Interactive API docs at `/docs`
5. `@fastify/rate-limit` -- In-memory rate limit (use Redis store in production with multiple API instances)
6. `bodyLimit: 1MB` -- Reject oversized code uploads

---

## 12. Database Schema

### Normalized 3NF Design

```
supported_languages (1) <---- (N) code_sessions (1) <---- (N) code_snapshots
                    (1) <---- (N) executions    (1) <---- (N) execution_logs
                                  code_sessions (1) <---- (N) executions
                                  code_snapshots(1) <---- (N) executions
```

### Table Details

**`supported_languages`** -- Reference table
- Centrally manages supported languages. Adding Go, Rust = just INSERT 1 row.
- `docker_image` -- worker knows which container to use (production)
- `is_active` -- disable a language without deleting data
- **3NF:** No transitive dependency. All other tables reference via FK `language_id`

**`code_sessions`** -- Core entity
- `version` -- optimistic locking for autosave
- `expires_at` -- session TTL, auto-expire after 4h
- `source_code` -- current (latest) code; snapshot stores history separately

**`code_snapshots`** -- Autosave history (separated from session for 3NF)
- Each autosave creates 1 snapshot
- `UNIQUE(session_id, version)` -- no duplicates
- Retention: keep 50 most recent, delete older
- **Why separate:** Session only holds latest code. History is a separate concern. Execution points to a specific snapshot -> results map exactly to the code that ran.

**`executions`** -- Execution records
- `snapshot_id` FK -- knows exactly which code was executed
- `idempotency_key` UNIQUE -- prevents duplicate executions
- `worker_id` -- traces which worker handled the job
- `retry_count` / `max_retries` -- retry tracking

**`execution_logs`** -- State transition audit trail
- `from_status` -> `to_status`: records state transitions
- `metadata` JSONB: error details, timing, worker info
- Used for debugging, monitoring, and auditing

---

## 13. Docker & Infrastructure

### `Dockerfile`

Multi-stage build using `node:20-slim` (Debian-based) for OpenSSL 3.x compatibility with Prisma:
1. **Builder stage:** Install `openssl` + deps -> generate Prisma -> compile TypeScript
2. **Production stage:** Copy only `dist/` + `node_modules/` + `prisma/` + `scripts/`
   - `tini` as PID 1 -- handles signals properly, reaps zombie processes
   - Non-root user `appuser` (uid 1001)
   - Python3 installed for sandbox execution
   - `openssl` + `ca-certificates` for Prisma engine compatibility

### `scripts/start-all.sh`

Combined startup script for running API server + Worker in a single container (cost-effective for free-tier deployment):
1. Runs `prisma migrate deploy` (database migrations)
2. Seeds supported languages via inline Node.js script (idempotent upsert)
3. Starts API server (`node dist/server.js`) in background
4. Starts Worker (`node dist/workers/executionWorker.js`) in background
5. Handles graceful shutdown via SIGTERM/SIGINT trap

### `docker-compose.yml`

| Service | Port | Role |
|---|---|---|
| `postgres` | 5432 | Database, healthcheck via `pg_isready` |
| `redis` | 6379 | Queue + rate limiting + result caching, maxmemory 256MB, LRU eviction |
| `api` | 3000 | Fastify server, runs migrate + seed before start |
| `worker` | -- | BullMQ consumer, no exposed port |

**Startup order:** postgres healthy -> redis healthy -> api (migrate + seed + serve) + worker

---

## 14. Security Architecture

### Layer 1 -- Network (Nginx/API Gateway)
- Request body size: 1MB max
- Rate limit: configurable req/min per IP
- CORS: only edtronaut.ai domains in production
- Helmet security headers

### Layer 2 -- Application
- **Input validation:** Zod schemas on all inputs; source_code max 50KB
- **Fastify schema validation:** JSON Schema on all routes for params, body, headers
- **Ownership check:** `getValidSession()` verifies `session.user_id === request.user_id` -- cannot access another user's session
- **Session expiry:** TTL 4h, automatically EXPIRED
- **Optimistic locking:** Version check prevents race conditions
- **Rate limiting:** Redis counter, max 10 executions/min per user
- **Cooldown:** 3 consecutive timeouts -> block 60s

### Layer 3 -- Queue
- **Job payload = execution_id only** -- source code never sent through Redis
- **Atomic claim:** `UPDATE WHERE status='QUEUED'` -- prevents duplicate processing
- **Job TTL:** 5 minutes in queue, then auto-expires

### Layer 4 -- Sandbox (Production)
- No network access (`--network=none`)
- Read-only filesystem (write only /tmp, 10MB limit)
- PID limit = 10 (prevents fork bombs)
- Syscall whitelist (~40 syscalls)
- SIGKILL timeout (cannot be trapped)
- Stdout/stderr truncate 1MB
- Unprivileged user (uid 65534)
- Separate user namespace

### Layer 5 -- Data
- Output sanitized (strip ANSI, control characters)
- Source code not logged to application logs
- Error responses never leak stack traces or internals

---

## 15. Scalability Considerations

### Horizontal Scaling

| Component | Scale Method | Bottleneck |
|---|---|---|
| API servers | Load balancer (Nginx/ALB) + add instances | Stateless, scales linearly |
| Workers | Add worker instances | Container spawn time -> pre-warm pool |
| PostgreSQL | Read replicas for GET requests | Write throughput -> PgBouncer |
| Redis | Cluster mode for high throughput | Memory -> eviction policy |

### Performance Estimates

- API latency: ~5-20ms (create/autosave/poll)
- Execution latency: 100ms-10s (depends on code)
- Queue throughput: ~1000 jobs/s per Redis instance
- Autosave frequency: debounce 3s client-side -> ~20 writes/min/session

### Potential Bottlenecks

1. **Container cold start** -> Mitigate: pre-warmed pool
2. **DB writes during peak** -> Mitigate: PgBouncer, batch snapshots
3. **Redis memory** -> Mitigate: TTL on all keys, LRU eviction
4. **Large stdout** -> Mitigate: truncate 1MB, stream instead of buffer

---

## 16. Trade-offs

| Decision | Optimized For | Trade-off |
|---|---|---|
| **Polling instead of WebSocket** | Simplicity, stateless API, easy to scale | 1-2s delay, extra bandwidth. Upgrade: SSE/WebSocket |
| **Snapshot per autosave** | Audit trail, execution accuracy | Storage cost. Mitigate: retention policy 50 snapshots |
| **Job payload = ID only** | Security (code not exposed via Redis) | Extra DB query/job. Acceptable cost |
| **SIGKILL instead of SIGTERM** | Guaranteed kill, user cannot trap | No graceful shutdown. Acceptable for sandbox |
| **Optimistic locking (version)** | Prevents race condition on autosave | Client must handle 409 retry. Trade-off UX vs correctness |
| **Fastify over Express** | Performance (~2x throughput) | Smaller ecosystem than Express. Acceptable |
| **BullMQ over RabbitMQ** | Node.js native, less infrastructure | Depends on Redis stability. Mitigate: Redis persistence |
| **PostgreSQL over MongoDB** | ACID, strong schema, FK integrity | Less flexible for unstructured. Mitigate: JSONB columns |
| **Separate API + Worker process** | Independent scaling, fault isolation | More deployment complexity. Mitigate: docker-compose |
| **3NF database** | No data duplication, clean queries | More JOINs. Negligible performance cost |
| **Redis result caching** | Reduces DB load during polling | Slightly stale data (5 min TTL). Only for terminal states |
