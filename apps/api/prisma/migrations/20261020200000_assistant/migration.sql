-- Assistente: conversa (some em 30 dias), cartões de lançamento propostos e uso por comando (limite e custo).
-- CreateEnum
CREATE TYPE "AssistantRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AssistantCardStatus" AS ENUM ('DRAFT', 'SAVED', 'UNDONE', 'DISCARDED');

-- CreateEnum
CREATE TYPE "AssistantUsageKind" AS ENUM ('MESSAGE', 'TRANSCRIPTION');

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "AssistantRole" NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "status" "AssistantCardStatus" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "draft" JSONB NOT NULL,
    "missing" TEXT[],
    "uncertain" TEXT[],
    "transaction_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AssistantUsageKind" NOT NULL,
    "audio_seconds" DOUBLE PRECISION,
    "jev_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "model_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "model_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_messages_user_id_created_at_idx" ON "assistant_messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_cards_user_id_idx" ON "assistant_cards"("user_id");

-- CreateIndex
CREATE INDEX "assistant_usage_user_id_kind_created_at_idx" ON "assistant_usage"("user_id", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_cards" ADD CONSTRAINT "assistant_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_cards" ADD CONSTRAINT "assistant_cards_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
