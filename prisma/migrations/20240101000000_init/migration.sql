-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED', 'EXPIRED');
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED');

-- CreateTable: supported_languages
CREATE TABLE "supported_languages" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "docker_image" VARCHAR(100) NOT NULL,
    "file_extension" VARCHAR(10) NOT NULL,
    "max_timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "max_memory_kb" INTEGER NOT NULL DEFAULT 262144,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supported_languages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supported_languages_name_key" ON "supported_languages"("name");

-- CreateTable: code_sessions
CREATE TABLE "code_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "simulation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "language_id" INTEGER NOT NULL,
    "template_code" TEXT NOT NULL DEFAULT '',
    "source_code" TEXT NOT NULL DEFAULT '',
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "code_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "code_sessions_language_id_fkey" FOREIGN KEY ("language_id") REFERENCES "supported_languages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_session_user" ON "code_sessions"("user_id", "status");
CREATE INDEX "idx_session_simulation" ON "code_sessions"("simulation_id");

-- CreateTable: code_snapshots
CREATE TABLE "code_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "source_code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "code_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "code_snapshots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "code_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "code_snapshots_session_id_version_key" ON "code_snapshots"("session_id", "version");
CREATE INDEX "idx_snapshot_session" ON "code_snapshots"("session_id", "version" DESC);

-- CreateTable: executions
CREATE TABLE "executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "language_id" INTEGER NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotency_key" VARCHAR(64) NOT NULL,
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "exit_code" INTEGER,
    "execution_time_ms" INTEGER,
    "memory_used_kb" INTEGER,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 2,
    "worker_id" VARCHAR(50),
    "queued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    CONSTRAINT "executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "executions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "code_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "executions_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "code_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "executions_language_id_fkey" FOREIGN KEY ("language_id") REFERENCES "supported_languages"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chk_started_after_queued" CHECK ("started_at" IS NULL OR "started_at" >= "queued_at"),
    CONSTRAINT "chk_completed_after_started" CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at")
);
CREATE UNIQUE INDEX "executions_idempotency_key_key" ON "executions"("idempotency_key");
CREATE INDEX "idx_exec_session" ON "executions"("session_id");
CREATE INDEX "idx_exec_status" ON "executions"("status", "queued_at");

-- CreateTable: execution_logs
CREATE TABLE "execution_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "execution_id" UUID NOT NULL,
    "from_status" "ExecutionStatus",
    "to_status" "ExecutionStatus" NOT NULL,
    "worker_id" VARCHAR(50),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_log_execution" ON "execution_logs"("execution_id", "created_at");
