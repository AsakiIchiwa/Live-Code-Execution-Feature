-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'CREATOR', 'ADMIN');
CREATE TYPE "Difficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
CREATE TYPE "LessonType" AS ENUM ('TUTORIAL', 'EXERCISE', 'CHALLENGE', 'QUIZ');
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'TIMEOUT');
CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED', 'EXPIRED');
CREATE TYPE "SessionMode" AS ENUM ('PLAYGROUND', 'STUDY');
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED');
CREATE TYPE "MarketplaceStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'SUSPENDED');
CREATE TYPE "MarketplaceItemType" AS ENUM ('LANGUAGE_PACK', 'LESSON_PACK');

-- CreateTable: users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255),
    "password_hash" VARCHAR(255),
    "display_name" VARCHAR(100) NOT NULL DEFAULT 'Coder',
    "avatar_url" VARCHAR(500),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "device_id" VARCHAR(255),
    "google_id" VARCHAR(255),
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_device_id_key" ON "users"("device_id");
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateTable: refresh_tokens
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");
CREATE INDEX "idx_refresh_token_user" ON "refresh_tokens"("user_id");
CREATE INDEX "idx_refresh_token_token" ON "refresh_tokens"("token");

-- CreateTable: user_settings
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "default_language" VARCHAR(20) NOT NULL DEFAULT 'java',
    "editor_theme" VARCHAR(30) NOT NULL DEFAULT 'dark',
    "font_size" INTEGER NOT NULL DEFAULT 14,
    "auto_save" BOOLEAN NOT NULL DEFAULT true,
    "preferred_mode" VARCHAR(20) NOT NULL DEFAULT 'playground',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

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

-- CreateTable: language_packs
CREATE TABLE "language_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "version" VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    "icon_url" VARCHAR(500),
    "size" INTEGER NOT NULL DEFAULT 0,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "is_free" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "supported_features" JSONB NOT NULL DEFAULT '[]',
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "creator_id" UUID,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "language_packs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "language_packs_code_key" ON "language_packs"("code");

-- CreateTable: user_language_packs
CREATE TABLE "user_language_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "language_pack_id" UUID NOT NULL,
    "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "is_installed" BOOLEAN NOT NULL DEFAULT false,
    "installed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_language_packs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_language_packs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_language_packs_language_pack_id_fkey" FOREIGN KEY ("language_pack_id") REFERENCES "language_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_language_packs_user_id_language_pack_id_key" ON "user_language_packs"("user_id", "language_pack_id");

-- CreateTable: lesson_packs
CREATE TABLE "lesson_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "language_pack_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "difficulty" "Difficulty" NOT NULL DEFAULT 'BEGINNER',
    "version" VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "is_free" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "icon_url" VARCHAR(500),
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "estimated_time" INTEGER NOT NULL DEFAULT 0,
    "total_lessons" INTEGER NOT NULL DEFAULT 0,
    "creator_id" UUID,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "lesson_packs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lesson_packs_language_pack_id_fkey" FOREIGN KEY ("language_pack_id") REFERENCES "language_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_lesson_pack_language" ON "lesson_packs"("language_pack_id");

-- CreateTable: user_lesson_packs
CREATE TABLE "user_lesson_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "lesson_pack_id" UUID NOT NULL,
    "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_lesson_packs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_lesson_packs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_lesson_packs_lesson_pack_id_fkey" FOREIGN KEY ("lesson_pack_id") REFERENCES "lesson_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_lesson_packs_user_id_lesson_pack_id_key" ON "user_lesson_packs"("user_id", "lesson_pack_id");

-- CreateTable: lessons
CREATE TABLE "lessons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lesson_pack_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "starter_code" TEXT NOT NULL DEFAULT '',
    "expected_output" TEXT,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'BEGINNER',
    "lesson_type" "LessonType" NOT NULL DEFAULT 'EXERCISE',
    "estimated_time" INTEGER NOT NULL DEFAULT 10,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lessons_lesson_pack_id_fkey" FOREIGN KEY ("lesson_pack_id") REFERENCES "lesson_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_lesson_pack_order" ON "lessons"("lesson_pack_id", "order_index");

-- CreateTable: test_cases
CREATE TABLE "test_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lesson_id" UUID NOT NULL,
    "input" TEXT NOT NULL DEFAULT '',
    "expected" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "test_cases_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_testcase_lesson" ON "test_cases"("lesson_id");

-- CreateTable: submissions
CREATE TABLE "submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "session_id" UUID,
    "source_code" TEXT NOT NULL,
    "language" VARCHAR(20) NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "score" INTEGER NOT NULL DEFAULT 0,
    "passed_tests" INTEGER NOT NULL DEFAULT 0,
    "total_tests" INTEGER NOT NULL DEFAULT 0,
    "feedback" TEXT,
    "compile_status" VARCHAR(50),
    "runtime_status" VARCHAR(50),
    "execution_time_ms" INTEGER,
    "memory_used_kb" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "submissions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_submission_user_lesson" ON "submissions"("user_id", "lesson_id");
CREATE INDEX "idx_submission_lesson" ON "submissions"("lesson_id");

-- CreateTable: lesson_progress
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "best_score" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ,
    "last_active_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_progress_user" ON "lesson_progress"("user_id");
CREATE UNIQUE INDEX "lesson_progress_user_id_lesson_id_key" ON "lesson_progress"("user_id", "lesson_id");

-- CreateTable: code_sessions
CREATE TABLE "code_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "simulation_id" UUID,
    "user_id" UUID NOT NULL,
    "language_id" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL DEFAULT 'Untitled',
    "template_code" TEXT NOT NULL DEFAULT '',
    "source_code" TEXT NOT NULL DEFAULT '',
    "mode" "SessionMode" NOT NULL DEFAULT 'PLAYGROUND',
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lesson_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "code_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "code_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "code_sessions_language_id_fkey" FOREIGN KEY ("language_id") REFERENCES "supported_languages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_session_user" ON "code_sessions"("user_id", "status");
CREATE INDEX "idx_session_simulation" ON "code_sessions"("simulation_id");
CREATE INDEX "idx_session_user_mode" ON "code_sessions"("user_id", "mode");

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

-- CreateTable: marketplace_submissions
CREATE TABLE "marketplace_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    "item_type" "MarketplaceItemType" NOT NULL,
    "language_pack_id" UUID,
    "lesson_pack_id" UUID,
    "status" "MarketplaceStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "version" VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    "price" INTEGER NOT NULL DEFAULT 0,
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "submitted_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "marketplace_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_submissions_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "marketplace_submissions_language_pack_id_fkey" FOREIGN KEY ("language_pack_id") REFERENCES "language_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "marketplace_submissions_lesson_pack_id_fkey" FOREIGN KEY ("lesson_pack_id") REFERENCES "lesson_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "idx_marketplace_creator" ON "marketplace_submissions"("creator_id");
CREATE INDEX "idx_marketplace_status" ON "marketplace_submissions"("status");
