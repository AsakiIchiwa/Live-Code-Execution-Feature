-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('TUTORIAL', 'EXERCISE', 'CHALLENGE', 'QUIZ');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('PLAYGROUND', 'STUDY');

-- AlterTable
ALTER TABLE "code_sessions" ADD COLUMN     "lesson_id" UUID,
ADD COLUMN     "mode" "SessionMode" NOT NULL DEFAULT 'PLAYGROUND',
ADD COLUMN     "title" VARCHAR(200) NOT NULL DEFAULT 'Untitled',
ALTER COLUMN "simulation_id" DROP NOT NULL;

-- CreateTable
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

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "language_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_language_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "language_pack_id" UUID NOT NULL,
    "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "is_installed" BOOLEAN NOT NULL DEFAULT false,
    "installed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_language_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lesson_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_lesson_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "lesson_pack_id" UUID NOT NULL,
    "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_lesson_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_device_id_key" ON "users"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_refresh_token_user" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_refresh_token_token" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "language_packs_code_key" ON "language_packs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_language_packs_user_id_language_pack_id_key" ON "user_language_packs"("user_id", "language_pack_id");

-- CreateIndex
CREATE INDEX "idx_lesson_pack_language" ON "lesson_packs"("language_pack_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_lesson_packs_user_id_lesson_pack_id_key" ON "user_lesson_packs"("user_id", "lesson_pack_id");

-- CreateIndex
CREATE INDEX "idx_lesson_pack_order" ON "lessons"("lesson_pack_id", "order_index");

-- CreateIndex
CREATE INDEX "idx_testcase_lesson" ON "test_cases"("lesson_id");

-- CreateIndex
CREATE INDEX "idx_submission_user_lesson" ON "submissions"("user_id", "lesson_id");

-- CreateIndex
CREATE INDEX "idx_submission_lesson" ON "submissions"("lesson_id");

-- CreateIndex
CREATE INDEX "idx_progress_user" ON "lesson_progress"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_user_id_lesson_id_key" ON "lesson_progress"("user_id", "lesson_id");

-- CreateIndex
CREATE INDEX "idx_session_user_mode" ON "code_sessions"("user_id", "mode");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_language_packs" ADD CONSTRAINT "user_language_packs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_language_packs" ADD CONSTRAINT "user_language_packs_language_pack_id_fkey" FOREIGN KEY ("language_pack_id") REFERENCES "language_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_packs" ADD CONSTRAINT "lesson_packs_language_pack_id_fkey" FOREIGN KEY ("language_pack_id") REFERENCES "language_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_lesson_packs" ADD CONSTRAINT "user_lesson_packs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_lesson_packs" ADD CONSTRAINT "user_lesson_packs_lesson_pack_id_fkey" FOREIGN KEY ("lesson_pack_id") REFERENCES "lesson_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_lesson_pack_id_fkey" FOREIGN KEY ("lesson_pack_id") REFERENCES "lesson_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_sessions" ADD CONSTRAINT "code_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
