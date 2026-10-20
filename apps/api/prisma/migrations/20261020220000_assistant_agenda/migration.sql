-- Assistente também cria eventos e tarefas.
ALTER TABLE "assistant_cards" ADD COLUMN "event_id" TEXT,
ADD COLUMN "task_id" TEXT;
