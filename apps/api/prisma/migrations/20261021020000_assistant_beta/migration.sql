-- AlterEnum
ALTER TYPE "AssistantUsageKind" ADD VALUE 'BENCHMARK';

-- AlterTable
ALTER TABLE "assistant_cards" ADD COLUMN     "auto_saved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "edited" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "assistant_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "assistant_limit" INTEGER;

-- CreateTable
CREATE TABLE "assistant_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message_id" TEXT,
    "request" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "values" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "trace" JSONB,
    "cards" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_feedback_created_at_idx" ON "assistant_feedback"("created_at");

-- AddForeignKey
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

