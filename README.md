# Live Code Execution Backend

Secure live code execution backend for the Edtronaut Job Simulation Platform. Learners can create coding sessions, write/autosave code, submit for execution, and poll results -- all through a RESTful API.

## Requirements

- **Node.js** >= 20
- **Docker** + **Docker Compose** (for PostgreSQL and Redis)

---

## Setup Instructions

### Option 1: Docker (simplest -- one command)

```bash
# Start everything (PostgreSQL, Redis, API, Worker)
docker compose up --build -d

# Verify: open http://localhost:3000/health

# Stop everything
docker compose down -v
```

### Option 2: Local development

#### Step 1: Install dependencies

```bash
npm install
```

#### Step 2: Create config file

```bash
cp .env.example .env
```

#### Step 3: Start PostgreSQL + Redis

```bash
docker compose up postgres redis -d
```

#### Step 4: Generate Prisma Client + run migrations + seed data

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

#### Step 5: Start API server

```bash
npm run dev
```

> Server runs at http://localhost:3000

#### Step 6: Start Worker (open a new terminal)

```bash
npm run worker
```

> Worker processes code execution jobs from the queue.

---

## Running Tests

```bash
# Unit tests only (no database needed)
npm test -- tests/unit

# All tests (requires PostgreSQL + Redis running)
npm test
```

Test results: **50 tests** (29 unit + 21 integration), 0 skipped, 0 failed.

---

## Architecture Overview

### Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| API Framework | Fastify | ~2x throughput vs Express, built-in validation hooks, TypeScript-first |
| Queue | BullMQ + Redis | Node.js native, battle-tested, built-in retry/backoff/dead-letter |
| Database | PostgreSQL + Prisma ORM | ACID compliance, strong schema with FK integrity, type-safe queries |
| Validation | Zod | Runtime validation with automatic TypeScript type inference |
| Testing | Vitest | Fast, ESM-native, compatible with Fastify inject() |

### End-to-End Request Flow

```
1. CREATE SESSION
   Client -> POST /api/v1/code-sessions
     -> Zod validates body (simulation_id, user_id, language)
     -> Verify language exists in supported_languages table
     -> INSERT code_sessions (status=ACTIVE, expires_at=now+4h)
     -> Return { session_id, status: "ACTIVE" }

2. AUTOSAVE
   Client -> PATCH /api/v1/code-sessions/:session_id
     -> Verify ownership (x-user-id header == session.user_id)
     -> Optimistic locking: check version matches
     -> TRANSACTION: UPDATE source_code + version++, INSERT code_snapshot
     -> Cleanup old snapshots (keep latest 50)
     -> Return { session_id, version }

3. EXECUTE CODE
   Client -> POST /api/v1/code-sessions/:session_id/run
     -> Verify ownership + session active + not expired
     -> Rate limit check (Redis counter, max 10/min per user)
     -> Cooldown check (3 consecutive timeouts -> block 60s)
     -> Snapshot current code, generate idempotency key
     -> TRANSACTION: INSERT execution (status=QUEUED) + execution_log
     -> Enqueue job to BullMQ (payload = execution_id only)
     -> Return 202 { execution_id, status: "QUEUED" }

4. WORKER PROCESSES JOB
   BullMQ dequeues job
     -> Fetch execution from DB (include snapshot, language config)
     -> Atomic claim: UPDATE WHERE status='QUEUED' -> status='RUNNING'
       (if affected_rows=0, another worker claimed it -> skip)
     -> Write source code to temp file
     -> Spawn child process with timeout + memory limits
     -> Capture stdout/stderr, sanitize output
     -> UPDATE execution with result (COMPLETED/FAILED/TIMEOUT)
     -> Log state transition in execution_logs
     -> Track timeout streaks for abuse prevention

5. POLL RESULT
   Client -> GET /api/v1/executions/:execution_id (poll every 1-2s)
     -> Return execution status + stdout/stderr when terminal state
     -> Include lifecycle logs for transparency
```

### Execution Lifecycle & State Management

```
  QUEUED -> RUNNING -> COMPLETED (exit code 0)
                    -> FAILED    (exit code != 0 or worker error)
                    -> TIMEOUT   (exceeded time limit, SIGKILL)
```

Each state transition is logged in `execution_logs` with timestamps, worker_id, and metadata (execution time, exit code, error details).

### Database Schema (3NF Normalized)

```
supported_languages (1) <---- (N) code_sessions (1) <---- (N) code_snapshots
                    (1) <---- (N) executions    (1) <---- (N) execution_logs
                                  code_sessions (1) <---- (N) executions
                                  code_snapshots(1) <---- (N) executions
```

**5 tables:**

| Table | Purpose |
|-------|---------|
| `supported_languages` | Reference table for languages (python, javascript, java, cpp). `is_active` flag for disable without data loss |
| `code_sessions` | Core entity. Tracks current source_code, version (optimistic lock), expires_at (TTL 4h) |
| `code_snapshots` | Autosave history. UNIQUE(session_id, version). Retention: 50 per session |
| `executions` | Execution records. Links to snapshot (exact code that ran). Idempotency key prevents duplicates |
| `execution_logs` | Audit trail. from_status -> to_status with timestamps and JSONB metadata |

### Queue-Based Execution Design

- **Producer** (API): `executionService.submitExecution()` enqueues jobs with only `execution_id` as payload. Source code never passes through Redis (security).
- **Consumer** (Worker): Separate process, scales independently. Fetches execution details from DB, runs code in sandbox.
- **Retry**: BullMQ handles retries automatically. Config: max 3 attempts, exponential backoff (2s, 4s, 8s).
- **Dead-letter**: Failed jobs retained 24h for debugging. Completed jobs cleaned after 1h or 1000 count.

---

## Reliability & Safety

### Idempotency

Each execution has a unique `idempotency_key = SHA256(session_id + snapshot_id + user_id)`. If the same code/user combination is submitted again, the existing execution is returned instead of creating a duplicate.

### Atomic Claim (Preventing Duplicate Processing)

```sql
UPDATE executions SET status='RUNNING', worker_id='...'
WHERE id='{id}' AND status='QUEUED'
```

If `affected_rows = 0`, another worker already claimed the job -> skip. This prevents duplicate processing when running multiple workers.

### Abuse Protection

| Protection | Mechanism |
|-----------|-----------|
| Rate limiting | Redis counter: max 10 executions/minute per user |
| Cooldown | 3 consecutive timeouts -> block user for 60s |
| Infinite loops | SIGKILL after timeout (cannot be trapped by user code) |
| Excessive output | stdout/stderr truncated to 1MB |
| Large code | source_code max 50KB (Zod validation) |
| Request body | Fastify bodyLimit 1MB |
| Output sanitization | Strip ANSI escape codes + control characters |
| Session expiry | Auto-expire after 4h (configurable TTL) |

### Error Handling

| Error Type | HTTP Status | Example |
|-----------|-------------|---------|
| Validation error (Zod) | 400 | Invalid UUID, missing field |
| Language not supported | 400 | `language: "brainfuck"` |
| Missing x-user-id | 401 | No auth header |
| Wrong user | 403 | Accessing another user's session |
| Not found | 404 | Session/execution doesn't exist |
| Version conflict | 409 | Stale autosave version |
| Rate limit | 429 | Too many executions |
| Internal error | 500 | Never leaks stack trace |

---

## Scalability Considerations

| Component | Current | Scale Strategy |
|-----------|---------|---------------|
| API servers | Single instance | Stateless -- add instances behind load balancer |
| Workers | Single process | Add worker instances -- BullMQ distributes jobs automatically |
| PostgreSQL | Single node | Read replicas for GET requests, PgBouncer for connection pooling |
| Redis | Single node | Cluster mode for high throughput |

### Potential Bottlenecks & Mitigations

1. **Process spawn overhead** -> Pre-warmed process pool or Docker container pool
2. **DB writes during peak autosave** -> Client-side debounce (3s), PgBouncer, batch writes
3. **Redis memory** -> TTL on all keys, LRU eviction policy
4. **Large stdout/stderr** -> Truncate to 1MB, consider streaming

### Performance Estimates

- API latency: ~5-20ms (create/autosave/poll)
- Execution latency: 100ms-10s (depends on user code)
- Queue throughput: ~1000 jobs/s per Redis instance

---

## Design Decisions & Trade-offs

| Decision | Optimized For | Trade-off |
|----------|--------------|-----------|
| **Polling instead of WebSocket** | Simplicity, stateless API, easy to scale | 1-2s delay, extra bandwidth. Upgrade path: SSE or WebSocket |
| **Snapshot per autosave** | Audit trail, exact code-to-result mapping | Storage cost. Mitigated by retention policy (50 snapshots) |
| **Job payload = ID only** | Security (source code never in Redis) | Extra DB query per job. Acceptable cost |
| **SIGKILL instead of SIGTERM** | Guaranteed kill (user code can trap SIGTERM) | No graceful shutdown. Acceptable for sandbox |
| **Optimistic locking (version)** | Prevent race conditions in autosave | Client must handle 409 Conflict + retry |
| **Fastify over Express** | Performance (~2x throughput) | Smaller ecosystem than Express |
| **BullMQ over RabbitMQ** | Node.js native, minimal infrastructure | Depends on Redis stability. Mitigated by Redis persistence |
| **PostgreSQL over MongoDB** | ACID, strong schema, FK integrity | Less flexible for unstructured data. JSONB columns available |
| **Separate API + Worker processes** | Independent scaling, fault isolation | More deployment complexity. Docker Compose handles it |
| **Process sandbox (not Docker)** | Fast startup, simple development | Less isolation than containers. Production upgrade path documented |

---

## Implemented Improvements

- **OpenAPI/Swagger documentation**: Interactive API docs auto-generated from Fastify route schemas. Available at `http://localhost:3000/docs` when the server is running.

- **Result caching**: Execution results for terminal states (COMPLETED/FAILED/TIMEOUT) are cached in Redis for 5 minutes. Subsequent polls hit Redis instead of PostgreSQL, significantly reducing DB load during client polling.

- **Worker health check**: `GET /health/worker` endpoint checks queue status (job counts), Redis connectivity, and database connectivity. Returns `"ok"` or `"degraded"` with error details.

## What I Would Improve With More Time

1. **Container-based sandbox**: Replace `child_process.spawn()` with Docker containers per execution (`docker run --network=none --read-only --memory=256m --cpus=0.5 --pids-limit=10`). Add nsjail for syscall whitelisting.

2. **WebSocket/SSE for real-time results**: Replace polling with Server-Sent Events for instant result delivery, reducing latency and bandwidth.

3. **Authentication**: Replace `x-user-id` header with JWT-based auth middleware. Currently assumes trusted internal API.

4. **Prometheus metrics**: Add execution time histograms, queue depth gauges, error rate counters for production monitoring.

5. **Multi-file execution**: Support projects with multiple files (e.g., Java with package structure).

---

## API Documentation

### Health Check

```
GET /health
```

Response (200):
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456
}
```

### Code Sessions

#### Create Session

```
POST /api/v1/code-sessions
Content-Type: application/json
```

Body:
```json
{
  "simulation_id": "uuid",
  "user_id": "uuid",
  "language": "python",
  "template_code": "# Write your solution\n"
}
```

Response (201):
```json
{
  "session_id": "uuid",
  "status": "ACTIVE",
  "language": "python",
  "language_version": "3.12",
  "expires_at": "2024-01-01T04:00:00.000Z",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

#### Autosave Code

```
PATCH /api/v1/code-sessions/:session_id
Content-Type: application/json
x-user-id: uuid
```

Body:
```json
{
  "source_code": "print('Hello World')",
  "version": 1
}
```

Response (200):
```json
{
  "session_id": "uuid",
  "status": "ACTIVE",
  "version": 2,
  "updated_at": "2024-01-01T00:01:00.000Z"
}
```

#### Get Session Details

```
GET /api/v1/code-sessions/:session_id
```

Response (200):
```json
{
  "session_id": "uuid",
  "simulation_id": "uuid",
  "user_id": "uuid",
  "language": "python",
  "language_version": "3.12",
  "source_code": "print('Hello World')",
  "status": "ACTIVE",
  "version": 2,
  "expires_at": "...",
  "created_at": "...",
  "updated_at": "..."
}
```

### Execution

#### Run Code

```
POST /api/v1/code-sessions/:session_id/run
x-user-id: uuid
```

Response (202):
```json
{
  "execution_id": "uuid",
  "status": "QUEUED"
}
```

#### Get Execution Result

```
GET /api/v1/executions/:execution_id
```

Response when COMPLETED (200):
```json
{
  "execution_id": "uuid",
  "session_id": "uuid",
  "status": "COMPLETED",
  "stdout": "Hello World\n",
  "stderr": "",
  "exit_code": 0,
  "execution_time_ms": 120,
  "queued_at": "...",
  "started_at": "...",
  "completed_at": "...",
  "lifecycle": [
    { "fromStatus": null, "toStatus": "QUEUED", "createdAt": "..." },
    { "fromStatus": "QUEUED", "toStatus": "RUNNING", "createdAt": "..." },
    { "fromStatus": "RUNNING", "toStatus": "COMPLETED", "createdAt": "..." }
  ]
}
```

#### List Session Executions

```
GET /api/v1/code-sessions/:session_id/executions
```

Response (200):
```json
{
  "executions": [
    {
      "id": "uuid",
      "status": "COMPLETED",
      "executionTimeMs": 120,
      "queuedAt": "...",
      "completedAt": "..."
    }
  ]
}
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
| `npm run db:seed` | Seed language data |
| `npm run db:reset` | Reset entire database |
| `npm test` | Run all tests |
| `npm run docker:up` | Start all Docker services |
| `npm run docker:down` | Stop Docker + remove data |

---

## Project Structure

```
src/
|-- server.ts              # Fastify app bootstrap
|-- config/                # Configuration (env, database, redis)
|-- controllers/           # HTTP request handlers
|-- services/              # Business logic (no HTTP knowledge)
|-- middlewares/            # Error handler
|-- routes/                # Route registration
|-- types/                 # Zod validation schemas
|-- utils/                 # Helpers (hashing, sanitization, AppError)
|-- workers/               # BullMQ worker (code execution consumer)

prisma/                    # Database schema + migrations + seed
tests/
|-- unit/                  # 29 unit tests (schemas, helpers)
|-- integration/           # 21 integration tests (API + execution flow)
```

> For detailed file-by-file documentation, see [ARCHITECTURE.md](../ARCHITECTURE.md).
