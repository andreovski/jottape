-- CreateTable
CREATE TABLE "briefing_settings" (
    "user_id" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "briefing_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "external_cache" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_cache_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "briefing_settings" ADD CONSTRAINT "briefing_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
