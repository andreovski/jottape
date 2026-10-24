-- AlterTable
ALTER TABLE "assistant_cards" ADD COLUMN     "corrections" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "saved" JSONB;

-- AlterTable
ALTER TABLE "assistant_feedback" ADD COLUMN     "context" JSONB,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "today" TEXT;

-- CreateTable
CREATE TABLE "assistant_test_cases" (
    "id" TEXT NOT NULL,
    "feedback_id" TEXT,
    "text" TEXT NOT NULL,
    "today" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "expect" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_test_cases_feedback_id_key" ON "assistant_test_cases"("feedback_id");

-- AddForeignKey
ALTER TABLE "assistant_test_cases" ADD CONSTRAINT "assistant_test_cases_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "assistant_feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
