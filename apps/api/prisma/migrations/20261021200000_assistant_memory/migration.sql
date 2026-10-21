-- CreateTable
CREATE TABLE "assistant_memory" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value_id" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_memory_user_id_phrase_field_key" ON "assistant_memory"("user_id", "phrase", "field");

-- AddForeignKey
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
