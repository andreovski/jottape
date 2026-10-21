-- AlterEnum
ALTER TYPE "AssistantUsageKind" ADD VALUE 'INSIGHT';

-- CreateTable
CREATE TABLE "finance_insights" (
    "user_id" TEXT NOT NULL,
    "kind" TEXT,
    "period" TEXT,
    "fingerprint" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "generated_on" TEXT,
    "generated_at" TIMESTAMP(3),
    "attempted_on" TEXT,
    "refreshed_on" TEXT,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "finance_insights_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "finance_insights_viewed_at_idx" ON "finance_insights"("viewed_at");

-- AddForeignKey
ALTER TABLE "finance_insights" ADD CONSTRAINT "finance_insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

