-- Contas da Microsoft (Outlook / Microsoft 365) ao lado das do Google. As que já existem são do Google.
-- CreateEnum
CREATE TYPE "ConnectionProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- AlterEnum
ALTER TYPE "EventSource" ADD VALUE 'MICROSOFT';

-- AlterTable
ALTER TABLE "google_calendars" ADD COLUMN     "sync_window_start" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "google_connections" ADD COLUMN     "provider" "ConnectionProvider" NOT NULL DEFAULT 'GOOGLE';

