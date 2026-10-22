-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bank_access" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bank_movements" ADD COLUMN     "edited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bank_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_feedback_created_at_idx" ON "bank_feedback"("created_at");

-- AddForeignKey
ALTER TABLE "bank_feedback" ADD CONSTRAINT "bank_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
