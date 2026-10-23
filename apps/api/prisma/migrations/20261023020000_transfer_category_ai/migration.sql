-- CreateEnum
CREATE TYPE "CategorySystemKey" AS ENUM ('TRANSFER', 'TRANSFER_PIX', 'TRANSFER_DEBIT', 'TRANSFER_CREDIT');

-- CreateEnum
CREATE TYPE "CategorySuggestionSource" AS ENUM ('HISTORY', 'AI', 'RULE');

-- AlterEnum
ALTER TYPE "AssistantUsageKind" ADD VALUE 'BANK_CATEGORY';

-- AlterTable
ALTER TABLE "bank_movements" ADD COLUMN     "ai_checked_at" TIMESTAMP(3),
ADD COLUMN     "ai_trace" JSONB,
ADD COLUMN     "suggestion_confidence" DOUBLE PRECISION,
ADD COLUMN     "suggestion_source" "CategorySuggestionSource";

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "system_key" "CategorySystemKey";

-- CreateIndex
CREATE UNIQUE INDEX "categories_user_id_kind_system_key_key" ON "categories"("user_id", "kind", "system_key");


-- Categoria fixa Transferência, com Pix, Débito e Crédito, em entradas e em saídas, para todos.
-- Nada é apagado nem movido: a "Transferência" (e a "Pix" dentro dela) que a pessoa já tiver
-- fica como está, com os lançamentos e orçamentos dela, e só ganha a marca.

-- A Transferência que já existe (sem mãe; a mais antiga, se houver duas) ganha a marca.
UPDATE "categories" c SET "system_key" = 'TRANSFER'
FROM (
  SELECT DISTINCT ON ("user_id", "kind") "id"
  FROM "categories"
  WHERE "parent_id" IS NULL
    AND translate(lower(trim("name")), 'áàâãéêíóôõúç', 'aaaaeeiooouc') IN ('transferencia', 'transferencias')
  ORDER BY "user_id", "kind", "created_at"
) found
WHERE c."id" = found."id";

-- Quem não tem ganha uma nova.
INSERT INTO "categories" ("id", "user_id", "name", "kind", "icon", "color", "system_key", "created_at", "updated_at")
SELECT gen_random_uuid()::text, u."id", 'Transferência', k."kind"::"CategoryKind", 'landmark', '#32ade6', 'TRANSFER', now(), now()
FROM "users" u
CROSS JOIN (VALUES ('INCOME'), ('EXPENSE')) AS k("kind")
WHERE NOT EXISTS (
  SELECT 1 FROM "categories" c
  WHERE c."user_id" = u."id" AND c."kind" = k."kind"::"CategoryKind" AND c."system_key" = 'TRANSFER'
);

-- As subcategorias: a que já existe dentro da Transferência ganha a marca; a que falta é criada.
UPDATE "categories" c SET "system_key" = found."key"::"CategorySystemKey"
FROM (
  SELECT DISTINCT ON (child."parent_id", sub."key") child."id", sub."key"
  FROM "categories" child
  JOIN "categories" parent ON parent."id" = child."parent_id" AND parent."system_key" = 'TRANSFER'
  JOIN (VALUES ('TRANSFER_PIX', 'pix'), ('TRANSFER_DEBIT', 'debito'), ('TRANSFER_CREDIT', 'credito')) AS sub("key", "plain")
    ON translate(lower(trim(child."name")), 'áàâãéêíóôõúç', 'aaaaeeiooouc') = sub."plain"
  WHERE child."system_key" IS NULL
  ORDER BY child."parent_id", sub."key", child."created_at"
) found
WHERE c."id" = found."id";

INSERT INTO "categories" ("id", "user_id", "name", "kind", "parent_id", "icon", "system_key", "created_at", "updated_at")
SELECT gen_random_uuid()::text, parent."user_id", sub."name", parent."kind", parent."id", sub."icon", sub."key"::"CategorySystemKey", now(), now()
FROM "categories" parent
CROSS JOIN (VALUES ('TRANSFER_PIX', 'Pix', 'pix'), ('TRANSFER_DEBIT', 'Débito', 'wallet'), ('TRANSFER_CREDIT', 'Crédito', 'credit-card')) AS sub("key", "name", "icon")
WHERE parent."system_key" = 'TRANSFER'
  AND NOT EXISTS (
    SELECT 1 FROM "categories" c
    WHERE c."user_id" = parent."user_id" AND c."kind" = parent."kind" AND c."system_key" = sub."key"::"CategorySystemKey"
  );
