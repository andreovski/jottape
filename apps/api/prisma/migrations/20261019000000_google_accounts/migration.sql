-- Várias contas Google por usuário. A conexão que já existe (no máximo uma por usuário) vira a
-- primeira conta: os calendários passam a apontar para ela, o calendário padrão sobe para o
-- usuário e ela continua sendo a conta do Google Tasks. O google_sub fica nulo e é preenchido na
-- próxima sincronização.

-- Colunas novas
ALTER TABLE "google_calendars" ADD COLUMN "color_override" TEXT,
ADD COLUMN "connection_id" TEXT;

ALTER TABLE "google_connections" ADD COLUMN "google_sub" TEXT,
ADD COLUMN "sync_tasks" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users" ADD COLUMN "default_calendar_id" TEXT;

-- Backfill
UPDATE "google_calendars" c SET "connection_id" = g."id"
FROM "google_connections" g WHERE g."user_id" = c."user_id";

-- Calendário sem conexão não deveria existir (desconectar apaga todos); se houver, sai.
DELETE FROM "google_calendars" WHERE "connection_id" IS NULL;

UPDATE "users" u SET "default_calendar_id" = g."default_calendar_id"
FROM "google_connections" g
WHERE g."user_id" = u."id"
  AND EXISTS (SELECT 1 FROM "google_calendars" c WHERE c."id" = g."default_calendar_id");

UPDATE "google_connections" SET "sync_tasks" = true;

-- Restrições
ALTER TABLE "google_calendars" ALTER COLUMN "connection_id" SET NOT NULL;
ALTER TABLE "google_connections" DROP COLUMN "default_calendar_id";

DROP INDEX "google_calendars_user_id_google_calendar_id_key";
DROP INDEX "google_connections_user_id_key";

CREATE INDEX "google_calendars_user_id_idx" ON "google_calendars"("user_id");
CREATE UNIQUE INDEX "google_calendars_connection_id_google_calendar_id_key" ON "google_calendars"("connection_id", "google_calendar_id");
CREATE INDEX "google_connections_user_id_idx" ON "google_connections"("user_id");
CREATE UNIQUE INDEX "google_connections_user_id_google_sub_key" ON "google_connections"("user_id", "google_sub");
-- No máximo uma conta do Google Tasks por usuário.
CREATE UNIQUE INDEX "google_connections_user_id_sync_tasks_key" ON "google_connections"("user_id") WHERE "sync_tasks";
CREATE UNIQUE INDEX "users_default_calendar_id_key" ON "users"("default_calendar_id");

ALTER TABLE "users" ADD CONSTRAINT "users_default_calendar_id_fkey" FOREIGN KEY ("default_calendar_id") REFERENCES "google_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "google_calendars" ADD CONSTRAINT "google_calendars_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "google_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
