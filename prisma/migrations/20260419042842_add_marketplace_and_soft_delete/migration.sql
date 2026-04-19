-- CreateEnum
CREATE TYPE "MarketplaceStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MarketplaceItemType" AS ENUM ('LANGUAGE_PACK', 'LESSON_PACK');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'CREATOR';

-- AlterTable
ALTER TABLE "language_packs" ADD COLUMN     "creator_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "lesson_packs" ADD COLUMN     "creator_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "deleted_at" TIMESTAMPTZ;

-- CreateTable
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

    CONSTRAINT "marketplace_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_marketplace_creator" ON "marketplace_submissions"("creator_id");

-- CreateIndex
CREATE INDEX "idx_marketplace_status" ON "marketplace_submissions"("status");

-- AddForeignKey
ALTER TABLE "marketplace_submissions" ADD CONSTRAINT "marketplace_submissions_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_submissions" ADD CONSTRAINT "marketplace_submissions_language_pack_id_fkey" FOREIGN KEY ("language_pack_id") REFERENCES "language_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_submissions" ADD CONSTRAINT "marketplace_submissions_lesson_pack_id_fkey" FOREIGN KEY ("lesson_pack_id") REFERENCES "lesson_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
